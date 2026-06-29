# AWS Deployment Checklist

## Prerequisites

### 1. AWS Credentials

```bash
# Re-authenticate with AWS (credentials expired)
aws login

# Or use configured credentials
eval "$(aws configure export-credentials --format env)"

# Verify
aws sts get-caller-identity
```

### 2. Grafana Cloud API Token

```bash
# Generate at: https://freshmannasoft.grafana.net/org/apikeys
# Store securely in:
export GRAFANA_OTLP_API_KEY="glc_..."
```

### 3. Terraform State

```bash
cd /Users/javierbritopacheco/codebase/capy-pos/terraform/aws-demo

# Initialize Terraform (first time only, or if state is lost)
terraform init

# Check current state
terraform state list
```

## Deployment Steps

### Step 1: Plan the Deployment

```bash
cd terraform/aws-demo

# Review what will be created/updated
terraform plan \
  -var="enable_failure_mode=true" \
  -var="aws_region=us-east-1" \
  -out=tfplan

# Note: Shows Lambda layer with new OpenTelemetry packages, updated handlers
```

### Step 2: Set Environment Variables for Lambda

Create `.env.production` or pass via Terraform:

```bash
export ENABLE_FAILURE=true
export OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-us-east-3.grafana.net/otlp"
export GRAFANA_OTLP_API_KEY="glc_..."
export ENVIRONMENT="production"
```

### Step 3: Apply Infrastructure

```bash
# Deploy all resources (Lambda, DynamoDB, API Gateway, S3, CloudFront, etc.)
terraform apply tfplan

# Outputs will show:
# - API endpoint URL
# - S3 bucket for frontend
# - CloudFront distribution URL
# - DynamoDB table names
```

### Step 4: Build & Deploy Frontend

```bash
# Build Angular app for production with OpenTelemetry enabled
npm run build -- --configuration=production

# Upload to S3 (Terraform handles CloudFront invalidation)
# Option A: Via Terraform (included in apply)
# Option B: Manual
aws s3 sync dist/capy-pos s3://capy-pos-demo-frontend-xxxx --delete

# Verify frontend is accessible
curl https://d1234.cloudfront.net/index.html
```

### Step 5: Verify Deployment

```bash
# 1. Get API endpoint from Terraform outputs
API_URL=$(terraform output -raw api_endpoint)
echo "API Endpoint: $API_URL"

# 2. Test health check
curl $API_URL/api/health

# 3. Test with failure injection enabled
curl -H "ENABLE_FAILURE: true" $API_URL/api/products

# 4. Check Grafana dashboard
# https://freshmannasoft.grafana.net/d/capy-pos-failure-demo
# → Should see traces appearing within 10s of requests

# 5. Verify Lambda layer has OpenTelemetry packages
aws lambda get-layer-version \
  --layer-name capy-pos-demo-layer \
  --version-number 1 \
  --region us-east-1
```

## Deployment Configuration

### Terraform Variables

```hcl
# terraform.tfvars (create if needed)
aws_region            = "us-east-1"
project_name          = "capy-pos-demo"
enable_failure_mode   = true              # Toggle for failure-injection demo

# Lambda environment variables
lambda_environment = {
  OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp-gateway-prod-us-east-3.grafana.net/otlp"
  GRAFANA_OTLP_API_KEY        = var.grafana_api_token
  ENVIRONMENT                 = "production"
  ENABLE_FAILURE              = "true"
}
```

### What Gets Deployed

| Resource | Name | Purpose |
|----------|------|---------|
| **Lambda Layer** | `capy-pos-demo-layer` | OpenTelemetry SDK + dependencies |
| **Lambda Functions** | `capy-pos-demo-{get-products,create-product,...}` | API handlers with OTLP tracing |
| **DynamoDB** | `capy-pos-demo-products` | Product catalog |
| **API Gateway** | `capy-pos-demo-api` | REST API with CORS |
| **S3** | `capy-pos-demo-frontend-{random}` | Frontend static assets |
| **CloudFront** | Auto-created | CDN for frontend |
| **IAM Roles** | `capy-pos-demo-lambda-role` | Lambda execution permissions |

## Monitoring Post-Deployment

### 1. CloudWatch Logs

