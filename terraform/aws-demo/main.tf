# =============================================================================
# Capy-POS AWS Demo Infrastructure
# Purpose: Talk demo - "AI-Powered Troubleshooting with AWS X-Ray"
# Architecture: Single-responsibility Lambdas (one function per operation)
# 
# EASY TEARDOWN: terraform destroy -auto-approve
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    grafana = {
      source  = "grafana/grafana"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# =============================================================================
# Variables
# =============================================================================

variable "aws_region" {
  description = "AWS region to deploy to"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "capy-pos-demo"
}

variable "enable_failure_mode" {
  description = "Toggle to enable intentional failures for demo"
  type        = bool
  default     = false
}

# =============================================================================
# Random suffix for globally unique names
# =============================================================================

resource "random_id" "suffix" {
  byte_length = 4
}

# =============================================================================
# S3 Bucket - Frontend Hosting
# =============================================================================

resource "aws_s3_bucket" "frontend" {
  bucket        = "${var.project_name}-frontend-${random_id.suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend.arn}/*"
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.frontend]
}

# =============================================================================
# DynamoDB Tables
# =============================================================================

resource "aws_dynamodb_table" "products" {
  name         = "${var.project_name}-products"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_dynamodb_table" "transactions" {
  name         = "${var.project_name}-transactions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

# =============================================================================
# IAM Role - Shared by all Lambdas
# =============================================================================

resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.project_name}-lambda-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
          "dynamodb:Query"
        ]
        Resource = [
          aws_dynamodb_table.products.arn,
          aws_dynamodb_table.transactions.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords"
        ]
        Resource = "*"
      }
    ]
  })
}

# =============================================================================
# Lambda Layer - Shared dependencies (aws-xray-sdk, @aws-sdk/*, uuid)
# =============================================================================

data "archive_file" "lambda_layer" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/layer"
  output_path = "${path.module}/.build/lambda-layer.zip"
}

resource "aws_lambda_layer_version" "shared_deps" {
  filename            = data.archive_file.lambda_layer.output_path
  layer_name          = "${var.project_name}-shared-deps"
  source_code_hash    = data.archive_file.lambda_layer.output_base64sha256
  compatible_runtimes = ["nodejs20.x"]
}

# =============================================================================
# Lambda: Get Products
# =============================================================================

data "archive_file" "get_products_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/get-products"
  output_path = "${path.module}/.build/get-products.zip"

  depends_on = [local_file.get_products_shared]
}

resource "local_file" "get_products_shared" {
  for_each = fileset("${path.module}/lambda/shared", "*.js")
  filename = "${path.module}/lambda/get-products/shared/${each.value}"
  source   = "${path.module}/lambda/shared/${each.value}"
}

resource "aws_lambda_function" "get_products" {
  filename         = data.archive_file.get_products_zip.output_path
  function_name    = "${var.project_name}-get-products"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.get_products_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.shared_deps.arn]

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      PRODUCTS_TABLE = aws_dynamodb_table.products.name
      ENABLE_FAILURE = var.enable_failure_mode ? "true" : "false"
    }
  }
}

resource "aws_cloudwatch_log_group" "get_products_logs" {
  name              = "/aws/lambda/${aws_lambda_function.get_products.function_name}"
  retention_in_days = 7
}

# =============================================================================
# Lambda: Sell Product
# =============================================================================

data "archive_file" "sell_product_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/sell-product"
  output_path = "${path.module}/.build/sell-product.zip"

  depends_on = [local_file.sell_product_shared]
}

resource "local_file" "sell_product_shared" {
  for_each = fileset("${path.module}/lambda/shared", "*.js")
  filename = "${path.module}/lambda/sell-product/shared/${each.value}"
  source   = "${path.module}/lambda/shared/${each.value}"
}

resource "aws_lambda_function" "sell_product" {
  filename         = data.archive_file.sell_product_zip.output_path
  function_name    = "${var.project_name}-sell-product"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.sell_product_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.shared_deps.arn]

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      PRODUCTS_TABLE     = aws_dynamodb_table.products.name
      TRANSACTIONS_TABLE = aws_dynamodb_table.transactions.name
      ENABLE_FAILURE     = var.enable_failure_mode ? "true" : "false"
    }
  }
}

resource "aws_cloudwatch_log_group" "sell_product_logs" {
  name              = "/aws/lambda/${aws_lambda_function.sell_product.function_name}"
  retention_in_days = 7
}

# =============================================================================
# Lambda: Get Transactions
# =============================================================================

data "archive_file" "get_transactions_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/get-transactions"
  output_path = "${path.module}/.build/get-transactions.zip"

  depends_on = [local_file.get_transactions_shared]
}

