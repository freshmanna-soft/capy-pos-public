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
    scale_min_instances      = optional(number, 0)
    scale_max_instances      = optional(number, 2)
    scale_initial_instances  = optional(number, 1)
    scale_cpu_limit          = optional(string, "0.5")
    scale_memory_limit       = optional(string, "1G")
    # Extra literal env vars. Merged last, so it can override NODE_ENV.
    env = optional(map(string), {})
  }))

  default = {
    # Angular build served by nginx — the root Dockerfile. Scaled to zero like the
    # rest: this is a demo estate, not a storefront with a warm-start SLO.
    #
    # image_tag pinned here rather than left on the global default, so this
    # service's own rebuilds (most recently: v4, shipping App ID enabled in
    # environment.prod.ts, #242) don't require bumping every other service's
    # tag too, and vice versa.
    capy-pos-app = {
      image_port = 8080
      image_tag  = "v4"
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
      pins_cors_origins        = true
    }
    # infra/clerk-agent-relay — one agent hop, holding tools that change a cart.
    capy-clerk-agent-relay = {
      image_port               = 8789
      needs_model_key          = true
      needs_session_secret     = true
      needs_appid_verification = true
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
    }
    # infra/appid-token-relay — holds the App ID client secret so the browser
    # bundle never has to. Not a "session-guarded" service in the
    # needs_session_secret sense: it verifies nothing (it issues the very
    # session a caller doesn't have yet) — pins_cors_origins alone is what
    # keeps an unlisted page from spending sign-in attempts against the tenant.
    #
    # image_tag pinned to v2, not left on the global v1: the image pushed
    # under v1 was built for arm64 (an Apple Silicon `docker build` with no
    # --platform flag) and could never start on Code Engine's amd64 nodes —
    # "Initial scale was never achieved". Terraform tracks the tag string, not
    # the underlying digest, so re-pushing a corrected image under the same v1
    # tag would not by itself trigger a new revision; a new tag does, same as
    # capy-pos-app's own v2 pin above.
    capy-appid-token-relay = {
      image_port         = 8792
      image_tag          = "v2"
      needs_appid_secret = true
      pins_cors_origins  = true
    }
  }

  validation {
    condition     = alltrue([for service in var.services : service.image_port > 0 && service.image_port < 65536])
    error_message = "Each service's image_port must be a valid TCP port."
  }
}
