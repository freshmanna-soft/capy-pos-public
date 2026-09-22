# Terraform Infrastructure for Capy-POS

Deploys the Capy-POS estate to **IBM Cloud Code Engine**: one project, one Container
Registry namespace, and N apps driven by the `services` map.

Everything in this directory is the live estate. `aws-demo/` is a dormant AWS
template kept for reference and is not applied by this root module — see
[`aws-demo/README.md`](aws-demo/README.md).

## What gets created

| Resource                                          | Why                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ibm_resource_group` (data)                       | Where everything lands.                                                                                                       |
| `ibm_cr_namespace.namespace`                      | Holds every service image.                                                                                                    |
| `ibm_code_engine_project.project`                 | One project for the estate.                                                                                                   |
| `ibm_code_engine_secret.cr_secret`                | Registry pull secret (`icr-secret`).                                                                                          |
| `ibm_code_engine_secret.model_key`                | `ANTHROPIC_API_KEY`, one per app that sets `needs_model_key`.                                                                 |
| `ibm_code_engine_secret.session_jwt`              | `SESSION_JWT_SECRET`, one for the project, when any app sets `needs_session_secret`.                                          |
| `ibm_cloudant.store`                              | One shared Cloudant (Lite plan) instance, for pos-api's own data.                                                             |
| `ibm_resource_key.cloudant_key`                   | Generated Manager credential used only by checkout index migration.                                                           |
| `ibm_resource_key.cloudant_writer_key`            | Generated Writer credential used by runtime apps and reconciliation.                                                          |
| `ibm_code_engine_secret.cloudant_creds`           | Writer `CLOUDANT_URL`/`CLOUDANT_APIKEY`, one per app that sets `needs_cloudant`.                                              |
| `ibm_code_engine_secret.cloudant_migration_creds` | Manager credential mounted only into checkout migration jobs.                                                                 |
| `ibm_code_engine_secret.appid_secret`             | `APPID_CLIENT_SECRET`, `APPID_MANAGEMENT_APIKEY`, `APPID_CUSTOMER_CLIENT_SECRET`, one per app that sets `needs_appid_secret`. |
| `ibm_code_engine_secret.checkout`                 | PayPal secret and versioned checkout HMAC keyrings.                                                                           |
| `ibm_code_engine_job.checkout_migration`          | Cloudant-only, idempotent checkout-index migration.                                                                           |
| `ibm_code_engine_job.loyalty_migration`           | Manager-only ledger-history and completed-checkout loyalty-due index migration.                                               |
| `ibm_code_engine_job.checkout_reconciliation`     | Writer-scoped bounded checkout and loyalty recovery worker.                                                                   |
| `ibm_code_engine_app.apps`                        | `for_each` over `var.services`.                                                                                               |

The apps are a `for_each` rather than one resource block per service on purpose:
the frontend, the two proxies and pos-api differ only in a port, a tag and which
secrets they need.

## Directory structure

```
terraform/
├── main.tf         # project, namespace, secrets, jobs, and the app loop
├── variables.tf    # inputs, including the `services` map
├── outputs.tf      # app URLs, job names, schedule, project id, namespace
├── moved.tf        # state moves; see "Renaming the frontend app" below
├── providers.tf    # the ibm provider
├── versions.tf     # terraform >= 1.5.0, ibm ~> 1.71
└── aws-demo/       # dormant AWS template, applied separately
```

There is no `modules/` or `environments/` tree: this is a single root module with one
state. Per-environment deploys are separate workspaces/state files with different
`TF_VAR_*` values, not separate directories.

## Prerequisites

- Terraform >= 1.5.0
- IBM Cloud CLI (`ibmcloud`) with the Container Registry and Code Engine plugins
- `jq` for the checkout-job commands below
- Docker, to build and push the service images
- An IBM Cloud API key with Code Engine, Container Registry, and Resource Controller
  (to provision the Cloudant instance and its credentials) access

## Inputs

Set these as `TF_VAR_*` environment variables (never in a committed `.tfvars`):

| Variable                                          | Required                                               | Default             | Notes                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ibmcloud_api_key`                                | always                                                 | —                   | Sensitive. Also used as the registry pull password.                                                                                                                                                   |
| `anthropic_api_key`                               | if any service `needs_model_key`                       | `""`                | Sensitive. Bound as a secret, never as a literal env var.                                                                                                                                             |
| `anthropic_base_url`                              | no                                                     | `""`                | Route model calls through a gateway (e.g. an IBM litellm proxy) instead of the real API. Not sensitive — a literal env var. `anthropic_api_key` must be shaped for whichever endpoint this points at. |
| `session_jwt_secret`                              | if any service `needs_session_secret`                  | `""`                | Sensitive. Must match `getJwtSecret()` — see the auth note below.                                                                                                                                     |
| `frontend_origins`                                | if any service `pins_cors_origins`                     | production defaults | List of `scheme://host[:port]`, no trailing slash.                                                                                                                                                    |
| `paypal_client_id`                                | if any service `needs_checkout`                        | `""`                | PayPal REST client id; not secret.                                                                                                                                                                    |
| `paypal_client_secret`                            | if any service `needs_checkout`                        | `""`                | Sensitive; bound through Code Engine secrets only.                                                                                                                                                    |
| `paypal_expected_merchant_id`                     | if any service `needs_checkout`                        | `""`                | Merchant id checked against provider facts.                                                                                                                                                           |
| `checkout_store_id`                               | if any service `needs_checkout`                        | `""`                | Trusted store id bound into every checkout.                                                                                                                                                           |
| `checkout_*_hmac_keys`                            | if any service `needs_checkout`                        | `{}`                | Sensitive versioned keyrings; retain old versions through retention.                                                                                                                                  |
| `checkout_currency` / `checkout_tax_basis_points` | if checkout enabled                                    | `""` / `-1`         | Explicit production pricing policy.                                                                                                                                                                   |
| `checkout_reconciliation_schedule`                | no                                                     | `*/5 * * * *`       | Applied out of band; Terraform provider has no cron resource.                                                                                                                                         |
| `checkout_reconciliation_time_zone`               | no                                                     | `UTC`               | IANA time zone for the out-of-band cron subscription.                                                                                                                                                 |
| `checkout_v2_writes_enabled`                      | no                                                     | `false`             | Keep false for the compatibility release; enable only after every instance reads V1 and V2.                                                                                                           |
| `customer_loyalty_enabled`                        | no                                                     | `false`             | Requires V2 writes and all loyalty storage/index/recovery/operations gates.                                                                                                                           |
| `appid_region`                                    | if any service `needs_appid_secret` or verifies App ID | `us-south`          | Not sensitive.                                                                                                                                                                                        |
| `appid_customer_client_id`                        | if customer verification is enabled                    | `""`                | Non-secret customer audience. Bound to `capy-pos-api`; does not widen staff authorization.                                                                                                            |
| `appid_customer_client_secret`                    | customer token relay only                              | `""`                | Sensitive. Never bound to `capy-pos-api`, migration, or reconciliation.                                                                                                                               |
| `appid_tenant_id`                                 | if any service `needs_appid_secret`                    | `""`                | Not sensitive — matches `environment.*.ts`'s `appId.tenantId`.                                                                                                                                        |
| `appid_client_id`                                 | if any service `needs_appid_secret`                    | `""`                | Not sensitive — matches `environment.*.ts`'s `appId.staffClientId`.                                                                                                                                   |
| `appid_client_secret`                             | if any service `needs_appid_secret`                    | `""`                | Sensitive. The App ID staff application's client secret.                                                                                                                                              |
| `region`                                          | no                                                     | `us-south`          |                                                                                                                                                                                                       |
| `resource_group_name`                             | no                                                     | `Default`           |                                                                                                                                                                                                       |
| `project_name`                                    | no                                                     | `capy-pos`          | Code Engine project name.                                                                                                                                                                             |
| `cr_namespace`                                    | no                                                     | `capy-pos-3223793`  | Registry namespace holding every image — globally unique across every IBM Cloud account in the region, so the default carries this account's number.                                                  |
| `image_tag`                                       | always                                                 | —                   | Explicit immutable tag applied to every service that does not override it; `latest` is rejected.                                                                                                      |
| `services`                                        | no                                                     | 5 apps              | See below.                                                                                                                                                                                            |