resource "local_file" "get_transactions_shared" {
  for_each = fileset("${path.module}/lambda/shared", "*.js")
  filename = "${path.module}/lambda/get-transactions/shared/${each.value}"
  source   = "${path.module}/lambda/shared/${each.value}"
}

resource "aws_lambda_function" "get_transactions" {
  filename         = data.archive_file.get_transactions_zip.output_path
  function_name    = "${var.project_name}-get-transactions"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.get_transactions_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.shared_deps.arn]

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      TRANSACTIONS_TABLE = aws_dynamodb_table.transactions.name
    }
  }
}

resource "aws_cloudwatch_log_group" "get_transactions_logs" {
  name              = "/aws/lambda/${aws_lambda_function.get_transactions.function_name}"
  retention_in_days = 7
}

# =============================================================================
# Lambda: Create Product
# =============================================================================

data "archive_file" "create_product_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/create-product"
  output_path = "${path.module}/.build/create-product.zip"

  depends_on = [local_file.create_product_shared]
}

resource "local_file" "create_product_shared" {
  for_each = fileset("${path.module}/lambda/shared", "*.js")
  filename = "${path.module}/lambda/create-product/shared/${each.value}"
  source   = "${path.module}/lambda/shared/${each.value}"
}

resource "aws_lambda_function" "create_product" {
  filename         = data.archive_file.create_product_zip.output_path
  function_name    = "${var.project_name}-create-product"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.create_product_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.shared_deps.arn]

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      PRODUCTS_TABLE = aws_dynamodb_table.products.name
    }
  }
}

resource "aws_cloudwatch_log_group" "create_product_logs" {
  name              = "/aws/lambda/${aws_lambda_function.create_product.function_name}"
  retention_in_days = 7
}

# =============================================================================
# Lambda: Update Product
# =============================================================================

data "archive_file" "update_product_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/update-product"
  output_path = "${path.module}/.build/update-product.zip"

  depends_on = [local_file.update_product_shared]
}

resource "local_file" "update_product_shared" {
  for_each = fileset("${path.module}/lambda/shared", "*.js")
  filename = "${path.module}/lambda/update-product/shared/${each.value}"
  source   = "${path.module}/lambda/shared/${each.value}"
}

resource "aws_lambda_function" "update_product" {
  filename         = data.archive_file.update_product_zip.output_path
  function_name    = "${var.project_name}-update-product"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.update_product_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.shared_deps.arn]

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      PRODUCTS_TABLE = aws_dynamodb_table.products.name
    }
  }
}

resource "aws_cloudwatch_log_group" "update_product_logs" {
  name              = "/aws/lambda/${aws_lambda_function.update_product.function_name}"
  retention_in_days = 7
}

# =============================================================================
# Lambda: Delete Product
# =============================================================================

data "archive_file" "delete_product_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/delete-product"
  output_path = "${path.module}/.build/delete-product.zip"

  depends_on = [local_file.delete_product_shared]
}

resource "local_file" "delete_product_shared" {
  for_each = fileset("${path.module}/lambda/shared", "*.js")
  filename = "${path.module}/lambda/delete-product/shared/${each.value}"
  source   = "${path.module}/lambda/shared/${each.value}"
}

resource "aws_lambda_function" "delete_product" {
  filename         = data.archive_file.delete_product_zip.output_path
  function_name    = "${var.project_name}-delete-product"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.delete_product_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 256
  layers           = [aws_lambda_layer_version.shared_deps.arn]

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      PRODUCTS_TABLE = aws_dynamodb_table.products.name
    }
  }
}

resource "aws_cloudwatch_log_group" "delete_product_logs" {
  name              = "/aws/lambda/${aws_lambda_function.delete_product.function_name}"
  retention_in_days = 7
}

# =============================================================================
# Lambda: Health
# =============================================================================

data "archive_file" "health_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/health"
  output_path = "${path.module}/.build/health.zip"

  depends_on = [local_file.health_shared]
}

resource "local_file" "health_shared" {
  for_each = fileset("${path.module}/lambda/shared", "*.js")
  filename = "${path.module}/lambda/health/shared/${each.value}"
  source   = "${path.module}/lambda/shared/${each.value}"
}

resource "aws_lambda_function" "health" {
  filename         = data.archive_file.health_zip.output_path
  function_name    = "${var.project_name}-health"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.health_zip.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 10
  memory_size      = 128
  layers           = [aws_lambda_layer_version.shared_deps.arn]

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      ENABLE_FAILURE = var.enable_failure_mode ? "true" : "false"
    }
  }
}

resource "aws_cloudwatch_log_group" "health_logs" {
  name              = "/aws/lambda/${aws_lambda_function.health.function_name}"
  retention_in_days = 7
}

