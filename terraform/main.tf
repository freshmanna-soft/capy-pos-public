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
  # The apps that hold the model key, and the apps that verify a session token.
  # Derived once so the secret resources and the env bindings below cannot drift
  # apart from each other.
  model_key_services = { for name, service in var.services : name => service if service.needs_model_key }
  guarded_services   = { for name, service in var.services : name => service if service.guards_browser_calls }

  # The browser origins a guarded app will answer. Comma-joined because that is
  # what `readAllowedOrigins` in each proxy's `session-guard.ts` parses, and empty
  # when unset — which makes the app refuse to start rather than serve an origin
  # nobody chose. See the two-pass apply note in README.md.
  allowed_origins = join(",", var.frontend_origins)

  # Literal (non-secret) env per app. `NODE_ENV` for every app, `ALLOWED_ORIGINS`
  # only where it means something, and `env` last so a service can override either.
  service_env = {
    for name, service in var.services : name => merge(
      { NODE_ENV = "production" },
      service.guards_browser_calls && local.allowed_origins != "" ? { ALLOWED_ORIGINS = local.allowed_origins } : {},
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
# Shared deliberately: the proxies verify the same HS256 token the browser already
# mints (`src/app/core/infrastructure/auth/session-issuer.ts`), so a per-app secret
# would mean a token that one app accepts and its sibling rejects.
resource "ibm_code_engine_secret" "session_jwt" {
  count = length(local.guarded_services) > 0 ? 1 : 0

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
    for_each = each.value.guards_browser_calls ? [1] : []

    content {
      type      = "secret_key_reference"
      name      = "SESSION_JWT_SECRET"
      key       = "SESSION_JWT_SECRET"
      reference = ibm_code_engine_secret.session_jwt[0].name
    }
  }
}
