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
  # Deliberately separate from `needs_session_secret`: pos-api verifies the same
  # session token the two proxies do, but (unlike them) answers every origin itself
  # (`'Access-Control-Allow-Origin': '*'` in its own `server.ts`) and reads no
  # `ALLOWED_ORIGINS` at all — binding it there would be dead config, and worse,
  # would drag pos-api into the two-pass-apply dance below for a check it never
  # performs.
  service_env = {
    for name, service in var.services : name => merge(
      { NODE_ENV = "production" },
      service.pins_cors_origins ? { ALLOWED_ORIGINS = local.allowed_origins } : {},
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
resource "ibm_resource_key" "cloudant_key" {
  name                 = "${var.project_name}-cloudant-key"
  role                 = "Manager"
  resource_instance_id = ibm_cloudant.store.id
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
  cloudant_credentials = jsondecode(ibm_resource_key.cloudant_key.credentials_json)
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
    CLOUDANT_URL    = local.cloudant_credentials.url
    CLOUDANT_APIKEY = local.cloudant_credentials.apikey
  }
}

# Code Engine Applications
resource "ibm_code_engine_app" "apps" {
  for_each = var.services

  project_id = ibm_code_engine_project.project.project_id
  name       = each.key

  image_reference = "us.icr.io/${var.cr_namespace}/${each.key}:${coalesce(each.value.image_tag, var.image_tag)}"
  image_secret    = ibm_code_engine_secret.cr_secret.name

  # What the container actually listens on: 8080 for the nginx frontend, 8787 and
  # 8789 for the two proxies, which default to those ports in their own
  # `server.ts`. A mismatch here is a revision that never passes its port check.
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

  # `pins_cors_origins` needs two values, and until now only one of them failed the
  # plan when missing: `frontend_origins` — required by the flag, and defaulting to
  # `[]` — had no precondition of its own. So a stock `terraform apply` planned clean
  # and then deployed a revision that exit(1)s on the missing variable, which surfaces
  # as a scaling failure rather than as the configuration mistake it is.
  #
  # Here rather than on a secret because origins are a literal env var, so there is no
  # secret resource of their own to hang it from. The condition short-circuits for
  # every service that does not pin CORS — the frontend, and (deliberately) pos-api,
  # which answers every origin itself and needs no origins list.
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
