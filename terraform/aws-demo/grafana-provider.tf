terraform {
  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "~> 1.39"
    }
  }
}

provider "grafana" {
  url  = var.grafana_url
  auth = var.grafana_api_token
}

variable "grafana_url" {
  description = "Grafana Cloud URL"
  type        = string
  default     = "https://freshmannasoft.grafana.net"
}

variable "grafana_api_token" {
  description = "Grafana Cloud API token"
  type        = string
  sensitive   = true
}

resource "grafana_dashboard" "capy_pos_failure_demo" {
  config_json = file("${path.module}/grafana-dashboard.json")

  depends_on = [grafana_data_source.otlp]
}

resource "grafana_data_source" "otlp" {
  type       = "prometheus"
  name       = "Prometheus (OTLP)"
  url        = "https://prometheus-blocks-prod-us-east-3.grafana-blocks.com/otlp"
  access     = "proxy"
  is_default = false

  depends_on = [grafana_notification_channel.onprem]
}

resource "grafana_notification_channel" "onprem" {
  name  = "Alert Channel - Capy-POS"
  type  = "email"
  is_default = false
}