There is **no `app_name` variable**. The frontend used to be a single hardcoded app
named by `var.app_name`; it is now the `capy-pos-app` key in `var.services`. Rename
the app by renaming that key — and read "Renaming the frontend app" first.

### The `services` map

Keyed by app name, which is also the image name inside `cr_namespace`:

```hcl
services = {
  capy-pos-app            = { image_port = 8080 }
  capy-vision-proxy       = { image_port = 8787, needs_model_key = true, needs_session_secret = true, needs_appid_verification = true, pins_cors_origins = true }
  capy-clerk-agent-relay  = { image_port = 8789, needs_model_key = true, needs_session_secret = true, needs_appid_verification = true, pins_cors_origins = true }
  capy-pos-api            = { image_port = 8790, needs_session_secret = true, needs_appid_verification = true, needs_customer_verification = true, needs_customer_loyalty = true, needs_cloudant = true, needs_checkout = true, pins_cors_origins = true }
  capy-appid-token-relay  = { image_port = 8792, needs_appid_secret = true, pins_cors_origins = true }
}
```

- `image_port` — what the container listens on. A mismatch is a revision that never
  passes its port check.
- `needs_model_key` — binds `ANTHROPIC_API_KEY` from a per-app secret.
- `needs_session_secret` — binds `SESSION_JWT_SECRET`, i.e. the service verifies the
  browser's session token itself.
