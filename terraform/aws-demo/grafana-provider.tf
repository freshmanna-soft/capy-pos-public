# =============================================================================
# Grafana Cloud provisioning (optional, gated on a token)
#
# The OTel dashboard (grafana-dashboard.json) is provisioned through Terraform
# so it's reproducible instead of a manual import. Everything here is GATED:
#   - Set grafana_api_token        → the OTel dashboard is provisioned.
#   - Also set grafana_cw_access_key + grafana_cw_secret_key
#                                   → a CloudWatch datasource is added and the
#                                     dashboard's "Backend Errors (CloudWatch)"
#                                     panel lights up inside Grafana too.
#
# With no token set (the default), these resources have count = 0 and nothing
# is created — `terraform apply` only touches the native CloudWatch dashboard
# and the rest of the AWS stack.
#
# Get a token: grafana.net → Administration → Service accounts → add token,
# then: terraform apply -var="grafana_api_token=glsa_..."
# =============================================================================

variable "grafana_url" {
  description = "Grafana Cloud stack URL"
  type        = string
  default     = "https://freshmannasoft.grafana.net"
}

variable "grafana_api_token" {
  description = "Grafana service-account token. Empty = skip Grafana provisioning."
  type        = string
  default     = ""
  sensitive   = true
}

variable "grafana_cw_access_key" {
  description = "AWS access key ID for Grafana's CloudWatch datasource. Empty = skip the CloudWatch-in-Grafana panel."
  type        = string
  default     = ""
  sensitive   = true
}

variable "grafana_cw_secret_key" {
  description = "AWS secret access key for Grafana's CloudWatch datasource."
  type        = string
  default     = ""
  sensitive   = true
}

locals {
  # Whether a token/keys are present is not itself secret — unwrap so these can
  # drive count and a (URL-only, token-free) output without tainting them.
  grafana_enabled       = nonsensitive(var.grafana_api_token != "")
  cloudwatch_in_grafana = nonsensitive(var.grafana_api_token != "" && var.grafana_cw_access_key != "" && var.grafana_cw_secret_key != "")
}

provider "grafana" {
  url  = var.grafana_url
  auth = var.grafana_api_token
}

# OTel dashboard — provisioned only when a token is supplied.
resource "grafana_dashboard" "capy_pos_failure_demo" {
  count       = local.grafana_enabled ? 1 : 0
  config_json = file("${path.module}/grafana-dashboard.json")
  overwrite   = true
}

# CloudWatch datasource inside Grafana — provisioned only when AWS keys are also
# supplied. Fixed uid so grafana-dashboard.json can reference it deterministically.
resource "grafana_data_source" "cloudwatch" {
  count = local.cloudwatch_in_grafana ? 1 : 0
  type  = "cloudwatch"
  name  = "CloudWatch"
  uid   = "capy-cloudwatch"

  json_data_encoded = jsonencode({
    authType      = "keys"
    defaultRegion = var.aws_region
  })

  secure_json_data_encoded = jsonencode({
    accessKey = var.grafana_cw_access_key
    secretKey = var.grafana_cw_secret_key
  })
}

output "grafana_dashboard_url" {
  description = "Grafana OTel dashboard (only provisioned when grafana_api_token is set)"
  value       = local.grafana_enabled ? "${var.grafana_url}/d/capy-pos-failure-demo" : "(not provisioned — set grafana_api_token to enable)"
}
