# Capy-POS on IBM Cloud Code Engine.
#
# One project, one registry namespace, one registry pull secret — and N apps over
# `var.services`. It reads as a loop rather than three near-identical resource
# blocks on purpose: `aws-demo/main.tf` in this same directory is what six
# copy-pasted `aws_lambda_function` blocks look like six months later, and the
# frontend, the vision proxy and the clerk relay differ only in a port, a tag and
# which secrets they need.
#
# Adding a fourth app (`infra/pos-api`, story #196) is therefore a map entry, not
# a new file.

# Data source: Resource Group
data "ibm_resource_group" "group" {
  name = var.resource_group_name
}

# Container Registry Namespace
resource "ibm_cr_namespace" "namespace" {
  name              = var.cr_namespace
  resource_group_id = data.ibm_resource_group.group.id
}

# Code Engine Project
resource "ibm_code_engine_project" "project" {
  name              = var.project_name
  resource_group_id = data.ibm_resource_group.group.id
}

# Code Engine Secret for Container Registry access
resource "ibm_code_engine_secret" "cr_secret" {
  project_id = ibm_code_engine_project.project.project_id
  name       = "icr-secret"
  format     = "registry"

  data = {
    server   = "us.icr.io"
    username = "iamapikey"
    password = var.ibmcloud_api_key
  }
}