```bash
# Stream Lambda logs with trace IDs
aws logs tail /aws/lambda/capy-pos-demo-get-products \
  --follow \
  --format short
```

### 2. Grafana Dashboard

1. Open https://freshmannasoft.grafana.net/d/capy-pos-failure-demo
2. Set time range to "Last 15 minutes"
3. Trigger API requests: `curl $API_URL/api/products`
4. **Expected**: Latency panel shows spike within 10s

### 3. X-Ray Traces (Optional)

If X-Ray is enabled in Lambda layer:

```bash
aws xray get-service-graph \
  --start-time $(date -u -d '10 minutes ago' +%s) \
  --end-time $(date -u +%s) \
  --region us-east-1
```

## Troubleshooting

### Traces Not Appearing in Grafana

**Symptoms**: Dashboard empty after 5+ minutes

**Diagnosis**:
```bash
# 1. Check Lambda can reach Grafana Cloud
aws logs tail /aws/lambda/capy-pos-demo-get-products --follow | grep -i "otlp\|error"

# 2. Verify GRAFANA_OTLP_API_KEY is set
aws lambda get-function-configuration \
  --function-name capy-pos-demo-get-products \
  --query Environment.Variables | grep GRAFANA
```

**Fix**:
- Update Lambda environment variable: `aws lambda update-function-configuration --function-name capy-pos-demo-get-products --environment Variables={GRAFANA_OTLP_API_KEY=glc_...}`
- Redeploy layer if packages missing: `terraform apply -target aws_lambda_layer_version.dependencies`

### API Returning 500 Errors

**Diagnosis**:
```bash
# Check Lambda logs
aws logs tail /aws/lambda/capy-pos-demo-get-products --follow

# Check if telemetry.js is initializing correctly
# Look for: "OpenTelemetry SDK initialized" or error messages
```

**Fix**:
- Rebuild Lambda layer: `cd terraform/aws-demo/lambda/layer/nodejs && npm install`
- Re-apply Terraform: `terraform apply`

### Frontend Not Loading

**Diagnosis**:
```bash
# Check S3 bucket policy
aws s3api get-bucket-policy --bucket capy-pos-demo-frontend-xxxx

# Check CloudFront distribution
aws cloudfront get-distribution-config --id XXXX
```

**Fix**:
- Invalidate CloudFront cache: `terraform apply -target aws_cloudfront_invalidation.frontend`
- Re-upload frontend: `aws s3 sync dist/capy-pos s3://capy-pos-demo-frontend-xxxx --delete`

## Rollback

If deployment fails or you need to rollback:

```bash
# Destroy all resources (keeps data in DynamoDB snapshots)
terraform destroy -auto-approve

# Note: This is safe for demo; production would use state backups
```

## Cost Estimation

Typical monthly cost for failure-injection demo:

| Service | Estimate | Notes |
|---------|----------|-------|
| Lambda | $0.20 | 1M requests/month at 256MB, 1s avg |
| DynamoDB | $1.25 | On-demand, ~100 RCU/s peak |
| API Gateway | $3.50 | 1M requests/month |
| S3 | $0.50 | Frontend static assets |
| CloudFront | $0.85 | Data transfer out |
| Grafana Cloud | $0–10 | 10% trace sampling; 1GB/month ingestion |
| **Total** | **~$6–16/month** | Scales linearly with traffic |

## Success Criteria

After deployment, verify:

- [ ] API Gateway endpoint returns 200 on `/api/health`
- [ ] `GET /api/products` returns product list
- [ ] Grafana dashboard shows traces within 10s
- [ ] Latency spike visible when `ENABLE_FAILURE=true`
- [ ] Error rate spikes to 100% during failure window
- [ ] DynamoDB duration metric increases
- [ ] Sync queue depth tracked (if testing offline mode)
- [ ] `X-Trace-Id` header in API responses
- [ ] CloudWatch logs include OTel trace IDs

## Next: Post-Launch

1. **Set up alerts** in Grafana (p99 latency > 2s, error rate > 5%)
2. **Configure auto-scaling** for Lambda (concurrent executions)
3. **Enable AWS X-Ray** for additional debugging
4. **Archive traces** older than 7 days to S3 for compliance
5. **Monitor costs** via AWS Budgets
