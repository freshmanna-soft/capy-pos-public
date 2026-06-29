#!/bin/bash
# Quick deployment script for Capy-POS to AWS
# Usage: ./deploy.sh [production|staging|demo]

set -euo pipefail

ENVIRONMENT=${1:-demo}
REGION="us-east-1"
PROJECT="capy-pos-demo"

echo "🚀 Deploying Capy-POS to AWS ($ENVIRONMENT)"

# =============================================================================
# Prerequisites
# =============================================================================

echo "📋 Checking prerequisites..."

# Check AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
  echo "❌ AWS credentials not available. Run: aws login"
  exit 1
fi
echo "✓ AWS credentials configured"

# Check required tools
for cmd in terraform npm git; do
  if ! command -v $cmd &>/dev/null; then
    echo "❌ $cmd not found. Please install it."
    exit 1
  fi
done
echo "✓ All required tools found"

# Check Grafana token
if [ -z "${GRAFANA_OTLP_API_KEY:-}" ]; then
  echo "⚠️  GRAFANA_OTLP_API_KEY not set"
  echo "   Get token from: https://freshmannasoft.grafana.net/org/apikeys"
  read -p "   Enter GRAFANA_OTLP_API_KEY (or press Enter to skip): " GRAFANA_OTLP_API_KEY
fi

# =============================================================================
# Build Frontend
# =============================================================================

echo ""
echo "🏗️  Building Angular frontend..."

if [ -d "dist" ]; then
  rm -rf dist
fi

npm run build -- --configuration=production

if [ ! -d "dist/capy-pos" ]; then
  echo "❌ Frontend build failed"
  exit 1
fi

echo "✓ Frontend built successfully"

# =============================================================================
# Deploy Infrastructure
# =============================================================================

echo ""
echo "🌥️  Deploying AWS infrastructure with Terraform..."

cd terraform/aws-demo

# Initialize Terraform
if [ ! -d ".terraform" ]; then
  echo "   Initializing Terraform..."
  terraform init
fi

# Plan deployment
echo "   Planning deployment..."
terraform plan \
  -var="aws_region=$REGION" \
  -var="project_name=$PROJECT" \
  -var="enable_failure_mode=true" \
  -out=tfplan

# Ask for confirmation
echo ""
read -p "Apply Terraform plan? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Deployment cancelled"
  exit 1
fi

# Apply infrastructure
echo "   Applying infrastructure..."
terraform apply tfplan

# Get outputs
API_ENDPOINT=$(terraform output -raw api_endpoint 2>/dev/null || echo "unknown")
FRONTEND_BUCKET=$(terraform output -raw frontend_bucket_name 2>/dev/null || echo "unknown")

echo "✓ Infrastructure deployed"

# =============================================================================
# Deploy Frontend to S3
# =============================================================================

echo ""
echo "📦 Deploying frontend to S3..."

if [ "$FRONTEND_BUCKET" != "unknown" ]; then
  aws s3 sync ../../dist/capy-pos "s3://$FRONTEND_BUCKET" --delete --region "$REGION"
  echo "✓ Frontend deployed to S3"
else
  echo "⚠️  Could not determine S3 bucket name. Skipping frontend deployment."
  echo "   Deploy manually: aws s3 sync dist/capy-pos s3://bucket-name --delete"
fi

# =============================================================================
# Verify Deployment
# =============================================================================

echo ""
echo "✅ Verifying deployment..."

cd ../..

# Wait for API to be ready
echo "   Waiting for API to be ready..."
sleep 5

# Test health endpoint
if curl -s "$API_ENDPOINT/api/health" &>/dev/null; then
  echo "✓ API is responding"
else
  echo "⚠️  API not responding yet. It may take a few minutes to become available."
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📍 API Endpoint:"
echo "   $API_ENDPOINT"
echo ""
echo "📊 Grafana Dashboard:"
echo "   https://freshmannasoft.grafana.net/d/capy-pos-failure-demo"
echo ""
echo "📋 Next Steps:"
echo "   1. Open the API endpoint in your browser"
echo "   2. Make requests: curl $API_ENDPOINT/api/products"
echo "   3. Watch Grafana dashboard for traces (live updates every 30s)"
echo "   4. During failure injection (25s latency spike in dashboard)"
echo ""
echo "🔄 To redeploy after code changes:"
echo "   ./deploy.sh $ENVIRONMENT"
echo ""
echo "🗑️  To destroy resources:"
echo "   cd terraform/aws-demo && terraform destroy -auto-approve"
echo ""
