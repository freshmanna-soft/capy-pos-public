# =============================================================================
# Native CloudWatch dashboard — infra-failure monitoring
#
# This is the view that catches failures OTel can't see: Lambda init crashes,
# unhandled errors, throttles, and API Gateway 5xx. An init-time crash (like the
# missing-OTel-module bug) emits NO traces — the only signal is here, in the
# AWS/Lambda Errors and AWS/ApiGateway 5xx metrics.
#
# Needs no extra secrets — pure AWS, applies with the same credentials as the
# rest of this stack. Open it in the AWS console (see cloudwatch_dashboard_url).
# =============================================================================

locals {
  # All seven single-responsibility Lambdas, keyed for readable widget building.
  lambda_function_names = [
    aws_lambda_function.get_products.function_name,
    aws_lambda_function.sell_product.function_name,
    aws_lambda_function.get_transactions.function_name,
    aws_lambda_function.create_product.function_name,
    aws_lambda_function.update_product.function_name,
    aws_lambda_function.delete_product.function_name,
    aws_lambda_function.health.function_name,
  ]
}

resource "aws_cloudwatch_dashboard" "capy_pos_health" {
  dashboard_name = "${var.project_name}-health"

  dashboard_body = jsonencode({
    widgets = [
      # ── Row 1: the two signals that catch a crash ──────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 7
        properties = {
          title   = "Lambda Errors (per function)"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          stat    = "Sum"
          yAxis   = { left = { min = 0 } }
          metrics = [
            for fn in local.lambda_function_names :
            ["AWS/Lambda", "Errors", "FunctionName", fn]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 7
        properties = {
          title  = "API Gateway 5xx / 4xx"
          view   = "timeSeries"
          region = var.aws_region
          period = 60
          stat   = "Sum"
          yAxis  = { left = { min = 0 } }
          metrics = [
            ["AWS/ApiGateway", "5xx", "ApiId", aws_apigatewayv2_api.api.id, { color = "#d62728", label = "5xx" }],
            ["AWS/ApiGateway", "4xx", "ApiId", aws_apigatewayv2_api.api.id, { color = "#ff7f0e", label = "4xx" }],
          ]
        }
      },

      # ── Row 2: latency + saturation ────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 7
        width  = 12
        height = 7
        properties = {
          title  = "Lambda Duration (p99)"
          view   = "timeSeries"
          region = var.aws_region
          period = 60
          stat   = "p99"
          metrics = [
            for fn in local.lambda_function_names :
            ["AWS/Lambda", "Duration", "FunctionName", fn]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 7
        width  = 12
        height = 7
        properties = {
          title  = "Lambda Throttles + API Latency (p99)"
          view   = "timeSeries"
          region = var.aws_region
          period = 60
          yAxis  = { left = { min = 0 } }
          metrics = concat(
            [
              for fn in local.lambda_function_names :
              ["AWS/Lambda", "Throttles", "FunctionName", fn, { stat = "Sum" }]
            ],
            [
              ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.api.id, { stat = "p99", yAxis = "right", label = "API Latency p99" }],
            ]
          )
        }
      },

      # ── Row 3: request volume for context ──────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 14
        width  = 24
        height = 6
        properties = {
          title  = "API Request Count + Lambda Invocations"
          view   = "timeSeries"
          region = var.aws_region
          period = 60
          stat   = "Sum"
          metrics = concat(
            [
              ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.api.id, { label = "API requests" }],
            ],
            [
              for fn in local.lambda_function_names :
              ["AWS/Lambda", "Invocations", "FunctionName", fn]
            ]
          )
        }
      },
    ]
  })
}

output "cloudwatch_dashboard_url" {
  description = "Native CloudWatch health dashboard (infra failures, 5xx, throttles)"
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards/dashboard/${aws_cloudwatch_dashboard.capy_pos_health.dashboard_name}"
}