- `pins_cors_origins` — binds `ALLOWED_ORIGINS` and requires `frontend_origins` (see
  "Two-pass apply"). Separate from `needs_session_secret`: pos-api has both guarded
  staff routes and capability-guarded public checkout routes, and all of its browser
  routes still require exact-origin CORS.
- `needs_cloudant` — binds Writer-scoped `CLOUDANT_URL`/`CLOUDANT_APIKEY` from the
  shared Cloudant instance's per-app secret.
- `needs_checkout` — binds server-only PayPal/HMAC configuration and, together with
  `needs_cloudant`, declares the checkout migration and reconciliation jobs.
- `needs_appid_secret` — binds `APPID_REGION`/`APPID_TENANT_ID`/`APPID_CLIENT_ID` as
  literal env and `APPID_CLIENT_SECRET` from a per-app secret. Only
  `capy-appid-token-relay` sets this. Unlike pos-api, this service also sets
  `pins_cors_origins` — it is not a one-pass, deploy-alone-first target; it needs
  `frontend_origins` set the same as the two model-key proxies do.
- `needs_appid_verification` — binds the same three staff literals as
  `needs_appid_secret`, but never the client secret: for a service that
  _verifies_ App ID's RS256 access tokens (`pos-api` and the two proxies)
  rather than minting them. It remains the generic staff audience.
- `needs_customer_verification` — additionally binds only the non-secret
  `APPID_CUSTOMER_CLIENT_ID` to `capy-pos-api` for its dedicated customer verifier.
  It never binds `APPID_CUSTOMER_CLIENT_SECRET` and never adds the customer audience
  to staff `authorize()`.
- `needs_customer_loyalty` — declares the profile/ledger database environment,
  compatibility/V2 flags, loyalty index migration, and reconciliation storage. It
  requires customer verification, checkout, and Writer-scoped Cloudant access.
- `image_tag`, `scale_*`, `env` — optional per-service overrides. Image-tag overrides
  must also be explicit immutable tags; `latest` is rejected. `env` merges last, so it
  can override `NODE_ENV`.

## Outputs

