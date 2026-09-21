variable "ibmcloud_api_key" {
  description = "IBM Cloud API key"
  type        = string
  sensitive   = true
}

variable "region" {
  description = "IBM Cloud region"
  type        = string
  default     = "us-south"
}

variable "resource_group_name" {
  description = "IBM Cloud resource group name"
  type        = string
  default     = "Default"
}

variable "project_name" {
  description = "Code Engine project name"
  type        = string
  default     = "capy-pos"
}

variable "image_tag" {
  description = "Explicit immutable container image tag applied to every service that does not override it"
  type        = string

  validation {
    condition = (
      length(trimspace(var.image_tag)) > 0 &&
      lower(trimspace(var.image_tag)) != "latest" &&
      can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", var.image_tag))
    )
    error_message = "image_tag must be an explicit immutable image tag, not latest."
  }
}

variable "cr_namespace" {
  # IBM Container Registry namespace names are unique across every IBM Cloud
  # account in the region, not just this one — "capy-pos" was already taken by
  # someone else, so the default carries this account's own number.
  description = "IBM Container Registry namespace holding every service image"
  type        = string
  default     = "capy-pos-3223793"
}

variable "anthropic_api_key" {
  description = <<-EOT
    Model API key for the services that call Claude. Bound as a Code Engine secret,
    never as a literal env var. Leave unset only when no service in `services` sets
    `needs_model_key` — the secret's precondition fails loudly rather than deploying
    a proxy that 502s on its first frame.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}

variable "anthropic_base_url" {
  description = <<-EOT
    Optional override for the Anthropic SDK's base URL, e.g. an IBM litellm gateway
    (`https://api.servicesessentials.ibm.com`) instead of the real `api.anthropic.com`.
    `new Anthropic()` in both vision-proxy and clerk-agent-relay already reads
    `ANTHROPIC_BASE_URL` from its own environment natively — no code change either
    side of this switch. Not sensitive (a URL, not a credential), so it is a literal
    env var, unlike `anthropic_api_key`. Leave unset to call the real API directly;
    `anthropic_api_key` must then be a real Anthropic key either way — the gateway
    and the real API are not expected to accept the same key.
  EOT
  type        = string
  default     = ""
}

variable "session_jwt_secret" {
  description = <<-EOT
    HS256 secret the proxies verify browser session tokens against. Must equal what
    `getJwtSecret()` in src/app/core/infrastructure/auth/session-issuer.ts uses, or
    every till gets a 401. It is shared with a public browser bundle today, so it
    bounds reachability, not identity — see the auth note in README.md.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}

variable "appid_region" {
  description = "IBM Cloud region the App ID tenant lives in. Not sensitive — see appid_client_id."
  type        = string
  default     = "us-south"
}

variable "appid_tenant_id" {
  description = <<-EOT
    App ID tenant (instance) id, e.g. from `ibmcloud resource service-instance
    <name> --output json`. Not sensitive — it identifies the tenant, the same way
    Cognito's pool id is committed in plaintext in environment.*.ts; only the
    client *secret* below is a credential.
  EOT
  type        = string
  default     = ""
}

variable "appid_client_id" {
  description = <<-EOT
    App ID staff application's client id (the "Resource Owner Password" or
    equivalent app registered in the App ID instance's Applications tab). Not
    sensitive, same reasoning as appid_tenant_id — matches the value committed in
    environment.*.ts's `appId.staffClientId`.
  EOT
  type        = string
  default     = ""
}

variable "appid_customer_client_id" {
  description = <<-EOT
    The CUSTOMER App ID application's client id (epic #261 item 25). Not sensitive,
    same reasoning as appid_client_id — it is the `aud` a customer token carries,
    and it is already committed in `environment.*.ts` as
    `appId.customerClientId`.

    Staff and customers share one App ID *tenant* and are separated by being two
    distinct App ID *applications*: the client a grant is exchanged under decides
    the scopes the resulting token carries. What keeps a customer token out of the
    staff gateway is the audience binding, not secrecy.

    Provisioned 2026-09-11 as `capy-pos-customer`, type `regularwebapp` — a
    `singlepageapp` is WRONG here because it gets no client secret, and the relay
    performs a confidential-client password grant.

    MUST be set together with appid_customer_client_secret. See the precondition
    on ibm_code_engine_secret.appid_secret.
  EOT
  type        = string
  default     = ""
}

