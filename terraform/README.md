# Terraform Infrastructure for Capy-POS

Deploys the Capy-POS estate to **IBM Cloud Code Engine**: one project, one Container
Registry namespace, and N apps driven by the `services` map.

Everything in this directory is the live estate. `aws-demo/` is a dormant AWS
template kept for reference and is not applied by this root module — see
[`aws-demo/README.md`](aws-demo/README.md).

## What gets created

| Resource                                | Why                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `ibm_resource_group` (data)             | Where everything lands.                                                  |
| `ibm_cr_namespace.namespace`            | Holds every service image.                                               |
| `ibm_code_engine_project.project`       | One project for the estate.                                              |
| `ibm_code_engine_secret.cr_secret`      | Registry pull secret (`icr-secret`).                                      |
| `ibm_code_engine_secret.model_key`      | `ANTHROPIC_API_KEY`, one per app that sets `needs_model_key`.             |
| `ibm_code_engine_secret.session_jwt`    | `SESSION_JWT_SECRET`, one for the project, when any app is guarded.       |
| `ibm_code_engine_app.apps`              | `for_each` over `var.services`.                                          |

The apps are a `for_each` rather than one resource block per service on purpose:
the frontend, the vision proxy and the clerk relay differ only in a port, a tag and
which secrets they need. Adding `infra/pos-api` is a map entry, not a new file.

## Directory structure

```
terraform/
├── main.tf         # project, namespace, secrets, and the app loop
├── variables.tf    # inputs, including the `services` map
├── outputs.tf      # app URLs, project id, namespace
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
- IBM Cloud CLI (`ibmcloud`) with the Container Registry plugin
- Docker, to build and push the service images
- An IBM Cloud API key with Code Engine and Container Registry access

## Inputs

Set these as `TF_VAR_*` environment variables (never in a committed `.tfvars`):

| Variable              | Required                        | Default     | Notes                                                            |
| --------------------- | ------------------------------- | ----------- | ---------------------------------------------------------------- |
| `ibmcloud_api_key`    | always                          | —           | Sensitive. Also used as the registry pull password.              |
| `anthropic_api_key`   | if any service `needs_model_key`| `""`        | Sensitive. Bound as a secret, never as a literal env var.        |
| `session_jwt_secret`  | if any service is guarded       | `""`        | Sensitive. Must match `getJwtSecret()` — see the auth note below.|
| `frontend_origins`    | if any service is guarded       | `[]`        | List of `scheme://host[:port]`, no trailing slash.                |
| `region`              | no                              | `us-south`  |                                                                  |
| `resource_group_name` | no                              | `Default`   |                                                                  |
| `project_name`        | no                              | `capy-pos`  | Code Engine project name.                                        |
| `cr_namespace`        | no                              | `capy-pos`  | Registry namespace holding every image.                          |
| `image_tag`           | no                              | `latest`    | Applied to every service that does not override it.              |
| `services`            | no                              | 3 apps      | See below.                                                       |

There is **no `app_name` variable**. The frontend used to be a single hardcoded app
named by `var.app_name`; it is now the `capy-pos-app` key in `var.services`. Rename
the app by renaming that key — and read "Renaming the frontend app" first.

### The `services` map

Keyed by app name, which is also the image name inside `cr_namespace`:

```hcl
services = {
  capy-pos-app           = { image_port = 8080 }
  capy-vision-proxy      = { image_port = 8787, needs_model_key = true, guards_browser_calls = true }
  capy-clerk-agent-relay = { image_port = 8789, needs_model_key = true, guards_browser_calls = true }
}
```

- `image_port` — what the container listens on. A mismatch is a revision that never
  passes its port check.
- `needs_model_key` — binds `ANTHROPIC_API_KEY` from a per-app secret.
- `guards_browser_calls` — binds `SESSION_JWT_SECRET` and `ALLOWED_ORIGINS`, i.e. the
  service verifies the browser's session token itself.