locals {
  # The apps that hold the model key, the apps that verify a session token, and the
  # apps that talk to Cloudant. Derived once so the secret resources and the env
  # bindings below cannot drift apart from each other.
  model_key_services       = { for name, service in var.services : name => service if service.needs_model_key }
  session_guarded_services = { for name, service in var.services : name => service if service.needs_session_secret }
  cloudant_services        = { for name, service in var.services : name => service if service.needs_cloudant }
  appid_secret_services    = { for name, service in var.services : name => service if service.needs_appid_secret }
  internal_secret_services = { for name, service in var.services : name => service if service.needs_internal_secret }
  checkout_services        = { for name, service in var.services : name => service if service.needs_checkout }
  checkout_job_services    = { for name, service in var.services : name => service if service.needs_checkout && service.needs_cloudant }

  # The browser origins a guarded app will answer. Comma-joined because that is
  # what `readAllowedOrigins` in each proxy's `session-guard.ts` parses. Empty until
  # the operator supplies it, which the precondition on `ibm_code_engine_app.apps`
  # turns into a failed plan — see "Two-pass apply" in README.md.
  allowed_origins = join(",", var.frontend_origins)

  # Literal (non-secret) env per app. `NODE_ENV` for every app, `ALLOWED_ORIGINS`
  # only for services that pin CORS to it, and `env` last so a service can override
  # either.
  #
  # A CORS-pinning service gets `ALLOWED_ORIGINS` unconditionally, not only when it
  # is non-empty: the binding states what the container needs, and whether the value
  # exists is the precondition's job. Omitting the variable when the list is empty —
  # which is the stock default — is what deployed two apps whose `requireConfig()`
  # calls `process.exit(1)` before they ever listen.
  #
  # Deliberately separate from `needs_session_secret`: every browser-facing service,
  # including pos-api's public checkout routes, must opt into exact-origin CORS.
  service_env = {
    for name, service in var.services : name => merge(
      { NODE_ENV = "production" },
      service.pins_cors_origins ? { ALLOWED_ORIGINS = local.allowed_origins } : {},
      # Not gated on needs_model_key alone: a model-key app with no override set
      # gets nothing here, and the Anthropic SDK's own default (the real API)
      # applies untouched.
      service.needs_model_key && var.anthropic_base_url != "" ? { ANTHROPIC_BASE_URL = var.anthropic_base_url } : {},
      # Tenant/client id are not secrets — see appid_tenant_id's description —
      # so they are literal env here, same as ALLOWED_ORIGINS above. Bound for
      # either flag: a service that mints tokens (needs_appid_secret) and one
      # that only verifies them (needs_appid_verification) both need to know
      # which tenant and audience they're talking about; only the former also
      # gets the client *secret*, bound separately below.
      service.needs_appid_secret || service.needs_appid_verification ? {
        APPID_REGION    = var.appid_region
        APPID_TENANT_ID = var.appid_tenant_id
        APPID_CLIENT_ID = var.appid_client_id
      } : {},
      # The CUSTOMER application's client id (epic #261 item 25). Only the relay that
      # actually exchanges a customer grant needs it — pos-api and the two proxies verify
      # tokens and never mint them, so giving them a second audience would only invite a
      # customer token into a staff path.
      #
      # Bound only when non-empty, and its secret half is guarded by a precondition
      # below: `customer-token.ts` refuses to serve unless BOTH exist, so a half-set pair
      # is a startup failure rather than a degraded mode. That exact shape — an
      # "optional, set it later" var paired with an unconditionally-bound one — left two
      # services crash-looping invisibly for ~10 hours during Phase 5.
      service.needs_appid_secret && var.appid_customer_client_id != "" ? {
        APPID_CUSTOMER_CLIENT_ID = var.appid_customer_client_id
      } : {},
      # Only the two *callers* of pos-api's GET /internal/roles need to know
      # where it lives — pos-api itself reads the shared roles document
      # directly out of its own Cloudant store, no HTTP hop. Optional: an
      # empty pos_api_internal_url means both proxies keep their local
      # ROLE_PERMISSIONS fallback, unchanged (see readRolesSourceConfig() in
      # each service's own server.ts).
      name != "capy-pos-api" && service.needs_internal_secret && var.pos_api_internal_url != "" ? {
        POS_API_INTERNAL_ROLES_URL = var.pos_api_internal_url
      } : {},
      service.needs_checkout ? {
        ALLOWED_ORIGINS                  = local.allowed_origins
        CLOUDANT_CHECKOUTS_DB            = "checkouts"
        CHECKOUT_STORE_ID                = var.checkout_store_id
        PAYPAL_EXPECTED_MERCHANT_ID      = var.paypal_expected_merchant_id
        PAYPAL_CLIENT_ID                 = var.paypal_client_id
        PAYPAL_ENVIRONMENT               = var.paypal_environment
        PAYPAL_TIMEOUT_MS                = tostring(var.paypal_timeout_ms)
        CHECKOUT_CURRENCY                = var.checkout_currency
        CHECKOUT_TAX_BASIS_POINTS        = tostring(var.checkout_tax_basis_points)
        CHECKOUT_MAX_ITEM_QUANTITY       = tostring(var.checkout_max_item_quantity)
        CHECKOUT_MAX_AGGREGATE_QUANTITY  = tostring(var.checkout_max_aggregate_quantity)
        CHECKOUT_MAX_TOTAL_MINOR_UNITS   = tostring(var.checkout_max_total_minor_units)
        CHECKOUT_IDEMPOTENCY_KEY_VERSION = var.checkout_idempotency_key_version
        CHECKOUT_CAPABILITY_KEY_VERSION  = var.checkout_capability_key_version
        CHECKOUT_RATE_LIMIT_REQUESTS     = tostring(var.checkout_rate_limit_requests)
        CHECKOUT_RATE_LIMIT_WINDOW_MS    = tostring(var.checkout_rate_limit_window_ms)
        CHECKOUT_RATE_LIMIT_MAX_KEYS     = tostring(var.checkout_rate_limit_max_keys)
      } : {},
      service.env,
    )
  }
}

# The model API key, one generic secret per app that calls Claude.
#
# Per-app rather than one shared secret so revoking the relay's key does not also
# blind the vision proxy, and `secret_key_reference` rather than a `literal` env
# var (unlike `NODE_ENV` above) so the value never lands in the app's revision
# spec — which `ibmcloud ce app get` prints.
resource "ibm_code_engine_secret" "model_key" {
  for_each = local.model_key_services

  project_id = ibm_code_engine_project.project.project_id
  name       = "${each.key}-model-key"
  format     = "generic"

  data = {
    ANTHROPIC_API_KEY = var.anthropic_api_key
  }

  lifecycle {
    precondition {
      condition     = length(var.anthropic_api_key) > 0
      error_message = "${each.key} needs a model key: set TF_VAR_anthropic_api_key (never commit it)."
    }
  }
}

