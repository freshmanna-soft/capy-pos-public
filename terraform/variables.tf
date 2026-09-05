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
  description = "Container image tag applied to every service that does not override it"
  type        = string
  default     = "latest"
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
    # `frontend_origins` to be set (see the precondition in main.tf). Separate from
    # `needs_session_secret` because pos-api verifies the same session token the two
    # proxies do but, unlike them, answers every origin itself and reads no
    # ALLOWED_ORIGINS at all.
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
    # Binds INTERNAL_API_SECRET from the shared internal-secret Code Engine
    # secret — for a service that either answers or calls a service-to-service
    # route with no end-user token (pos-api's GET /internal/roles today; the
    # two proxies calling it). Same shared-secret shape as
    # needs_session_secret, deliberately separate: this gates machine-to-
    # machine calls between Code Engine apps, not a browser-issued session.
    needs_internal_secret   = optional(bool, false)
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
    capy-vision-proxy = {
      image_port               = 8787
      needs_model_key          = true
      needs_session_secret     = true
      needs_appid_verification = true
      # Fetches role→permission mappings from pos-api's GET /internal/roles
      # (Phase 5 RBAC centralization) instead of hand-copying its own table.
      needs_internal_secret = true
      pins_cors_origins     = true
    }
    # infra/clerk-agent-relay — one agent hop, holding tools that change a cart.
    capy-clerk-agent-relay = {
      image_port               = 8789
      needs_model_key          = true
      needs_session_secret     = true
      needs_appid_verification = true
      needs_internal_secret    = true
      pins_cors_origins        = true
    }
    # infra/pos-api — products/transactions/health, over Cloudant. Verifies the same
    # session token the two proxies do, but answers every origin itself
    # ('Access-Control-Allow-Origin: *' in its own server.ts) so it does not set
    # `pins_cors_origins` and needs no `frontend_origins` — a genuine one-pass,
    # deploy-this-alone-first service.
    capy-pos-api = {
      image_port               = 8790
      needs_session_secret     = true
      needs_appid_verification = true
      needs_cloudant           = true
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
}
