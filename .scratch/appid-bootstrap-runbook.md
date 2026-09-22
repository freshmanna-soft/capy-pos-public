# App ID Bootstrap Runbook — Phase 0

Getting the root admin bootstrapped in IBM Cloud App ID, before any of Phase 3's code
gets written. Everything here is a one-time, out-of-band setup step in your IBM Cloud
account — none of it is something I can run for you (no console access, and the CLI/API
calls need your own IAM login, same restriction as `terraform apply` earlier).

At the end you'll have: a tenant ID, a staff application's client ID + secret, and one
real admin account whose token carries the right scope. Save those four values
somewhere safe (same place as the `capy-pos-terraform` API key) — Phase 3's code needs
them as environment/Code Engine config, never committed to git.

## 1. Create the App ID service instance

**Console:** [cloud.ibm.com/catalog](https://cloud.ibm.com/catalog) → search "App ID" →
create a new instance (Lite plan is fine for this pilot's scale). Name it something
like `capy-pos-staff` — you'll create a *separate* instance later for the customer
self-checkout pool (Phase 4), so name it now to keep the two straight.

**Verify:** once created, open the instance → note its **tenant ID** and **region**
(shown on the instance's Service credentials / overview page, or in the URL). You'll
need both for every step below and for Phase 3's config.

## 2. Create the staff application (client)

Inside the instance → **Applications** tab → Add application. Name it e.g.
`capy-pos-staff-web`.

**Verify:** the created application shows a **Client ID** and a **Secret** — click to
reveal the secret. Copy both now; the secret is only ever shown once or twice.

## 3. Confirm Cloud Directory is active, and turn self-registration OFF for this tenant

Instance → **Authentication** → **Cloud Directory**. Confirm it's **active** (it's the
identity provider Phase 3's password-grant login needs). Then check **Sign-up
options** / self-service settings — this is the staff tenant, and staff are
admin-added only per the earlier correction, so **self-service sign-up should be
disabled here**. (When you create the second, customer-facing instance for Phase 4,
this is exactly the toggle to flip the other way.)

If the console doesn't expose this cleanly, the equivalent API call is:
```bash
curl -X PUT "https://<region>.appid.cloud.ibm.com/management/v4/<tenantID>/config/idps/cloud_directory" \
  -H "Authorization: Bearer <your IAM token>" \
  -H "Content-Type: application/json" \
  -d '{"isActive": true, "config": {"selfServiceEnabled": true, "signupEnabled": false, "identityField": "email", "interactions": {"identityConfirmation": {"accessMode": "OFF"}, "welcomeEnabled": false, "resetPasswordEnabled": false, "resetPasswordNotificationEnable": false}}}'
```
(Get `<your IAM token>` via `ibmcloud iam oauth-tokens` in a terminal where you're
already logged in — same as any other IBM Cloud API call tonight.)

## 4. Add the one root-admin user

Instance → **Cloud Directory** → **Users** → **Add user**. Give it the real admin's
actual name/email and a real password (not a placeholder — this is the one account
everything else bootstraps from).

**Verify:** after creation, open the user record and copy its **user ID** (the
`subject`/`id` field — you'll need it in step 6). Console shows it on the user detail
page; via API it's the `id` field returned from:
```bash
curl -X POST "https://<region>.appid.cloud.ibm.com/management/v4/<tenantID>/cloud_directory/Users" \
  -H "Authorization: Bearer <your IAM token>" -H "Content-Type: application/json" \
  -d '{"active": true, "emails": [{"value": "<real-email>", "primary": true}], "password": "<real-password>"}'
```

## 5. Define an `admin` scope and role

Instance → **Authorization** (or **Roles**) → define a scope on your application
(e.g. `admin`), then create a role that includes it:
```bash
curl -X POST "https://<region>.appid.cloud.ibm.com/management/v4/<tenantID>/roles" \
  -H "Authorization: Bearer <your IAM token>" -H "Content-Type: application/json" \
  -d '{"name": "admin", "description": "Full Capy-POS admin", "access": [{"application_id": "<staff clientId from step 2>", "scopes": ["admin"]}]}'
```
**Verify:** the response includes the new role's `id` — copy it for the next step.

## 6. Assign the `admin` role to the one root-admin user

```bash
curl -X PUT "https://<region>.appid.cloud.ibm.com/management/v4/<tenantID>/users/<user id from step 4>/roles" \
  -H "Authorization: Bearer <your IAM token>" -H "Content-Type: application/json" \
  -d '{"roles": {"ids": ["<role id from step 5>"]}}'
```

## 7. The real confirmation — get a token and read what it actually carries

This is Phase 0's actual gate, not a formality — confirm the scope really lands where
we expect before anything downstream trusts it:
```bash
curl -X POST "https://<region>.appid.cloud.ibm.com/oauth/v4/<tenantID>/token" \
  -H "Authorization: Basic $(echo -n '<clientId>:<clientSecret>' | base64)" \
  -H "Accept: application/json" \
  -F 'grant_type=password' -F 'username=<real-email>' -F 'password=<real-password>'
```
Take the `access_token` from the response and decode its payload (paste into
[jwt.io](https://jwt.io) — decoding only, no verification needed for this check — or
`echo '<token middle segment>' | base64 -d`). Confirm the `scope` claim includes
`admin`.

**Bring that back here** — paste me the decoded claims (redact nothing sensitive is in
there, it's just claims) and I'll confirm it's shaped the way Phase 3's adapter will
expect, before we write a single line of `AppIdAuthAdapter` code against it.

## What to save, and where this feeds back into the plan

Save these four values now (password manager, wherever the Terraform secrets live):
- **Region** and **Tenant ID** (step 1)
- **Staff Client ID** and **Client Secret** (step 2)

These become `environment.appId`'s `region`/`tenantId`/`staffClientId` and the
`appid-token-relay` service's `APPID_CLIENT_SECRET` Code Engine secret in Phase 3 —
exactly the same "provision first, wire into code second" shape as tonight's IBM Cloud
API key for Terraform.