variable "appid_customer_client_secret" {
  description = <<-EOT
    The CUSTOMER App ID application's client secret (epic #261 item 25). Bound as
    a Code Engine secret, never a literal env var, exactly like
    appid_client_secret.

    MUST be set together with appid_customer_client_id. `customer-token.ts`
    refuses to serve `/appid/customer/token` unless BOTH are present, and it is
    right to: exchanging a customer grant under any other client would hand the
    caller staff scopes. Half-configured is a startup failure, not a degraded
    mode — which is why the precondition below rejects it at plan time rather
    than letting Code Engine discover it.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}

variable "appid_client_secret" {
  description = <<-EOT
    The one genuinely sensitive App ID value: the staff application's client
    secret. `infra/appid-token-relay` exists specifically so this never has to
    live in the browser bundle — App ID's token endpoint requires
    `Authorization: Basic base64(clientId:clientSecret)` on every call, unlike
    Cognito's public-client grant. Bound as a Code Engine secret, never a literal
    env var.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}

variable "appid_management_api_key" {
  description = <<-EOT
    An IBM Cloud API key scoped to just this App ID service instance (least
    privilege — not the broad Terraform account key in ibmcloud_api_key above).
    Used only by infra/appid-token-relay's admin-only staff-management routes
    (Phase 3d) to call App ID's Management API — create/list Cloud Directory
    users, assign roles, trigger the reset-password email. Created once, by
    hand, the same one-time out-of-band way appid_tenant_id's tenant itself was
    provisioned. Left empty, sign-in keeps working exactly as before; only the
    admin staff-management routes fail once an authorized caller reaches them.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}

variable "paypal_client_id" {
  description = "PayPal REST application client id for server-owned checkout. Not a secret; the client secret is separate."
  type        = string
  default     = ""
}

variable "paypal_client_secret" {
  description = "PayPal REST application client secret for server-owned checkout. Bound through Code Engine secrets only."
  type        = string
  sensitive   = true
  default     = ""
}

variable "paypal_expected_merchant_id" {
  description = "PayPal merchant id that every order, authorization, and capture must match."
  type        = string
  default     = ""
}

variable "checkout_store_id" {
  description = "Trusted store identifier bound into every server-owned checkout."
  type        = string
  default     = ""
}

variable "checkout_idempotency_hmac_keys" {
  description = "Versioned checkout idempotency HMAC keyring. Retain old versions through the checkout retention window."
  type        = map(string)
  sensitive   = true
  default     = {}
}

variable "checkout_capability_hmac_keys" {
  description = "Versioned checkout capability HMAC keyring. Retain old versions through the checkout retention window."
  type        = map(string)
  sensitive   = true
  default     = {}
}

variable "checkout_idempotency_key_version" {
  description = "Active version in checkout_idempotency_hmac_keys."
  type        = string
  default     = ""
}

variable "checkout_capability_key_version" {
  description = "Active version in checkout_capability_hmac_keys."
  type        = string
  default     = ""
}

variable "checkout_currency" {
  description = "Approved checkout currency. The current service supports USD only."
  type        = string
  default     = ""
}

variable "checkout_tax_basis_points" {
  description = "Approved checkout tax rate in basis points."
  type        = number
  default     = -1
}

variable "checkout_max_item_quantity" {
  description = "Maximum quantity accepted for one checkout line."
  type        = number
  default     = 10000
}

variable "checkout_max_aggregate_quantity" {
  description = "Maximum aggregate quantity accepted for one checkout."
  type        = number
  default     = 50000
}