# The App ID client secret, one generic secret per app that sets needs_appid_secret.
#
# Per-app for the same reason the model key is per-app — today only
# infra/appid-token-relay sets the flag, but revoking one app's App ID access
# should never blind a sibling that might use a different App ID application.
#
# APPID_MANAGEMENT_APIKEY rides in the same secret rather than a new resource —
# only this one relay ever holds it, same as APPID_CLIENT_SECRET, and it's
# optional (Phase 3d): left empty, sign-in keeps working; only the admin
# staff-management routes fail once reached, per server.ts's own startup check.
resource "ibm_code_engine_secret" "appid_secret" {
  for_each = local.appid_secret_services

  project_id = ibm_code_engine_project.project.project_id
  name       = "${each.key}-appid-secret"
  format     = "generic"

  data = {
    APPID_CLIENT_SECRET     = var.appid_client_secret
    APPID_MANAGEMENT_APIKEY = var.appid_management_api_key
    # The customer application's secret rides in the SAME secret resource for the same
    # reason the management key does: only this one relay ever holds it. Empty until
    # item 25 is applied, which is a state customer-token.ts handles explicitly by
    # answering 502 on /appid/customer/token rather than refusing to boot — staff
    # sign-in must keep working on a deployment that has not provisioned customers yet.
    APPID_CUSTOMER_CLIENT_SECRET = var.appid_customer_client_secret
  }

  lifecycle {
    precondition {
      condition     = length(var.appid_client_secret) > 0 && length(var.appid_tenant_id) > 0 && length(var.appid_client_id) > 0
      error_message = "${each.key} needs an App ID tenant: set TF_VAR_appid_tenant_id, TF_VAR_appid_client_id and TF_VAR_appid_client_secret (never commit the secret)."
    }
    # Both halves of the customer pair, or neither. `customer-token.ts` exits rather than
    # serve a half-configured customer route, so a one-sided apply produces a service that
    # cannot start — and Code Engine keeps routing to the last good revision, which makes
    # the failure INVISIBLE. That is exactly how Phase 5 left vision-proxy and
    # clerk-agent-relay crash-looping for ~10 hours with no user-facing symptom. Failing
    # at plan time is the cheap version of that lesson.
    precondition {
      condition = (
        (length(var.appid_customer_client_id) > 0) == (length(var.appid_customer_client_secret) > 0)
      )
      error_message = "appid_customer_client_id and appid_customer_client_secret must be set TOGETHER, or both left empty. Setting one without the other makes infra/appid-token-relay refuse to serve /appid/customer/token, and Code Engine will keep serving the previous revision so the breakage is silent."
    }
  }
}

# The session-signing secret, one for the whole project.
#
# Shared deliberately: pos-api and the two proxies all verify the same HS256 token
# the browser already mints (`src/app/core/infrastructure/auth/session-issuer.ts`),
# so a per-app secret would mean a token that one app accepts and its sibling rejects.
resource "ibm_code_engine_secret" "session_jwt" {
  count = length(local.session_guarded_services) > 0 ? 1 : 0

  project_id = ibm_code_engine_project.project.project_id
  name       = "session-jwt"
  format     = "generic"

  data = {
    SESSION_JWT_SECRET = var.session_jwt_secret
  }

  lifecycle {
    precondition {
      condition     = length(var.session_jwt_secret) > 0
      error_message = "Session verification needs TF_VAR_session_jwt_secret, matching getJwtSecret() in session-issuer.ts."
    }
  }
}

