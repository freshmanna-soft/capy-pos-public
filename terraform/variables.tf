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
  description = "IBM Container Registry namespace holding every service image"
  type        = string
  default     = "capy-pos"
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

variable "frontend_origins" {
  description = <<-EOT
    Browser origins the guarded services will answer, e.g.
    ["https://capy-pos-app.abc123.us-south.codeengine.appdomain.cloud"]. Scheme and
    host only, no trailing slash: it is compared against the request's `Origin`
    header verbatim. Unset on the first apply — the frontend's URL is an output of
    that apply — then set and apply again; see README.md.
  EOT
  type        = list(string)
  default     = []

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
    # Verifies the browser's session token and pins CORS to `frontend_origins`:
    # binds SESSION_JWT_SECRET and ALLOWED_ORIGINS.
    guards_browser_calls    = optional(bool, false)
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
    capy-pos-app = {
      image_port = 8080
    }
    # infra/vision-proxy — one frame in, candidate products out.
    capy-vision-proxy = {
      image_port           = 8787
      needs_model_key      = true
      guards_browser_calls = true
    }
    # infra/clerk-agent-relay — one agent hop, holding tools that change a cart.
    capy-clerk-agent-relay = {
      image_port           = 8789
      needs_model_key      = true
      guards_browser_calls = true
    }
  }

  validation {
    condition     = alltrue([for service in var.services : service.image_port > 0 && service.image_port < 65536])
    error_message = "Each service's image_port must be a valid TCP port."
  }
}