variable "checkout_max_total_minor_units" {
  description = "Maximum server-computed checkout total in minor currency units."
  type        = number
  default     = 100000000
}

variable "paypal_environment" {
  description = "PayPal API environment for the production service. Must be production."
  type        = string
  default     = "production"
}

variable "paypal_timeout_ms" {
  description = "Finite timeout in milliseconds for each PayPal SDK operation."
  type        = number
  default     = 10000
}

variable "checkout_rate_limit_requests" {
  description = "Maximum checkout HTTP requests allowed per client address in one fixed window."
  type        = number
  default     = 60
}

variable "checkout_rate_limit_window_ms" {
  description = "Fixed checkout HTTP rate-limit window in milliseconds."
  type        = number
  default     = 60000
}

variable "checkout_rate_limit_max_keys" {
  description = "Maximum client-address buckets retained by one POS API instance."
  type        = number
  default     = 10000
}

variable "checkout_worker_max_checkouts" {
  description = "Maximum due checkouts attempted by one reconciliation job run."
  type        = number
  default     = 100
}

variable "checkout_worker_page_size" {
  description = "Maximum due checkouts loaded per reconciliation page."
  type        = number
  default     = 50
}

variable "checkout_worker_max_duration_ms" {
  description = "Wall-clock budget enforced by the reconciliation worker before starting another checkout."
  type        = number
  default     = 240000
}

variable "checkout_job_cpu_limit" {
  description = "CPU allocated to each checkout migration or reconciliation job instance."
  type        = string
  default     = "0.5"
}

variable "checkout_job_memory_limit" {
  description = "Memory allocated to each checkout migration or reconciliation job instance."
  type        = string
  default     = "1G"
}

variable "checkout_migration_max_execution_seconds" {
  description = "Code Engine timeout for the one-shot checkout index migration."
  type        = number
  default     = 300
}

variable "checkout_migration_retry_limit" {
  description = "Code Engine retries for the idempotent checkout index migration."
  type        = number
  default     = 2
}

variable "checkout_reconciliation_max_execution_seconds" {
  description = "Code Engine timeout for one checkout reconciliation run. Must exceed the worker's own wall-clock budget."
  type        = number
  default     = 300
}

variable "checkout_reconciliation_retry_limit" {
  description = "Code Engine retries after a reconciliation run exits non-zero."
  type        = number
  default     = 2
}

variable "checkout_reconciliation_schedule" {
  description = "Five-field cron schedule applied out of band because the IBM Terraform provider exposes the job but no Code Engine cron-subscription resource."
  type        = string
  default     = "*/5 * * * *"

  validation {
    condition = (
      length(trimspace(var.checkout_reconciliation_schedule)) > 0 &&
      !strcontains(var.checkout_reconciliation_schedule, "\n") &&
      !strcontains(var.checkout_reconciliation_schedule, "\r")
    )
    error_message = "checkout_reconciliation_schedule must be a non-empty single-line cron expression."
  }
}

variable "checkout_reconciliation_time_zone" {
  description = "IANA time zone for the out-of-band Code Engine cron subscription."
  type        = string
  default     = "UTC"

  validation {
    condition     = can(regex("^[A-Za-z0-9_+\\-/]+$", var.checkout_reconciliation_time_zone))
    error_message = "checkout_reconciliation_time_zone must be a non-empty IANA-style time-zone label."
  }
}

variable "checkout_v2_writes_enabled" {
  description = <<-EOT
    Enables V2 checkout, claim, transaction, and receipt writes only after every
    running pos-api instance can read both V1 and V2. Leave false for the mandatory
    compatibility release. Rollback after enabling this flag must target that
    compatibility release, never a V1-only image.
  EOT
  type        = bool
  default     = false
}

variable "customer_loyalty_enabled" {
  description = <<-EOT
    Enables authenticated server-owned loyalty after V2 writes, the profile and
    ledger databases, both loyalty indexes, reconciliation, privacy projections,
    monitoring, and recovery runbooks have been verified. This flag may be true
    only when checkout_v2_writes_enabled is also true.
  EOT
  type        = bool
  default     = false
}