# The internal service-to-service secret, one for the whole project — same
# shape as session_jwt above, for the same reason: pos-api's /internal/roles
# route and the two proxies calling it all need to agree on one value, so a
# per-app secret would mean a caller that mints the header and a callee that
# rejects it.
resource "ibm_code_engine_secret" "internal_secret" {
  count = length(local.internal_secret_services) > 0 ? 1 : 0

  project_id = ibm_code_engine_project.project.project_id
  name       = "internal-api-secret"
  format     = "generic"

  data = {
    INTERNAL_API_SECRET = var.internal_api_secret
  }

  lifecycle {
    precondition {
      condition     = length(var.internal_api_secret) > 0
      error_message = "Internal service-to-service calls need TF_VAR_internal_api_secret (generate with openssl rand -hex 32)."
    }
  }
}

# One shared Cloudant instance for the estate, same pattern as the one CR namespace
# and one Code Engine project above: pos-api is the only consumer today, but a
# database is provisioned once, not per-app. The dedicated `ibm_cloudant` resource
# (not the generic `ibm_resource_instance`) is IBM's own documented way to provision
# one — see the provider's examples/ibm-cloudant/lite-plan.
resource "ibm_cloudant" "store" {
  name     = "${var.project_name}-cloudant"
  location = var.region
  plan     = "lite"
}

# Real, generated credentials — never hand-entered, never a literal env var.
# The pre-existing Manager key is retained only for index migrations; Cloudant's
# Writer role deliberately excludes index creation. Runtime traffic receives the
# separate Writer key below, so compromising pos-api cannot administer databases.
resource "ibm_resource_key" "cloudant_key" {
  name                 = "${var.project_name}-cloudant-key"
  role                 = "Manager"
  resource_instance_id = ibm_cloudant.store.id
}

resource "ibm_resource_key" "cloudant_writer_key" {
  name                 = "${var.project_name}-cloudant-writer-key"
  role                 = "Writer"
  resource_instance_id = ibm_cloudant.store.id
}

# Cloudant is CouchDB underneath: a database has to exist before any document can
# be written or listed in it, or every call 404s (confirmed live: pos-api's first
# real deploy logged "Cloudant create failed with 404" / "list failed with 404"
# against a freshly-provisioned instance with no databases in it yet). Names match
# pos-api's own defaults for CLOUDANT_PRODUCTS_DB/CLOUDANT_TRANSACTIONS_DB
# (src/server.ts:73-74) exactly — an override on one side with no matching database
# here reproduces the same 404.
resource "ibm_cloudant_database" "products" {
  db           = "products"
  instance_crn = ibm_cloudant.store.crn
}

resource "ibm_cloudant_database" "transactions" {
  db           = "transactions"
  instance_crn = ibm_cloudant.store.crn
}

# Phase 5 RBAC centralization: one document holding every role's permission
# set, replacing the three hand-copied ROLE_PERMISSIONS tables in
# pos-api/session-auth.ts and the two proxies' session-guard.ts. Name matches
# pos-api's own CLOUDANT_ROLES_DB default exactly, same convention as
# products/transactions above.
resource "ibm_cloudant_database" "roles" {
  db           = "roles"
  instance_crn = ibm_cloudant.store.crn
}

resource "ibm_cloudant_database" "checkouts" {
  db           = "checkouts"
  instance_crn = ibm_cloudant.store.crn
}

locals {
  # `credentials_json` + jsondecode over the flat `credentials` map: IBM's own
  # resource_key docs document both, and jsondecode reads correctly whether a
  # service's credential JSON is flat or nested (unlike Cloud Object Storage's
  # `cos_hmac_keys.access_key_id`, Cloudant's is documented as flat). `apikey`
  # and `url` are IBM Cloudant's long-stable IAM service-credential field
  # names — worth a glance at the real output on the first `terraform apply`
  # (`terraform state show ibm_resource_key.cloudant_key`) before trusting this
  # blindly, since this project has never applied against a real Cloudant
  # instance before.
  cloudant_manager_credentials = jsondecode(ibm_resource_key.cloudant_key.credentials_json)
  cloudant_writer_credentials  = jsondecode(ibm_resource_key.cloudant_writer_key.credentials_json)
}

