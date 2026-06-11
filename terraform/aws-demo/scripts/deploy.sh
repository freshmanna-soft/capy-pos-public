#!/bin/bash
# =============================================================================
# Deploy Capy-POS Demo to AWS
# 
# Architecture: Single-responsibility Lambdas
#   - get-products:     GET /api/products
#   - sell-product:     POST /api/products/{id}/sell
#   - get-transactions: GET /api/transactions
#   - health:           GET /api/health, POST /api/fail/toggle
#
# Usage: ./deploy.sh
# Enable failures: ./deploy.sh --fail
# Teardown: cd terraform/aws-demo && terraform destroy -auto-approve
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$(dirname "$DEMO_DIR")")"
REGION="us-east-1"
ENABLE_FAILURE="false"

# Parse args
if [[ "$1" == "--fail" ]]; then
  ENABLE_FAILURE="true"
  echo "⚠️  Failure mode will be ENABLED"
fi

echo "🚀 Capy-POS AWS Demo Deployment (Single-Responsibility Lambdas)"
echo "================================================================"
echo ""

# Step 1: Install Lambda Layer dependencies
echo "📦 Step 1: Installing Lambda Layer dependencies..."
cd "$DEMO_DIR/lambda/layer/nodejs"
npm install --production
cd "$DEMO_DIR"
echo "   ✅ Layer dependencies installed"
echo ""

# Step 2: Copy shared modules into each Lambda function directory
echo "📋 Step 2: Copying shared modules into Lambda functions..."
for fn in get-products sell-product get-transactions health; do
  mkdir -p "$DEMO_DIR/lambda/$fn/shared"
  cp "$DEMO_DIR/lambda/shared/"*.js "$DEMO_DIR/lambda/$fn/shared/"
  echo "   ✅ Shared → $fn/shared/"
done
echo ""

# Step 3: Terraform init & apply
echo "🏗️  Step 3: Running Terraform..."
terraform init
terraform apply -auto-approve -var="enable_failure_mode=$ENABLE_FAILURE"
echo "   ✅ Infrastructure deployed"
echo ""

# Capture outputs
API_URL=$(terraform output -raw api_url)
FRONTEND_URL=$(terraform output -raw frontend_url)
BUCKET_NAME=$(aws s3api list-buckets --query "Buckets[?contains(Name,'capy-pos-demo-frontend')].Name" --output text --region "$REGION")

echo "   API URL: $API_URL"
echo "   Frontend URL: http://$FRONTEND_URL"
echo "   S3 Bucket: $BUCKET_NAME"
echo ""

# Step 4: Build Angular frontend
echo "🔨 Step 4: Building Angular frontend..."
cd "$PROJECT_ROOT"

# Build with production config
npx ng build --configuration=production
echo "   ✅ Frontend built"
echo ""

# Step 5: Sync to S3
echo "☁️  Step 5: Uploading frontend to S3..."
aws s3 sync dist/capy-pos/browser "s3://${BUCKET_NAME}" \
  --delete \
  --region "$REGION" \
  --no-cli-pager
echo "   ✅ Frontend uploaded to S3"
echo ""

# Step 6: Seed data
echo "🌱 Step 6: Seeding DynamoDB..."
bash "$SCRIPT_DIR/seed-data.sh" "$REGION"
echo ""

# Done!
echo "================================================================"
echo "🎉 Deployment Complete!"
echo "================================================================"
echo ""
echo "📱 Frontend: http://$FRONTEND_URL"
echo "🔌 API:      $API_URL"
echo ""
echo "🧪 Test endpoints:"
echo "   curl ${API_URL}/api/health"
echo "   curl ${API_URL}/api/products"
echo "   curl -X POST ${API_URL}/api/products/prod-001/sell"
echo "   curl ${API_URL}/api/transactions"
echo ""
echo "💥 Enable failure mode:"
echo "   cd $DEMO_DIR && terraform apply -var='enable_failure_mode=true' -auto-approve"
echo ""
echo "   Then trigger failures:"
echo "   curl ${API_URL}/api/products              # → timeout (25s)"
echo "   curl -X POST ${API_URL}/api/products/prod-010/sell  # → negative stock error"
echo ""
echo "🗑️  Teardown (removes EVERYTHING):"
echo "   cd $DEMO_DIR && terraform destroy -auto-approve"
echo ""