variable "internal_api_secret" {
  description = <<-EOT
    Shared secret for service-to-service calls that have no end-user token to
    check — today just pos-api's GET /internal/roles, which vision-proxy and
    clerk-agent-relay call to resolve role→permission mappings instead of each
    hand-copying its own table (RBAC centralization, Phase 5). Same pattern as
    session_jwt_secret above: one value, known only to the services that need
    it, bound as a Code Engine secret, never shipped to a browser.

    Confirmed there is no other service-to-service auth anywhere in this
    estate — every app in `services` below answers on a plain public HTTPS
    endpoint, reachable from anywhere, not just from its siblings — so this is
    the one thing standing between /internal/roles and any caller on the
    internet. Generate with the same method used for session_jwt_secret
    (e.g. `openssl rand -hex 32`), never hand-typed.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}

variable "pos_api_internal_url" {
  description = <<-EOT
    pos-api's own GET /internal/roles endpoint (e.g. "https://capy-pos-api.…
    .codeengine.appdomain.cloud/internal/roles"), for vision-proxy and
    clerk-agent-relay to fetch the shared roles document from (Phase 5, RBAC
    centralization). pos-api's own Code Engine URL is only known after that
    app's first apply — same two-pass-apply category as frontend_origins —
    except this one is optional: left unset, both proxies simply keep
    answering from their own local ROLE_PERMISSIONS fallback, exactly
    today's behaviour, rather than refusing to start. Set it and apply again
    once `terraform output -raw pos_api_url` has a real value.
  EOT
  type        = string
  default     = ""
}

variable "frontend_origins" {
  description = <<-EOT
    Browser origins the guarded services will answer. Scheme and host only, no
    path and no trailing slash: it is compared against the request's `Origin`
    header verbatim. On a fresh estate this is unset on the first apply — the
    Code Engine frontend's URL is an output of that apply — then set and apply
    again; see README.md.

    Defaulted to this estate's two real production frontends (issue #206/#221):
    the original GitHub Pages site and the capy-pos-app Code Engine app. Override
    with TF_VAR_frontend_origins for a different estate/project, where the Code
    Engine hostname will differ.

    Origin-only, so this list is per *site*, not per route: every route of the
    Angular app — /pos, /clerk, /self-checkout — sends one of these exact values
    as its `Origin`, and adding a route needs nothing here (issue #281 confirmed
    that against the live relay for /self-checkout). Adding a separately-deployed
    frontend does. `cors.test.mjs` in infra/appid-token-relay reads this default
    and asserts both properties.
  EOT
  type        = list(string)
  default = [
    "https://freshmanna-soft.github.io",
    "https://capy-pos-app.2e2tmn0h4vl7.us-south.codeengine.appdomain.cloud",
  ]

  validation {
    condition     = alltrue([for origin in var.frontend_origins : can(regex("^https?://[^/]+$", origin))])
    error_message = "Each origin must be scheme://host[:port] with no path or trailing slash."
  }
}