| Output                              | Use                                                        |
| ----------------------------------- | ---------------------------------------------------------- |
| `app_urls`                          | Every app's endpoint, keyed by app name.                   |
| `app_url`                           | The frontend's URL. This is what `frontend_origins` needs. |
| `vision_proxy_url`                  | Base for `visionApiUrl`; append `/vision/identify`.        |
| `clerk_agent_relay_url`             | Base for `clerkAgentApiUrl`; append `/clerk/agent`.        |
| `pos_api_url`                       | Base for `apiUrl`.                                         |
| `appid_token_relay_url`             | Base for `appId.relayUrl`; append `/appid/token`.          |
| `checkout_migration_jobs`           | Checkout migration job names keyed by service.             |
| `loyalty_migration_jobs`            | Loyalty migration job names keyed by service.              |
| `checkout_reconciliation_jobs`      | Checkout reconciliation job names keyed by service.        |
| `loyalty_reconciliation_jobs`       | Loyalty reconciliation job names keyed by service.         |
| `checkout_reconciliation_schedule`  | Out-of-band reconciliation cron expression.                |
| `checkout_reconciliation_time_zone` | Out-of-band reconciliation cron time zone.                 |
| `project_id`                        | Code Engine project id, for `ibmcloud ce project select`.  |
| `cr_namespace`                      | Registry namespace, for `docker push`.                     |

## Quick start

### 1. Build and push the images