# Cloudant credentials, one generic secret per app that sets `needs_cloudant`.
#
# Per-app rather than one shared secret for the same reason the model key is
# per-app: revoking one service's access should not blind its sibling. Only
# pos-api sets the flag today, but the loop costs nothing extra to keep general.
resource "ibm_code_engine_secret" "cloudant_creds" {
  for_each = local.cloudant_services

  project_id = ibm_code_engine_project.project.project_id
  name       = "${each.key}-cloudant-creds"
  format     = "generic"

  data = {
    CLOUDANT_URL    = local.cloudant_writer_credentials.url
    CLOUDANT_APIKEY = local.cloudant_writer_credentials.apikey
  }
}

# Migration alone receives the Manager credential needed to create a Mango index.
# This secret is never mounted into the HTTP app or reconciliation worker.
resource "ibm_code_engine_secret" "cloudant_migration_creds" {
  for_each = local.checkout_job_services

  project_id = ibm_code_engine_project.project.project_id
  name       = "${each.key}-cloudant-migration-creds"
  format     = "generic"

  data = {
    CLOUDANT_URL    = local.cloudant_manager_credentials.url
    CLOUDANT_APIKEY = local.cloudant_manager_credentials.apikey
  }
}

resource "ibm_code_engine_secret" "checkout" {
  for_each = local.checkout_services

  project_id = ibm_code_engine_project.project.project_id
  name       = "${each.key}-checkout"
  format     = "generic"

  data = {
    PAYPAL_CLIENT_SECRET                = var.paypal_client_secret
    CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON = jsonencode(var.checkout_idempotency_hmac_keys)
    CHECKOUT_CAPABILITY_HMAC_KEYS_JSON  = jsonencode(var.checkout_capability_hmac_keys)
  }

  lifecycle {
    precondition {
      condition = (
        length(var.paypal_client_secret) > 0 &&
        length(var.paypal_client_id) > 0 &&
        length(var.paypal_expected_merchant_id) > 0 &&
        length(var.checkout_store_id) > 0
      )
      error_message = "Checkout needs the PayPal client pair, expected merchant id, and trusted store id. Never commit the client secret."
    }
    precondition {
      condition = (
        contains(keys(var.checkout_idempotency_hmac_keys), var.checkout_idempotency_key_version) &&
        contains(keys(var.checkout_capability_hmac_keys), var.checkout_capability_key_version) &&
        alltrue([for key in values(var.checkout_idempotency_hmac_keys) : length(key) >= 32]) &&
        alltrue([for key in values(var.checkout_capability_hmac_keys) : length(key) >= 32])
      )
      error_message = "Each active checkout HMAC version must exist and every retained key must contain at least 32 characters."
    }
    precondition {
      condition = (
        var.paypal_environment == "production" &&
        var.checkout_currency == "USD" &&
        var.checkout_tax_basis_points >= 0 &&
        var.checkout_tax_basis_points <= 10000 &&
        var.checkout_max_item_quantity > 0 &&
        var.checkout_max_item_quantity <= 10000 &&
        var.checkout_max_aggregate_quantity >= var.checkout_max_item_quantity &&
        var.checkout_max_aggregate_quantity <= 50000 &&
        var.checkout_max_total_minor_units > 0 &&
        var.checkout_max_total_minor_units <= 100000000 &&
        var.paypal_timeout_ms > 0 &&
        var.paypal_timeout_ms <= 120000 &&
        var.checkout_rate_limit_requests > 0 &&
        var.checkout_rate_limit_requests <= 1000 &&
        var.checkout_rate_limit_window_ms >= 1000 &&
        var.checkout_rate_limit_window_ms <= 3600000 &&
        var.checkout_rate_limit_max_keys > 0 &&
        var.checkout_rate_limit_max_keys <= 100000
      )
      error_message = "Checkout production policy or limits are missing or outside the service's accepted range."
    }
  }
}

