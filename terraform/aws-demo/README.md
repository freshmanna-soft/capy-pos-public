# 🤖 AI-Powered Troubleshooting with AWS X-Ray

> **Talk Demo**: How to use AI agents to diagnose production failures using distributed tracing.

## 🎯 What This Demo Shows

1. **A real app** (Capy-POS) deployed on AWS (S3 + Lambda + DynamoDB)
2. **Instrumented with AWS X-Ray** for distributed tracing
3. **Intentional failure scenarios** that can be toggled on/off
4. **An AI agent (MCP Server)** that takes a Trace ID and diagnoses the root cause

### The Flow (Live Demo)
```
User triggers failure → Gets Trace ID → Passes to AI Agent → Agent diagnoses root cause
```

---

## 📁 Architecture

```
┌─────────────────┐     ┌──────────────────┐
│   S3 (Frontend) │────▶│  API Gateway     │
│   Angular App   │     │  (HTTP API)      │
└─────────────────┘     └────────┬─────────┘
                                 │
                    ┌────────────┼────────────────────┐
                    │            │                    │
          ┌────────▼───┐  ┌─────▼──────┐  ┌────────▼────────┐
          │ get-products│  │sell-product │  │get-transactions  │
          │  (Lambda)   │  │  (Lambda)   │  │   (Lambda)       │
          └──────┬──────┘  └──────┬──────┘  └────────┬────────┘
                 │                │                   │
                 └────────┬───────┘                   │
                          │                           │
                    ┌─────▼─────┐            ┌───────▼───────┐
                    │  DynamoDB  │            │   X-Ray       │
                    │  (Products │            │   (Tracing)   │
                    │   + Txns)  │            └───────┬───────┘
                    └────────────┘                    │
                                                     │
                    ┌────────────────────────────────▼┐
                    │  AI Agent (MCP Server)           │
                    │  - Fetches trace via AWS CLI     │
                    │  - Fetches logs from CloudWatch  │
                    │  - Diagnoses root cause          │
                    │  - Toggles failure mode          │
                    └──────────────────────────────────┘
```

### Single-Responsibility Lambdas

| Lambda | Route | Purpose |
|--------|-------|---------|
| `capy-pos-demo-get-products` | `GET /api/products` | List all products |
| `capy-pos-demo-sell-product` | `POST /api/products/{id}/sell` | Process a sale |
| `capy-pos-demo-get-transactions` | `GET /api/transactions` | List transactions |
| `capy-pos-demo-health` | `GET /api/health` | Health check |

Each Lambda has its own CloudWatch Log Group and X-Ray tracing enabled independently.

---

## 🚀 Quick Start

### Prerequisites
- AWS CLI configured (`aws configure`)
- Terraform >= 1.5
- Node.js >= 20
- Angular CLI (`npm install -g @angular/cli`)

### Deploy (One Command)
```bash
cd terraform/aws-demo
chmod +x scripts/deploy.sh scripts/seed-data.sh
./scripts/deploy.sh
```

### Teardown (One Command)
```bash
cd terraform/aws-demo
terraform destroy -auto-approve
```

---

## 🧪 Demo Script (For the Talk)

### Act 1: Show the App Working
```bash
# Health check
curl $API_URL/api/health

# List products
curl $API_URL/api/products

# Make a sale
curl -X POST $API_URL/api/products/prod-001/sell
```

### Act 2: Enable Failures
Use the MCP tool or Terraform variable:

```bash
# Option A: Via MCP tool (AI agent toggles it)
# The AI calls toggle_failure with enable=true

# Option B: Via Terraform
terraform apply -var="enable_failure_mode=true" -auto-approve

# Option C: Via AWS CLI directly
aws lambda update-function-configuration \
  --function-name capy-pos-demo-get-products \
  --environment '{"Variables":{"ENABLE_FAILURE":"true","PRODUCTS_TABLE":"capy-pos-demo-products","TRANSACTIONS_TABLE":"capy-pos-demo-transactions"}}' \
  --region us-east-1
```

