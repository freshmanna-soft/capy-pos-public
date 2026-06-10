#!/bin/bash
set -e

# =============================================================================
# Capy-POS Deployment Script
# Deploys to IBM Cloud Code Engine via Container Registry + Terraform
# =============================================================================

echo "🐹 Capy-POS Deployment"
echo "======================"

# Configuration
REGION="us-south"
CR_NAMESPACE="capy-pos"
APP_NAME="capy-pos-app"
IMAGE_TAG="latest"
IMAGE_URL="us.icr.io/${CR_NAMESPACE}/${APP_NAME}:${IMAGE_TAG}"

# Step 1: Login to IBM Cloud
echo ""
echo "📡 Step 1: Logging into IBM Cloud..."
ibmcloud login --apikey "${IC_API_KEY}" -r "${REGION}" --quiet
echo "✅ Logged in successfully"

# Step 2: Install Container Registry plugin if needed
echo ""
echo "🔌 Step 2: Ensuring Container Registry plugin..."
ibmcloud plugin install container-registry -f -q 2>/dev/null || true
echo "✅ Plugin ready"

# Step 3: Login to Container Registry
echo ""
echo "🔐 Step 3: Logging into Container Registry..."
ibmcloud cr login --quiet
echo "✅ CR login successful"

# Step 4: Create namespace if it doesn't exist
echo ""
echo "📦 Step 4: Ensuring CR namespace '${CR_NAMESPACE}'..."
ibmcloud cr namespace-add "${CR_NAMESPACE}" 2>/dev/null || echo "  (namespace already exists)"
echo "✅ Namespace ready"

# Step 5: Build Docker image
echo ""
echo "🏗️  Step 5: Building Docker image..."
docker build -t "${IMAGE_URL}" .
echo "✅ Image built successfully"

# Step 6: Push to IBM Container Registry
echo ""
echo "🚀 Step 6: Pushing image to IBM Container Registry..."
docker push "${IMAGE_URL}"
echo "✅ Image pushed successfully"

# Step 7: Deploy with Terraform
echo ""
echo "🌍 Step 7: Deploying with Terraform..."
cd terraform
terraform init -input=false
terraform apply -auto-approve -input=false
echo "✅ Terraform apply complete"

# Step 8: Get the app URL
echo ""
echo "============================================"
echo "🎉 DEPLOYMENT COMPLETE!"
echo "============================================"
terraform output -raw app_url
echo ""
echo "============================================"
