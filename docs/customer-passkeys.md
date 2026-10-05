# Customer passkeys on /shop — design note

Status: **not built**. /shop customers sign in with email + password against the App ID customer
application (`AppIdCustomerAuthAdapter` → `infra/appid-token-relay` `/appid/customer/token`). This
note records how passkey sign-in could be layered on later, so the decision can be made with the
trade-offs in view.

## The constraint

IBM App ID Cloud Directory has no native WebAuthn for end users. Whatever we build, App ID still
issues the tokens, and the only grants the relay exposes are `password` and `refresh_token`. A
passkey therefore has to end in one of those two grants — or in a token minted by something other
than App ID, which pos-api would then have to trust.

## Option A — device-bound passkey that unlocks a stored refresh token (client only)

After a normal password sign-in, offer "Use a passkey on this phone next time". Register a platform
credential, and keep the App ID **refresh token** encrypted at rest (IndexedDB), with the key
released only after a successful local WebAuthn assertion (e.g. a PRF/`hmac-secret` extension output
used as the wrapping key, or, without PRF, a non-extractable WebCrypto key gated by the assertion
succeeding). Next visit: assertion → unwrap refresh token → `refresh_token` grant → fresh session.

- **Pros:** no relay or App ID changes; App ID stays the only token issuer; pos-api trust model
  unchanged. Revocation is "App ID revokes the refresh token".
- **Cons:** it is a convenience lock, not a second factor the server sees — the server only ever
  sees a refresh grant. Works only on the device that enrolled; lost when the refresh token expires
  or storage is cleared. PRF support is uneven (needs a fallback or feature gate). Persisting a
  refresh token beyond `sessionStorage` is a real change to today's "dies with the tab" posture and
  must never be enabled on shared devices (`/kiosk/shop`).

## Option B — relay-side WebAuthn ceremony that mints tokens (server)

The relay hosts `/appid/customer/passkey/{register,authenticate}/{options,verify}`, stores
credential public keys per App ID `sub`, verifies assertions server-side, then obtains tokens for
that user — either via a stored refresh token held by the relay, or by the relay signing its own
customer token that pos-api accepts alongside App ID's.

- **Pros:** a real phishing-resistant credential the server verifies; works across devices (synced
  passkeys); can become MFA later.
- **Cons:** the relay becomes an identity provider — new storage (credential table), challenge
  state, rate limits, account recovery, and a second token issuer pos-api must verify (or
  server-held refresh tokens, which is a credential vault). Much larger security review surface;
  needs Terraform + secrets changes. App ID's own token revocation no longer covers everything.

## Recommendation

Start with **A** if the goal is "don't make me type my password on my own phone": it is client-only,
reversible, and keeps App ID as the single issuer. Revisit **B** only if customer identity becomes
something the server must trust (loyalty, order history, pos-api customer verification turned on),
because then the credential needs to be verified server-side anyway.

## What the operator passkey code gives us

`src/app/core/infrastructure/auth/webauthn/` already has the hard, provider-agnostic parts:

- `webauthn-codec.ts` — CBOR / authenticator-data / COSE key parsing (pure). Reusable as-is for
  either option; for B it would move (or be mirrored) server-side.
- `ceremony-verifier.ts` — challenge, origin, RP ID, flags, sign-count and signature checks for
  registration and assertion. Reusable for B's relay verifier; for A, a local assertion check
  against the stored public key.
- `fake-authenticator.fixture.ts` — real-signature test authenticator; reuse for both.
- `webauthn-auth.adapter.ts` — the operator flow (Dexie-stored credentials, till PIN fallback,
  operator sessions). Not reusable directly: it is bound to the staff identity and local operator
  records. A customer variant would be a separate adapter behind `CUSTOMER_AUTH_GATEWAY` (or a
  decorator around `AppIdCustomerAuthAdapter`), keeping the customer/staff separation the
  route-scoped providers enforce.

`pin-policy.ts` is till-specific and has no customer use.