### Act 3: Trigger a Failure
```bash
# This will fail — product has 0 stock + failure mode catches it
curl -X POST $API_URL/api/products/prod-010/sell

# Response includes trace ID:
# {"error":"Internal server error","traceId":"Root=1-xxxxxxxx-xxxxxxxxxxxxxxxxxxxx"}

# Or trigger a timeout:
curl $API_URL/api/products
# (Will hang for 25s then timeout)
```

### Act 4: AI Diagnoses the Problem
Use the MCP tool in your AI assistant:
```
"Hey, I got this error. The trace ID is 1-xxxxxxxx-xxxxxxxxxxxxxxxxxxxx. Can you troubleshoot it?"
```

The AI agent will:
1. Fetch the X-Ray trace (`aws xray batch-get-traces`)
2. Analyze segments for errors/faults
3. Fetch related CloudWatch logs
4. Return a diagnosis with root cause + fix

### Act 5: Disable Failures
```
"Can you disable the failure mode?"
```
The AI calls `toggle_failure` with `enable: false` — updates Lambda env vars directly.

---

## 🔧 MCP Server Setup

### Install
```bash
cd terraform/aws-demo/mcp-server
npm install
```

### Add to VS Code / Cline MCP Config
```json
{
  "mcpServers": {
    "aws-xray-troubleshooter": {
      "command": "node",
      "args": ["terraform/aws-demo/mcp-server/src/index.js"],
      "env": {
        "AWS_REGION": "us-east-1",
        "LOG_GROUP": "/aws/lambda/capy-pos-demo-get-products"
      }
    }
  }
}
```

### Available Tools

| Tool | Input | Description |
|------|-------|-------------|
| `troubleshoot_trace` | `traceId` (string) | Takes a Trace ID, fetches X-Ray data + logs, returns diagnosis |
| `get_recent_traces` | _(none)_ | Lists recent error traces (last 5 min) |
| `toggle_failure` | `enable` (boolean) | Enables/disables failure mode by updating Lambda env vars |

---

## 💥 Failure Scenarios

| # | Scenario | Trigger | What Happens |
|---|----------|---------|--------------|
| 1 | **Lambda Timeout** | `GET /api/products` (with failure ON) | 25s delay → Lambda times out at 30s |
| 2 | **Negative Stock** | `POST /api/products/prod-010/sell` (with failure ON) | Stock=0, throws ConditionalCheckFailed |
| 3 | **Data Corruption** | `GET /api/products` (with failure ON) | Random product gets null name/price |

### How Failure Mode Works
- Controlled via `ENABLE_FAILURE` environment variable on each Lambda
- Only `get-products` and `sell-product` Lambdas have failure scenarios
- The MCP `toggle_failure` tool updates the env var via `aws lambda update-function-configuration`
- Alternatively, use `terraform apply -var="enable_failure_mode=true"`

---

## 💰 Cost

This demo costs essentially **$0** when idle:
- S3: Pennies for static hosting
- DynamoDB: PAY_PER_REQUEST (no reads = no cost)
- Lambda: Free tier covers 1M requests/month
- API Gateway: Free tier covers 1M requests/month
- X-Ray: Free tier covers 100K traces/month
- CloudWatch: 7-day retention, minimal logs

**Always run `terraform destroy` after the talk to be safe.**

---

## 📂 File Structure

```
terraform/aws-demo/
├── main.tf                       # All infrastructure (Terraform)
├── README.md                     # This file
├── lambda/
│   ├── shared/
│   │   ├── logger.js             # Structured JSON logger + HTTP helpers
│   │   └── dynamodb.js           # X-Ray-instrumented DynamoDB client
│   ├── get-products/
│   │   └── index.js              # GET /api/products handler
│   ├── sell-product/
│   │   └── index.js              # POST /api/products/{id}/sell handler
│   ├── get-transactions/
│   │   └── index.js              # GET /api/transactions handler
│   ├── health/
│   │   └── index.js              # GET /api/health handler
│   └── layer/
│       └── nodejs/
│           └── package.json      # Lambda Layer dependencies (aws-sdk, xray, uuid)
├── mcp-server/
│   ├── package.json              # MCP server dependencies
│   └── src/
│       └── index.js              # MCP troubleshooting tool (3 tools)
└── scripts/
    ├── deploy.sh                 # One-click deploy
    └── seed-data.sh              # Populate DynamoDB with 10 products
```