variable "services" {
  description = <<-EOT
    Every app in the Code Engine project, keyed by app name — which is also its
    image name in `cr_namespace`. Add an app by adding an entry; the loop in main.tf
    handles the rest.
  EOT

  type = map(object({
    # The port the container's own server listens on.
    image_port = number
    # Overrides `var.image_tag` for one service, for a canary or a rollback.
    image_tag = optional(string)
    # Binds ANTHROPIC_API_KEY from a per-app generic secret.
    needs_model_key = optional(bool, false)
    # Verifies the browser's session token: binds SESSION_JWT_SECRET.
    needs_session_secret = optional(bool, false)
    # Pins CORS to `frontend_origins`: binds ALLOWED_ORIGINS, and requires
    # `frontend_origins` to be set (see the precondition in main.tf).
    pins_cors_origins = optional(bool, false)
    # Binds CLOUDANT_URL and CLOUDANT_APIKEY from the shared Cloudant instance's
    # per-app secret.
    needs_cloudant = optional(bool, false)
    # Binds APPID_REGION/APPID_TENANT_ID/APPID_CLIENT_ID as literal env and
    # APPID_CLIENT_SECRET from a per-app secret. Only infra/appid-token-relay sets
    # this — it is the one service that ever holds the App ID client secret.
    needs_appid_secret = optional(bool, false)
    # Binds the same three literals (APPID_REGION/APPID_TENANT_ID/APPID_CLIENT_ID)
    # but never a secret — for a service that *verifies* App ID's RS256 access
    # tokens (pos-api, the two proxies) rather than minting them. Separate from
    # `needs_appid_secret` on purpose: giving pos-api the client secret would be
    # a real credential it has no reason to hold, for a capability (verification)
    # that only ever needs the tenant's public JWKS.
    needs_appid_verification = optional(bool, false)
    # Binds only the CUSTOMER application's non-secret client id as a second,
    # customer-only verification audience. It never binds the customer client
    # secret and does not widen the generic staff verifier.
    needs_customer_verification = optional(bool, false)
    # Declares this service as the owner of durable server-side loyalty storage,
    # index migration, and feature flags. It requires checkout, Cloudant, and the
    # dedicated customer verifier (validated below).
    needs_customer_loyalty = optional(bool, false)
    # Binds INTERNAL_API_SECRET from the shared internal-secret Code Engine
    # secret — for a service that either answers or calls a service-to-service
    # route with no end-user token (pos-api's GET /internal/roles today; the
    # two proxies calling it). Same shared-secret shape as
    # needs_session_secret, deliberately separate: this gates machine-to-
    # machine calls between Code Engine apps, not a browser-issued session.
    needs_internal_secret   = optional(bool, false)
    needs_checkout          = optional(bool, false)
    scale_min_instances     = optional(number, 0)
    scale_max_instances     = optional(number, 2)
    scale_initial_instances = optional(number, 1)
    scale_cpu_limit         = optional(string, "0.5")
    scale_memory_limit      = optional(string, "1G")
    # Extra literal env vars. Merged last, so it can override NODE_ENV.
    env = optional(map(string), {})
  }))

  default = {
    # Angular build served by nginx — the root Dockerfile. Scaled to zero like the
    # rest: this is a demo estate, not a storefront with a warm-start SLO.
    #
    # image_tag pinned here rather than left on the global default, so this
    # service's own rebuilds (most recently: v7, shipping the "Forgot
    # password?" link, #253) don't require bumping every other service's tag
    # too, and vice versa.
    capy-pos-app = {
      image_port = 8080
      image_tag  = "v7"
    }
    # infra/vision-proxy — one frame in, candidate products out.
    #
    # needs_appid_verification is not yet load-bearing: environment.appId.enabled
    # is false everywhere, so no RS256 token reaches this service in practice.
    # It's set now so that flag flip needs no accompanying Terraform change.
    #
    # image_tag pinned here for the first time (previously unpinned, riding
    # the global default): v3 ships Phase 5's roles-fetch-and-cache logic
    # (#256) — pinning now so this service's own future rebuilds don't force
    # capy-clerk-agent-relay/capy-pos-api to redeploy too, and vice versa.
    capy-vision-proxy = {
      image_port               = 8787
      image_tag                = "v3"
      needs_model_key          = true
      needs_session_secret     = true
      needs_appid_verification = true
      # Fetches role→permission mappings from pos-api's GET /internal/roles
      # (Phase 5 RBAC centralization) instead of hand-copying its own table.
      needs_internal_secret = true
      pins_cors_origins     = true
    }
    # infra/clerk-agent-relay — one agent hop, holding tools that change a cart.
    #
    # image_tag pinned for the same reason capy-vision-proxy's own pin is:
    # v3 ships the identical Phase 5 roles-fetch logic (#256), since the two
    # services' session-guard.ts stay byte-identical.
    capy-clerk-agent-relay = {
      image_port               = 8789
      image_tag                = "v3"
      needs_model_key          = true
      needs_session_secret     = true
      needs_appid_verification = true
      needs_internal_secret    = true
      pins_cors_origins        = true
    }
    # infra/pos-api — products/transactions/health and public checkout, over Cloudant.
    # Checkout capabilities replace staff sessions on the public checkout routes, but
    # every browser route still pins CORS to the known frontend origins. This service
    # deliberately uses var.image_tag so its API and checkout job entry points always
    # come from the same explicitly selected image build.
    capy-pos-api = {
      image_port                  = 8790
      needs_session_secret        = true
      needs_appid_verification    = true
      needs_customer_verification = true
      needs_customer_loyalty      = true
      needs_cloudant              = true
      needs_checkout              = true
      pins_cors_origins           = true
      # Serves GET /internal/roles for the two proxies (Phase 5 RBAC
      # centralization) — gated by this shared secret, since that route has
      # no end-user token to check.
      needs_internal_secret = true
    }
    # infra/appid-token-relay — holds the App ID client secret so the browser
    # bundle never has to. Not a "session-guarded" service in the
    # needs_session_secret sense: it verifies nothing (it issues the very
    # session a caller doesn't have yet) — pins_cors_origins alone is what
    # keeps an unlisted page from spending sign-in attempts against the tenant.
    #
    # image_tag pinned here for the same reason capy-pos-app's own pin is:
    # v6 adds the public /appid/forgot-password route (#253) — a genuine
    # self-service password-reset flow for an already-confirmed account,
    # not the doomed at-creation-time call v5 removed. (v5 dropped
    # forgot_password from staff creation, #249 — it 409s unconditionally
    # against a freshly sign_up'd, not-yet-confirmed account. v4 fixed role
    # operations to use the profile sub, not the SCIM id, #247; v3 shipped
    # the admin-only /appid/admin/* routes, #244/#245; v2 replaced an arm64
    # image that could never start on Code Engine's amd64 nodes.)
    capy-appid-token-relay = {
      image_port         = 8792
      image_tag          = "v6"
      needs_appid_secret = true
      pins_cors_origins  = true
    }
  }

  validation {
    condition     = alltrue([for service in var.services : service.image_port > 0 && service.image_port < 65536])
    error_message = "Each service's image_port must be a valid TCP port."
  }

  validation {
    condition = alltrue([
      for service in var.services : service.image_tag == null ? true : (
        length(trimspace(service.image_tag)) > 0 &&
        lower(trimspace(service.image_tag)) != "latest" &&
        can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", service.image_tag))
      )
    ])
    error_message = "Every service image_tag override must be an explicit immutable image tag, not latest."
  }

  validation {
    condition = alltrue([
      for service in var.services :
      !service.needs_checkout || (service.needs_cloudant && service.pins_cors_origins)
    ])
    error_message = "Every checkout service must enable Cloudant and pin CORS to frontend_origins."
  }

  validation {
    condition = alltrue([
      for service in var.services :
      !service.needs_customer_verification || (
        service.needs_appid_verification &&
        service.needs_checkout &&
        !service.needs_appid_secret
      )
    ])
    error_message = "Customer verification is checkout-specific, requires the existing staff App ID verifier configuration plus checkout, and must never receive App ID client secrets."
  }

  validation {
    condition = alltrue([
      for service in var.services :
      !service.needs_customer_loyalty || (
        service.needs_customer_verification &&
        service.needs_checkout &&
        service.needs_cloudant
      )
    ])
    error_message = "Every customer-loyalty service must enable dedicated customer verification, checkout, and Cloudant."
  }

  validation {
    condition = alltrue([
      for name, service in var.services :
      !service.needs_customer_verification || name == "capy-pos-api"
    ])
    error_message = "The customer verification audience may be bound only to capy-pos-api."
  }
}