- `image_tag`, `scale_*`, `env` — optional per-service overrides. `env` merges last,
  so it can override `NODE_ENV`.

## Outputs

| Output                  | Use                                                                      |
| ----------------------- | ------------------------------------------------------------------------ |
| `app_urls`              | Every app's endpoint, keyed by app name.                                  |
| `app_url`               | The frontend's URL. This is what `frontend_origins` needs.               |
| `vision_proxy_url`      | Base for `visionApiUrl`; append `/vision/identify`.                       |
| `clerk_agent_relay_url` | Base for `clerkAgentApiUrl`; append `/clerk/agent`.                       |
| `project_id`            | Code Engine project id, for `ibmcloud ce project select`.                 |
| `cr_namespace`          | Registry namespace, for `docker push`.                                    |

## Quick start

### 1. Build and push the images

Terraform references images; it does not build them. Each tag pushed here must match
`var.image_tag` (or the service's `image_tag`) or the revision pulls the wrong image.

```bash
ibmcloud cr login
export CR_NAMESPACE=capy-pos

docker build -t us.icr.io/$CR_NAMESPACE/capy-pos-app:v1 .
docker build -t us.icr.io/$CR_NAMESPACE/capy-vision-proxy:v1 infra/vision-proxy
docker build -t us.icr.io/$CR_NAMESPACE/capy-clerk-agent-relay:v1 infra/clerk-agent-relay
docker push us.icr.io/$CR_NAMESPACE/capy-pos-app:v1
docker push us.icr.io/$CR_NAMESPACE/capy-vision-proxy:v1
docker push us.icr.io/$CR_NAMESPACE/capy-clerk-agent-relay:v1
```

### 2. Set the inputs

```bash
export TF_VAR_ibmcloud_api_key="…"
export TF_VAR_anthropic_api_key="sk-ant-…"
export TF_VAR_session_jwt_secret="…"       # must match the browser's, see below
export TF_VAR_image_tag="v1"
```

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

`guards_browser_calls` needs three values: `anthropic_api_key`, `session_jwt_secret`
and `frontend_origins`. The first two you know up front. The third is the frontend's
own Code Engine URL — which is an **output of this same apply**, so on a first deploy
it does not exist yet.

A guarded container refuses to start without `ALLOWED_ORIGINS` (`requireConfig()` in
each proxy's `server.ts` calls `process.exit(1)`), because the alternative it replaces
— `Access-Control-Allow-Origin: *` in front of a metered model — is the thing these
services must not do. So the module has a precondition on
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
origins (a Code Engine URL *and* a custom domain) are a longer list; `main.tf` joins
them with commas for `readAllowedOrigins` in `session-guard.ts` to parse.

## Auth note: what `session_jwt_secret` actually buys

`session_jwt_secret` is the HS256 secret the proxies verify browser session tokens
against. It must be byte-identical to what `getJwtSecret()` in
`src/app/core/infrastructure/auth/session-issuer.ts` signs with; a mismatch is a 401
on every call, which looks exactly like a broken login.

**It bounds reachability, not identity.** The same secret is shipped to a public
browser bundle today, so anyone who can read the bundle can mint a token that
verifies. What the check buys is real but limited: an arbitrary internet caller
cannot spend the shop's model key, and the relay's cart tools are not an open
endpoint. What it does *not* buy is proof of who the operator is. Treat the
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

## Troubleshooting

**Plan fails: `… sets guards_browser_calls, so it needs TF_VAR_frontend_origins`**
Expected on a first deploy. See "Two-pass apply".

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
backend for anything shared; a local `terraform.tfstate` holds
`session_jwt_secret` and `anthropic_api_key` in plaintext and is gitignored for that
reason.

## Links

- [IBM Cloud Code Engine docs](https://cloud.ibm.com/docs/codeengine)
- [Terraform IBM provider](https://registry.terraform.io/providers/IBM-Cloud/ibm/latest/docs)
- [Project architecture](../docs/ARCHITECTURE.md)