# Checkout migration is a deliberately separate Cloudant-only job. It can create
# and verify the Mango index before PayPal credentials exist, and it cannot call
# the payment provider because those secrets are never bound to this job.
resource "ibm_code_engine_job" "checkout_migration" {
  for_each = local.checkout_job_services

  project_id = ibm_code_engine_project.project.project_id
  name       = "${each.key}-checkout-migration"

  image_reference = "us.icr.io/${var.cr_namespace}/${each.key}:${coalesce(each.value.image_tag, var.image_tag)}"
  image_secret    = ibm_code_engine_secret.cr_secret.name

  run_commands                       = ["node"]
  run_arguments                      = ["dist/pos-api/src/checkout-migration-job.js"]
  run_compute_resource_token_enabled = false
  run_mode                           = "task"
  run_service_account                = "none"
  scale_cpu_limit                    = var.checkout_job_cpu_limit
  scale_memory_limit                 = var.checkout_job_memory_limit
  scale_max_execution_time           = var.checkout_migration_max_execution_seconds
  scale_retry_limit                  = var.checkout_migration_retry_limit

  run_env_variables {
    type  = "literal"
    name  = "NODE_ENV"
    value = "production"
  }

  run_env_variables {
    type  = "literal"
    name  = "CLOUDANT_CHECKOUTS_DB"
    value = "checkouts"
  }

  run_env_variables {
    type      = "secret_key_reference"
    name      = "CLOUDANT_URL"
    key       = "CLOUDANT_URL"
    reference = ibm_code_engine_secret.cloudant_migration_creds[each.key].name
  }

  run_env_variables {
    type      = "secret_key_reference"
    name      = "CLOUDANT_APIKEY"
    key       = "CLOUDANT_APIKEY"
    reference = ibm_code_engine_secret.cloudant_migration_creds[each.key].name
  }

  lifecycle {
    precondition {
      condition = (
        var.checkout_migration_max_execution_seconds > 0 &&
        var.checkout_migration_max_execution_seconds <= 3600 &&
        var.checkout_migration_retry_limit >= 0 &&
        var.checkout_migration_retry_limit <= 10
      )
      error_message = "Checkout migration timeout or retry limit is outside the accepted Code Engine job bounds."
    }
  }

  depends_on = [ibm_cloudant_database.checkouts]
}

