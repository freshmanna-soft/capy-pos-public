# Capy-POS AWS backend (+ the X-Ray troubleshooting demo)

> ## ⚠️ Read this before running anything here
>
> **This directory is not a disposable conference demo, despite its name and the
> talk material further down.** It is the only real backend the shipped Capy-POS
> frontend's offline-first sync talks to: `src/environments/environment.prod.ts`,
> `environment.ts`, `environment.vision.ts` and
> `src/app/core/infrastructure/sync/sync.types.ts` hardcode its API Gateway
> hostname, and product features were built straight against it (`fc889356`,
> `00e3ab10`). `AWS_DEPLOYMENT.md` at the repo root is its runbook. Issue #206
> was filed because the "throwaway, easy teardown" framing here did not match
> that reality.
>
> **Current state: destroyed.** `terraform.tfstate` reads `"resources": []` and
> the gateway hostname no longer resolves, so sync from the deployed frontend
> goes nowhere. See [Restanding this stack](#restanding-this-stack) — it needs an
> authorized deploy decision and a service token, not just `terraform apply`.
>
> **Authorization:** every route except `GET /api/health` requires a shared
> service token. Until #206 there was no authorizer of any kind, so product
> writes and the transaction log were open to anyone with the hostname. Do not
> remove it to "get sync working again".

The X-Ray/AI-troubleshooting talk material below is still accurate and still
useful — it is just not the whole story of what this stack is for.

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

| Lambda                           | Route                          | Purpose           |
| -------------------------------- | ------------------------------ | ----------------- |
| `capy-pos-demo-get-products`     | `GET /api/products`            | List all products |
| `capy-pos-demo-sell-product`     | `POST /api/products/{id}/sell` | Process a sale    |
| `capy-pos-demo-get-transactions` | `GET /api/transactions`        | List transactions |
| `capy-pos-demo-health`           | `GET /api/health`              | Health check      |

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

`scripts/deploy.sh` runs `terraform apply`, so it needs `TF_VAR_api_service_token`
exported (see below). The apply fails fast without it — `var.api_service_token` has
no default on purpose, so no deploy can quietly ship a token that is public in git
history.

### Restanding this stack

The stack is currently destroyed. Bringing it back is four steps, and step 2 is the
one that is easy to skip:

1. **Pick a service token and export it.** Any high-entropy string;
   `openssl rand -base64 32` is fine. Never commit it, and do not put it in a
   `.tfvars` file inside the repo.

   ```bash
   export TF_VAR_api_service_token="$(openssl rand -base64 32)"
   ```

2. **Decide how clients will present it.** The authorizer expects
   `Authorization: Bearer <token>` on every route except `GET /api/health`. The
   browser SPA has no safe place to keep this — anything in the Angular bundle is
   readable by every visitor, so shipping the token to the frontend would make it
   public again with extra steps. That means:

   - server-to-server callers (seed scripts, the MCP server, `curl`) work today;
   - the deployed SPA's sync **stays broken until real per-user auth exists**
     (Cognito / the multi-cloud auth-gateway work, #200). That is a deliberate
     trade from #206: an API nobody can write to anonymously is better than a
     working sync that anyone on the internet can write to.

   The till itself is unaffected either way — Dexie is the source of truth and
   `enableOfflineMode` is on, so sync being down degrades rather than breaks it.

3. **Apply, then re-point the hostname.** A fresh apply gets a new API Gateway
   hostname (`random_id.suffix` also re-rolls). The old one is hardcoded in four
   places and **all four must be updated together**, or sync will half-work:

   | File | Field |
   | --- | --- |
   | `src/environments/environment.ts` | `apiUrl` |
   | `src/environments/environment.prod.ts` | `apiUrl` |
   | `src/environments/environment.vision.ts` | `apiUrl` |
   | `src/app/core/infrastructure/sync/sync.types.ts` | `DEFAULT_SYNC_CONFIG.apiBaseUrl` |

   `app.config.ts` derives the worker's base URL from `environment.apiUrl`, so
   `sync.types.ts` is only the pre-configuration fallback — which is exactly why it
   gets forgotten.

4. **Verify what the last apply broke before.** These have each regressed at least
   once:

   ```bash
   curl -i "$API/api/health"                     # 200, unauthenticated
   curl -i "$API/api/products"                   # 401 without a token
   curl -i -H "Authorization: Bearer $TOKEN" "$API/api/products"   # 200
   curl -i -X PATCH -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d '{"stock":1}' \
        "$API/api/products/prod-001"             # 200 — PATCH CORS regressed in 92765619
   ```

   Also confirm `x-trace-id` comes back on a browser `fetch()` (API Gateway manages
   CORS response headers and strips the Lambda's, so `expose_headers` on the
   gateway is what makes it readable) and that traces appear in X-Ray.

### Teardown

**Not a routine step.** Destroying this stack takes the frontend's sync backend
with it and drops the DynamoDB product/transaction tables — that is exactly how
the situation in #206 came about. Confirm nothing depends on it, then:

```bash
cd terraform/aws-demo
terraform plan -destroy          # read this before agreeing to it
terraform destroy
```

`-auto-approve` is deliberately not shown here.

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

| Tool                 | Input              | Description                                                    |
| -------------------- | ------------------ | -------------------------------------------------------------- |
| `troubleshoot_trace` | `traceId` (string) | Takes a Trace ID, fetches X-Ray data + logs, returns diagnosis |
| `get_recent_traces`  | _(none)_           | Lists recent error traces (last 5 min)                         |
| `toggle_failure`     | `enable` (boolean) | Enables/disables failure mode by updating Lambda env vars      |

---

## 💥 Failure Scenarios

| #   | Scenario            | Trigger                                              | What Happens                           |
| --- | ------------------- | ---------------------------------------------------- | -------------------------------------- |
| 1   | **Lambda Timeout**  | `GET /api/products` (with failure ON)                | 25s delay → Lambda times out at 30s    |
| 2   | **Negative Stock**  | `POST /api/products/prod-010/sell` (with failure ON) | Stock=0, throws ConditionalCheckFailed |
| 3   | **Data Corruption** | `GET /api/products` (with failure ON)                | Random product gets null name/price    |

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

Idle cost is near zero, so there is no cost argument for tearing the stack down
between uses — and a teardown is not free, because the frontend points at it (see
the warning at the top of this file). This file used to say "always run
`terraform destroy` after the talk to be safe"; that advice is what #206 is
about, and it has been removed.

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