# =============================================================================
# API Gateway - HTTP API with explicit routes
# =============================================================================

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "X-Amzn-Trace-Id"]
    # HTTP API manages CORS response headers and strips the Lambda's, so the
    # trace header must be exposed here for browser fetch() to read it.
    expose_headers = ["x-trace-id"]
    max_age        = 300
  }
}

resource "aws_apigatewayv2_stage" "api" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      method         = "$context.httpMethod"
      path           = "$context.path"
      status         = "$context.status"
      responseLength = "$context.responseLength"
    })
  }
}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/${var.project_name}"
  retention_in_days = 7
}

# --- Integrations (one per Lambda) ---

resource "aws_apigatewayv2_integration" "get_products" {
  api_id             = aws_apigatewayv2_api.api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.get_products.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_integration" "sell_product" {
  api_id             = aws_apigatewayv2_api.api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.sell_product.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_integration" "get_transactions" {
  api_id             = aws_apigatewayv2_api.api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.get_transactions.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_integration" "create_product" {
  api_id             = aws_apigatewayv2_api.api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.create_product.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_integration" "update_product" {
  api_id             = aws_apigatewayv2_api.api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.update_product.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_integration" "delete_product" {
  api_id             = aws_apigatewayv2_api.api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.delete_product.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_integration" "health" {
  api_id             = aws_apigatewayv2_api.api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.health.invoke_arn
  integration_method = "POST"
}

# --- Routes (explicit, one per endpoint) ---

resource "aws_apigatewayv2_route" "get_products" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /api/products"
  target    = "integrations/${aws_apigatewayv2_integration.get_products.id}"
}

resource "aws_apigatewayv2_route" "sell_product" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /api/products/{id}/sell"
  target    = "integrations/${aws_apigatewayv2_integration.sell_product.id}"
}

resource "aws_apigatewayv2_route" "get_transactions" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /api/transactions"
  target    = "integrations/${aws_apigatewayv2_integration.get_transactions.id}"
}

resource "aws_apigatewayv2_route" "get_health" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /api/health"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_apigatewayv2_route" "create_product" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /api/products"
  target    = "integrations/${aws_apigatewayv2_integration.create_product.id}"
}

resource "aws_apigatewayv2_route" "update_product_put" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "PUT /api/products/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.update_product.id}"
}

resource "aws_apigatewayv2_route" "update_product_patch" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "PATCH /api/products/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.update_product.id}"
}

resource "aws_apigatewayv2_route" "delete_product" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "DELETE /api/products/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.delete_product.id}"
}


# --- Lambda Permissions (allow API Gateway to invoke each function) ---

resource "aws_lambda_permission" "get_products" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_products.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "sell_product" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sell_product.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "get_transactions" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_transactions.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "health" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.health.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "create_product" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_product.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "update_product" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.update_product.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "delete_product" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.delete_product.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# =============================================================================
# Outputs
# =============================================================================

output "frontend_url" {
  description = "URL of the frontend S3 website"
  value       = aws_s3_bucket_website_configuration.frontend.website_endpoint
}

output "api_url" {
  description = "URL of the API Gateway"
  value       = aws_apigatewayv2_stage.api.invoke_url
}

output "lambda_functions" {
  description = "Lambda function names"
  value = {
    get_products     = aws_lambda_function.get_products.function_name
    sell_product     = aws_lambda_function.sell_product.function_name
    get_transactions = aws_lambda_function.get_transactions.function_name
    create_product   = aws_lambda_function.create_product.function_name
    update_product   = aws_lambda_function.update_product.function_name
    delete_product   = aws_lambda_function.delete_product.function_name
    health           = aws_lambda_function.health.function_name
  }
}

output "products_table" {
  description = "DynamoDB products table name"
  value       = aws_dynamodb_table.products.name
}

output "transactions_table" {
  description = "DynamoDB transactions table name"
  value       = aws_dynamodb_table.transactions.name
}

output "log_groups" {
  description = "CloudWatch log groups"
  value = {
    get_products     = aws_cloudwatch_log_group.get_products_logs.name
    sell_product     = aws_cloudwatch_log_group.sell_product_logs.name
    get_transactions = aws_cloudwatch_log_group.get_transactions_logs.name
    create_product   = aws_cloudwatch_log_group.create_product_logs.name
    update_product   = aws_cloudwatch_log_group.update_product_logs.name
    delete_product   = aws_cloudwatch_log_group.delete_product_logs.name
    health           = aws_cloudwatch_log_group.health_logs.name
    api_gateway      = aws_cloudwatch_log_group.api_logs.name
  }
}

output "teardown_command" {
  description = "Run this to destroy everything"
  value       = "cd terraform/aws-demo && terraform destroy -auto-approve"
}