# Reconciliation runs the same lease-fenced, idempotent state machine as client
# completion. This resource defines the bounded job; the provider has no cron
# subscription resource, so the post-apply schedule is documented in README.md.
resource "ibm_code_engine_job" "checkout_reconciliation" {
  for_each = local.checkout_job_services

  project_id = ibm_code_engine_project.project.project_id
  name       = "${each.key}-checkout-reconciliation"

  image_reference = "us.icr.io/${var.cr_namespace}/${each.key}:${coalesce(each.value.image_tag, var.image_tag)}"
  image_secret    = ibm_code_engine_secret.cr_secret.name

  run_commands                       = ["node"]
  run_arguments                      = ["dist/pos-api/src/checkout-reconciliation-job.js"]
  run_compute_resource_token_enabled = false
  run_mode                           = "task"
  run_service_account                = "none"
  scale_cpu_limit                    = var.checkout_job_cpu_limit
  scale_memory_limit                 = var.checkout_job_memory_limit
  scale_max_execution_time           = var.checkout_reconciliation_max_execution_seconds
  scale_retry_limit                  = var.checkout_reconciliation_retry_limit

  dynamic "run_env_variables" {
    for_each = {
      NODE_ENV                         = "production"
      CLOUDANT_CHECKOUTS_DB            = "checkouts"
      CLOUDANT_PRODUCTS_DB             = "products"
      CLOUDANT_TRANSACTIONS_DB         = "transactions"
      CHECKOUT_STORE_ID                = var.checkout_store_id
      PAYPAL_EXPECTED_MERCHANT_ID      = var.paypal_expected_merchant_id
      PAYPAL_CLIENT_ID                 = var.paypal_client_id
      PAYPAL_ENVIRONMENT               = var.paypal_environment
      PAYPAL_TIMEOUT_MS                = tostring(var.paypal_timeout_ms)
      CHECKOUT_CURRENCY                = var.checkout_currency
      CHECKOUT_TAX_BASIS_POINTS        = tostring(var.checkout_tax_basis_points)
      CHECKOUT_MAX_ITEM_QUANTITY       = tostring(var.checkout_max_item_quantity)
      CHECKOUT_MAX_AGGREGATE_QUANTITY  = tostring(var.checkout_max_aggregate_quantity)
      CHECKOUT_MAX_TOTAL_MINOR_UNITS   = tostring(var.checkout_max_total_minor_units)
      CHECKOUT_IDEMPOTENCY_KEY_VERSION = var.checkout_idempotency_key_version
      CHECKOUT_CAPABILITY_KEY_VERSION  = var.checkout_capability_key_version
      CHECKOUT_WORKER_MAX_CHECKOUTS    = tostring(var.checkout_worker_max_checkouts)
      CHECKOUT_WORKER_PAGE_SIZE        = tostring(var.checkout_worker_page_size)
      CHECKOUT_WORKER_MAX_DURATION_MS  = tostring(var.checkout_worker_max_duration_ms)
    }

    content {
      type  = "literal"
      name  = run_env_variables.key
      value = run_env_variables.value
    }
  }

  dynamic "run_env_variables" {
    for_each = toset(["CLOUDANT_URL", "CLOUDANT_APIKEY"])

    content {
      type      = "secret_key_reference"
      name      = run_env_variables.key
      key       = run_env_variables.key
      reference = ibm_code_engine_secret.cloudant_creds[each.key].name
    }
  }

  dynamic "run_env_variables" {
    for_each = toset([
      "PAYPAL_CLIENT_SECRET",
      "CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON",
      "CHECKOUT_CAPABILITY_HMAC_KEYS_JSON",
    ])

    content {
      type      = "secret_key_reference"
      name      = run_env_variables.key
      key       = run_env_variables.key
      reference = ibm_code_engine_secret.checkout[each.key].name
    }
  }

  lifecycle {
    precondition {
      condition = (
        var.checkout_worker_max_checkouts > 0 &&
        var.checkout_worker_max_checkouts <= 1000 &&
        var.checkout_worker_page_size > 0 &&
        var.checkout_worker_page_size <= 100 &&
        var.checkout_worker_max_duration_ms > 0 &&
        var.checkout_worker_max_duration_ms <= 900000 &&
        var.checkout_reconciliation_max_execution_seconds > 0 &&
        var.checkout_reconciliation_max_execution_seconds <= 3600 &&
        var.checkout_worker_max_duration_ms < var.checkout_reconciliation_max_execution_seconds * 1000 &&
        var.checkout_reconciliation_retry_limit >= 0 &&
        var.checkout_reconciliation_retry_limit <= 10
      )
      error_message = "Checkout worker bounds are invalid, or its application deadline does not leave room before the Code Engine timeout."
    }
  }

  depends_on = [ibm_code_engine_job.checkout_migration]
}