Terraform references images; it does not build them. Each tag pushed here must match
`var.image_tag` (or the service's `image_tag`) or the revision pulls the wrong image.

**On Apple Silicon, `docker build` alone is not enough.** Code Engine's nodes are
`amd64`; a plain `docker build` on an M-series Mac produces `arm64` by default, and
that image will never start — it sits in `Not Ready` with `Initial scale was never
achieved` until the deploy's wait times out, with no more specific error anywhere
(confirmed live: this is exactly what happened to `capy-appid-token-relay`'s first
deploy). Use `docker buildx build --platform linux/amd64 ... --push` instead of
`docker build` + `docker push` on Apple Silicon — it cross-compiles correctly and
pushes in one step. On an Intel Mac or Linux, plain `docker build` already produces
`amd64` and needs no change.

```bash
ibmcloud cr login
export CR_NAMESPACE=capy-pos-3223793   # must match var.cr_namespace, and be globally unique
export TF_VAR_image_tag="<reviewed-pos-api-image-tag>"

docker build -t us.icr.io/$CR_NAMESPACE/capy-pos-app:v1 .
docker build -t us.icr.io/$CR_NAMESPACE/capy-vision-proxy:v1 infra/vision-proxy
docker build -t us.icr.io/$CR_NAMESPACE/capy-clerk-agent-relay:v1 infra/clerk-agent-relay
# pos-api's context is infra/, not infra/pos-api: it imports the DocumentStore
# port from infra/shared/, which Docker can only see if it's inside the context.
# Its app and checkout jobs share TF_VAR_image_tag so they cannot drift apart.
docker build -f infra/pos-api/Dockerfile -t us.icr.io/$CR_NAMESPACE/capy-pos-api:$TF_VAR_image_tag infra
docker build -t us.icr.io/$CR_NAMESPACE/capy-appid-token-relay:v1 infra/appid-token-relay
docker push us.icr.io/$CR_NAMESPACE/capy-pos-app:v1
docker push us.icr.io/$CR_NAMESPACE/capy-vision-proxy:v1
docker push us.icr.io/$CR_NAMESPACE/capy-clerk-agent-relay:v1
docker push us.icr.io/$CR_NAMESPACE/capy-pos-api:$TF_VAR_image_tag
docker push us.icr.io/$CR_NAMESPACE/capy-appid-token-relay:v1
```

On a first-ever apply, deploy the frontend alone to discover its URL before deploying
any CORS-pinned browser API, including pos-api. See "Two-pass apply" below. When later
targeting pos-api deliberately, remember that its checkout jobs and secrets are
separate resources; a targeted app-only apply does not create them.

### 2. Set the inputs

```bash
export TF_VAR_ibmcloud_api_key="…"
export TF_VAR_anthropic_api_key="sk-ant-…"
export TF_VAR_session_jwt_secret="…"       # must match the browser's, see below
# Keep the reviewed TF_VAR_image_tag exported from the build/push step above.

# Only needed once capy-appid-token-relay is in var.services:
export TF_VAR_appid_tenant_id="…"          # matches environment.*.ts's appId.tenantId
export TF_VAR_appid_client_id="…"          # matches environment.*.ts's appId.staffClientId
export TF_VAR_appid_client_secret="…"      # from the App ID instance's Applications tab

# Epic #261 item 25 — the CUSTOMER application, provisioned 2026-09-11.
# BOTH or NEITHER: a plan-time precondition rejects setting one without the other,
# because infra/appid-token-relay refuses to serve /appid/customer/token unless both
# exist, and Code Engine would keep serving the previous revision — so a one-sided
# apply breaks the service silently. Phase 5 lost ~10 hours to exactly that shape.
export TF_VAR_appid_customer_client_id="7a2cdfd6-a289-4b86-b415-58b9faf17cb5"
export TF_VAR_appid_customer_client_secret="…"   # capy-pos-customer, Applications tab

# Applying these makes POST /appid/customer/sign-up publicly reachable for the FIRST
# time. That is safe only because item 8b (duplicate-email/password validation, PR
# #305) and item 8c (per-IP rate limiting, PR #304) both landed first.
```

Checkout values are intentionally not illustrated with fake credentials or policy.
Set the required `TF_VAR_paypal_*` and `TF_VAR_checkout_*` values from the reviewed
production policy and secret source; never commit them.

### 3. Apply

```bash
cd terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan
terraform output
```

On a **first** deploy this plan fails on a missing `frontend_origins`. That is
deliberate, and the next section is why.

## Two-pass apply

`pins_cors_origins` needs `frontend_origins`, which is the frontend's own Code
Engine URL — an **output of this same apply**, so on a first deploy it does not exist
yet. (`needs_session_secret` and `needs_model_key` need `session_jwt_secret` and
`anthropic_api_key`, which you know up front — no cycle there.)

A browser-facing backend refuses to start without `ALLOWED_ORIGINS` (`requireConfig()`
in each proxy and `readAllowedOrigins()` in pos-api enforce it), because the alternative
— `Access-Control-Allow-Origin: *` in front of a metered model or checkout API — is the
thing these services must not do. So the module has a precondition on
`ibm_code_engine_app.apps` that fails the **plan** instead, rather than deploying
revisions that exit on boot and surface as a scaling failure.

Break the cycle in two passes:

```bash
# 1. Apply the frontend alone.
terraform apply -var 'services={"capy-pos-app"={image_port=8080}}'

# 2. Read its URL.
terraform output -raw app_url
# → https://capy-pos-app.abc123.us-south.codeengine.appdomain.cloud

# 3. Feed it back as a one-element list.
export TF_VAR_frontend_origins='["https://capy-pos-app.abc123.us-south.codeengine.appdomain.cloud"]'

# 4. Apply everything.
terraform apply
```

Already know the origin — a redeploy, or a custom domain? Set
`TF_VAR_frontend_origins` and apply once; there is no second pass.

`frontend_origins` is validated as `scheme://host[:port]` with no path and no trailing
slash, because it is compared against the request's `Origin` header verbatim. Multiple
origins (a Code Engine URL _and_ a custom domain) are a longer list; `main.tf` joins
them with commas for `readAllowedOrigins` in each guarded service to parse.

## Auth note: what `session_jwt_secret` actually buys

`session_jwt_secret` is the HS256 secret the proxies verify browser session tokens
against. It must be byte-identical to what `getJwtSecret()` in
`src/app/core/infrastructure/auth/session-issuer.ts` signs with; a mismatch is a 401
on every call, which looks exactly like a broken login.

**It bounds reachability, not identity.** The same secret is shipped to a public
browser bundle today, so anyone who can read the bundle can mint a token that
verifies. What the check buys is real but limited: an arbitrary internet caller
cannot spend the shop's model key, and the relay's cart tools are not an open
endpoint. What it does _not_ buy is proof of who the operator is. Treat the
`operatorId` in a proxy log as a hint, not an audit record.

Making it identity means moving issuance server-side (a real IdP, or asymmetric keys
with the private half only on a server) — tracked separately, not by this module.

## Renaming the frontend app

`moved.tf` maps `ibm_code_engine_app.app` → `ibm_code_engine_app.apps["capy-pos-app"]`.
Without it, Terraform reads the `for_each` generalization as "destroy the app serving
the till, create a new one with a new URL". Keep the block until every state file has
been applied through it, then it is safe to delete.

`moved` addresses cannot contain variables, so the index is the literal
`capy-pos-app`. Renaming that key in `var.services` without adding a matching `moved`
block is a destroy-and-recreate, and the new URL invalidates `frontend_origins`.

## Batch 4 compatibility rollout

Batch 4 is deliberately a two-release rollout because older checkout and transaction
parsers reject additional fields:

1. Deploy a reviewed compatibility image that reads V1 and V2 while still writing V1.
   Keep both `checkout_v2_writes_enabled=false` and `customer_loyalty_enabled=false`.
2. Provision `customer-profiles` and `loyalty-ledger`, then run both idempotent
   migration jobs. Verify mixed-version reads and that rollback to the compatibility
   image works.
3. Only after **every** running instance is on the compatibility image, set
   `checkout_v2_writes_enabled=true` and deploy.
4. Set `customer_loyalty_enabled=true` only after authenticated reads, exactly-once
   settlement, loyalty reconciliation, privacy projections, monitoring, retention,
   rebuild, and incident runbooks are approved.

After any V2 record exists, the rollback floor is the compatibility image. Never roll
back to a V1-only parser. Turning either flag off stops new V2/loyalty work as defined
by the application but does not make existing V2 documents readable by old code.

The profile database is a rebuildable projection. The ledger database is the
append-only award history. Runtime and reconciliation receive only the Writer key;
only migration receives Manager. `capy-pos-api` receives the public customer client
id for verification, never the customer client secret. That secret remains exclusive
to `capy-appid-token-relay`.

These declarations and instructions do not apply Terraform, deploy an image, submit a
job, create/update a schedule, or enable production loyalty. Every one of those is an
explicit reviewed operation.

## Checkout and loyalty jobs and scheduler

Terraform creates checkout jobs for every service that sets both `needs_checkout`
and `needs_cloudant`, plus a loyalty migration job when it sets
`needs_customer_loyalty`:

- `capy-pos-api-checkout-migration` runs only the idempotent Cloudant Mango-index
  migration. It receives the Manager Cloudant credential needed to create an index,
  but no PayPal or checkout-HMAC secrets.
- `capy-pos-api-loyalty-migration` creates and verifies the loyalty-ledger
  customer/sequence index and the completed-checkout loyalty-due index. It receives
  the Manager credential but no App ID, PayPal, checkout-HMAC, or customer secrets.
- `capy-pos-api-checkout-reconciliation` runs the bounded, lease-fenced payment
  state machine with PayPal and checkout-HMAC secrets.
- `capy-pos-api-loyalty-reconciliation` separately runs the completed-checkout
  loyalty obligations with only the Writer Cloudant credential. It receives no App ID,
  PayPal, checkout-HMAC, or customer client secret. Both jobs default to a 240-second
  application deadline below the 300-second Code Engine timeout.

The IBM Terraform provider version used here exposes `ibm_code_engine_job`, but no
Code Engine cron-subscription resource. Scheduling is therefore an explicit
post-apply operation. The following commands are intentionally **not** run by
Terraform:

```bash
ibmcloud ce project select --id "$(terraform output -raw project_id)"
MIGRATION_JOB="$(terraform output -json checkout_migration_jobs | jq -r '.["capy-pos-api"]')"
LOYALTY_MIGRATION_JOB="$(terraform output -json loyalty_migration_jobs | jq -r '.["capy-pos-api"]')"
RECONCILIATION_JOB="$(terraform output -json checkout_reconciliation_jobs | jq -r '.["capy-pos-api"]')"
LOYALTY_RECONCILIATION_JOB="$(terraform output -json loyalty_reconciliation_jobs | jq -r '.["capy-pos-api"]')"
RECONCILIATION_SCHEDULE="$(terraform output -raw checkout_reconciliation_schedule)"
RECONCILIATION_TIME_ZONE="$(terraform output -raw checkout_reconciliation_time_zone)"

# Run both idempotent migrations after creating or changing their indexes and
# before enabling V2 writes or loyalty.
ibmcloud ce jobrun submit --job "$MIGRATION_JOB" --wait
ibmcloud ce jobrun submit --job "$LOYALTY_MIGRATION_JOB" --wait

# Create the reconciliation schedule once from the reviewed Terraform inputs.
ibmcloud ce subscription cron create \
  --name "$RECONCILIATION_JOB" \
  --destination "$RECONCILIATION_JOB" \
  --destination-type job \
  --schedule "$RECONCILIATION_SCHEDULE" \
  --time-zone "$RECONCILIATION_TIME_ZONE"

ibmcloud ce subscription cron create \
  --name "$LOYALTY_RECONCILIATION_JOB" \
  --destination "$LOYALTY_RECONCILIATION_JOB" \
  --destination-type job \
  --schedule "$RECONCILIATION_SCHEDULE" \
  --time-zone "$RECONCILIATION_TIME_ZONE"
```

If the subscription already exists, make the operation idempotent with `cron update`
using the same destination, destination type, schedule, and time zone. Inspect failed
runs without exposing their secret environment values:

```bash
ibmcloud ce jobrun logs --jobrun JOB_RUN_NAME
```

The worker emits only checkout IDs, error class names, and aggregate counters. A run
with isolated reconciliation failures exits non-zero so Code Engine retries it and
its failure remains visible to operational monitoring. Choose and document an alert
destination and retention policy before treating checkout as production-ready.

## Troubleshooting

**Plan fails: `… sets pins_cors_origins, so it needs TF_VAR_frontend_origins`**
Expected on a first deploy of a CORS-pinned service (vision-proxy, clerk-agent-relay,
pos-api, or appid-token-relay). See "Two-pass apply".

**Plan fails: `… needs a model key` / `Session verification needs TF_VAR_session_jwt_secret`**
The precondition on the secret. Export the variable; never commit it.

**A revision will not scale up**

```bash
ibmcloud ce project select --name capy-pos
ibmcloud ce app get  --name capy-vision-proxy
ibmcloud ce app logs --name capy-vision-proxy
```

A container that logs `Refusing to start` is missing `SESSION_JWT_SECRET` or
`ALLOWED_ORIGINS`. `ibmcloud ce app get` prints the revision's env; secrets appear as
references, not values, which is why the keys are bound with `secret_key_reference`
rather than as literals.

**Every call 401s** — `session_jwt_secret` does not match the browser's. Compare
against `getJwtSecret()`.

**Every call 403s with `Origin is not allowed`** — the browser's origin is not in
`frontend_origins`. Check for a trailing slash or a missing port.

**Authentication errors from the provider**

```bash
ibmcloud login --apikey "$TF_VAR_ibmcloud_api_key"
```

## State

Single root module, single state. `terraform state list`,
`terraform state show ibm_code_engine_app.apps['capy-vision-proxy']`. Use a remote
backend for anything shared; a local `terraform.tfstate` holds `session_jwt_secret`,
`anthropic_api_key`, and both generated Cloudant credentials in plaintext, and is
gitignored for that reason.

## Links

- [IBM Cloud Code Engine docs](https://cloud.ibm.com/docs/codeengine)
- [Terraform IBM provider](https://registry.terraform.io/providers/IBM-Cloud/ibm/latest/docs)
- [Project architecture](../docs/ARCHITECTURE.md)