# Code Engine Applications
resource "ibm_code_engine_app" "apps" {
  for_each = var.services

  project_id = ibm_code_engine_project.project.project_id
  name       = each.key

  image_reference = "us.icr.io/${var.cr_namespace}/${each.key}:${coalesce(each.value.image_tag, var.image_tag)}"
  image_secret    = ibm_code_engine_secret.cr_secret.name

  # What the container actually listens on: 8080 for the nginx frontend, 8787,
  # 8789, 8790 and 8792 for the four backend services, which default to those
  # ports in their own `server.ts`. A mismatch here is a revision that never
  # passes its port check.
  image_port = each.value.image_port

  scale_min_instances     = each.value.scale_min_instances
  scale_max_instances     = each.value.scale_max_instances
  scale_cpu_limit         = each.value.scale_cpu_limit
  scale_memory_limit      = each.value.scale_memory_limit
  scale_initial_instances = each.value.scale_initial_instances

  dynamic "run_env_variables" {
    for_each = local.service_env[each.key]

    content {
      type  = "literal"
      name  = run_env_variables.key
      value = run_env_variables.value
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_model_key ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "ANTHROPIC_API_KEY"
      key       = "ANTHROPIC_API_KEY"
      reference = ibm_code_engine_secret.model_key[each.key].name
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_session_secret ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "SESSION_JWT_SECRET"
      key       = "SESSION_JWT_SECRET"
      reference = ibm_code_engine_secret.session_jwt[0].name
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_cloudant ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "CLOUDANT_URL"
      key       = "CLOUDANT_URL"
      reference = ibm_code_engine_secret.cloudant_creds[each.key].name
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_cloudant ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "CLOUDANT_APIKEY"
      key       = "CLOUDANT_APIKEY"
      reference = ibm_code_engine_secret.cloudant_creds[each.key].name
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_checkout ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "PAYPAL_CLIENT_SECRET"
      key       = "PAYPAL_CLIENT_SECRET"
      reference = ibm_code_engine_secret.checkout[each.key].name
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_checkout ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON"
      key       = "CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON"
      reference = ibm_code_engine_secret.checkout[each.key].name
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_checkout ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "CHECKOUT_CAPABILITY_HMAC_KEYS_JSON"
      key       = "CHECKOUT_CAPABILITY_HMAC_KEYS_JSON"
      reference = ibm_code_engine_secret.checkout[each.key].name
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_appid_secret ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "APPID_CLIENT_SECRET"
      key       = "APPID_CLIENT_SECRET"
      reference = ibm_code_engine_secret.appid_secret[each.key].name
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_appid_secret ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "APPID_MANAGEMENT_APIKEY"
      key       = "APPID_MANAGEMENT_APIKEY"
      reference = ibm_code_engine_secret.appid_secret[each.key].name
    }
  }

  # The customer application's confidential-client secret. The value already
  # lives in the relay's Code Engine secret above; this binding is what makes it
  # available to customer-token.ts without ever placing it in Terraform output,
  # a literal environment value, or the browser bundle.
  dynamic "run_env_variables" {
    # Gate on the non-sensitive paired ID: the lifecycle precondition guarantees
    # the customer secret is present whenever this value is non-empty.
    for_each = each.value.needs_appid_secret && var.appid_customer_client_id != "" ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "APPID_CUSTOMER_CLIENT_SECRET"
      key       = "APPID_CUSTOMER_CLIENT_SECRET"
      reference = ibm_code_engine_secret.appid_secret[each.key].name
    }
  }

  dynamic "run_env_variables" {
    for_each = each.value.needs_internal_secret ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "INTERNAL_API_SECRET"
      key       = "INTERNAL_API_SECRET"
      reference = ibm_code_engine_secret.internal_secret[0].name
    }
  }

  # `pins_cors_origins` needs two values, and until now only one of them failed the
  # plan when missing: `frontend_origins` — required by the flag, and defaulting to
  # `[]` — had no precondition of its own. So a stock `terraform apply` planned clean
  # and then deployed a revision that exit(1)s on the missing variable, which surfaces
  # as a scaling failure rather than as the configuration mistake it is.
  #
  # Here rather than on a secret because origins are a literal env var, so there is no
  # secret resource of their own to hang it from. The condition short-circuits only
  # for services that do not expose a cross-origin browser API.
  lifecycle {
    precondition {
      condition     = !each.value.pins_cors_origins || local.allowed_origins != ""
      error_message = <<-EOT
        ${each.key} sets pins_cors_origins, so it needs TF_VAR_frontend_origins:
        without it the container refuses to start rather than answer every origin.
        The frontend's URL is an output of this same apply, so on a first deploy:
          1. apply the frontend alone, with
             terraform apply -var 'services={"capy-pos-app"={image_port=8080}}'
          2. read its URL, with: terraform output -raw app_url
          3. set TF_VAR_frontend_origins to that URL as a one-element JSON list
          4. terraform apply
        Already know the origin (redeploy, or a custom domain)? Set it and apply once.
        See "Two-pass apply" in terraform/README.md.
      EOT
    }
  }
}
