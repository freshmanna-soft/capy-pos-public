# ADR 0001: Durable customer identity and server-owned loyalty

- Status: Accepted
- Date: 2026-09-21
- Owners: Capy POS application and platform teams
- Applies to: authenticated self-checkout only

## Context

The self-checkout browser already receives an IBM App ID access token after customer sign-in. The
browser adapter verifies that token against the customer App ID application, but this is not a
server trust boundary.

`pos-api` currently has one App ID verification configuration. Terraform binds it to the staff
application audience, and generic API routes map verified subjects to staff-shaped `SessionClaims`.
Public checkout routes deliberately bypass that path and currently ignore the browser's
`Authorization` header.

The durable checkout and basket transaction records also have no customer binding. Their
create-request fingerprint contains only normalized line items, so replaying one idempotency key
cannot safely change a checkout from guest to customer or between customers.

The existing Angular/Dexie customer model is a separate namespace. It requires name, email, and
phone, uses a device-local id, and awards points locally during staff checkout. An App ID subject is
not a Dexie customer id, and email is neither stable enough nor sufficiently authoritative to bridge
the two models.

Cloudant provides compare-and-swap per document but no transaction across checkout, transaction,
profile, and ledger documents. The design must therefore tolerate a crash or ambiguous response at
every cross-document boundary without capturing or awarding twice.

## Decision drivers

1. Staff and customer audiences must remain isolated.
2. Guest checkout must keep working.
3. A present invalid customer bearer must not silently downgrade to guest.
4. A completed signed-in self-checkout must earn points at most once.
5. Payment completion and lane release must not depend on loyalty storage availability.
6. Reconciliation must work after browser storage, token, or session loss.
7. Customer history must not be exposed by a checkout capability.
8. Existing V1 checkout records and rolling deployments must remain recoverable.
9. Server code must not trust a browser total, customer id, tier, points, or payment state.
10. No automatic identity merge may use email.

## Decision

### 1. Separate customer authentication boundary

Add a customer-only App ID verifier. It is separate from staff `SessionClaims`, role resolution, and
`authorize()`.

Low-level issuer-keyed JWKS retrieval, RS256 signature verification, and registered-claim validation
may be shared. Verifier configuration, audience, scope interpretation, returned principal, and entry
points remain distinct.

A customer bearer is valid only when:

- the JWT algorithm is exactly `RS256`;
- the signing key belongs to the configured App ID issuer;
- signature, exact issuer, customer application audience, expiration, and optional not-before claims
  verify;
- `sub` is a non-empty string;
- the space-delimited scope contains `customer`.

`POST /api/self-checkout/checkouts` uses strict optional authentication:

- no `Authorization` header means guest;
- a present invalid, expired, wrong-issuer, wrong-audience, staff, or insufficient-scope bearer
  returns one neutral `401`;
- a presented bearer when customer verification is not configured returns `503`;
- invalid authentication never degrades to guest.

Checkout status and completion continue to use only the opaque checkout capability. They do not
require a fresh customer token, so token expiry, sign-out, kiosk restart, or background
reconciliation cannot orphan a paid checkout.

`GET /api/self-checkout/customer/loyalty` requires the exact customer bearer.

The service never persists or logs the raw bearer, email, decoded token, or payer data.

### 2. Durable identity and immutable checkout binding

The verified principal is:

```ts
interface CustomerPrincipal {
  readonly issuer: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly customerKey: string;
  readonly keyVersion: 'sha256-v1';
}
```

`tenantId` is trusted Capy tenant/store context. In the current deployment it is `default-tenant`;
App ID's tenant claim is not substituted for it.

`customerKey` is base64url SHA-256 over a versioned, length-delimited canonical tuple of Capy
tenant, issuer, and subject. It is a document identifier, not an authentication credential. Every
profile rechecks the full tuple, so a digest collision fails closed.

Every V2 checkout has an immutable binding:

```ts
type CheckoutCustomerBinding =
  | { readonly kind: 'guest' }
  | ({ readonly kind: 'customer' } & CustomerPrincipal);
```

The canonical create fingerprint includes normalized items plus this explicit guest/customer
binding. The same idempotency key therefore cannot change who owns or earns from the checkout.
Signing in after guest checkout creation does not rebind that checkout.

The financial transaction stores only the minimal internal `customerKey` and key version needed to
bind loyalty. Staff/public transaction projections strip those fields. Issuer, subject, email, and
the full principal do not enter transaction responses.

### 3. Versioned compatibility rollout

The current checkout and transaction parsers enforce exact object shapes. A new instance writing
additional fields would cause an old instance to reject those records. Batch 4 therefore uses two
phases:

1. Compatibility release: read V1 and V2 but continue writing V1.
2. V2 activation: only after every instance runs the compatibility release, enable V2 writes and
   customer loyalty through a server feature flag.

Rollback targets the compatibility release, never a V1-only revision.

V2 checkout, idempotency-claim, transaction, and receipt documents carry schema/fingerprint
versions. Missing versions mean V1.

A guest request may resolve an existing matching V1 item-only idempotency claim. An authenticated
request must conflict and can never inherit that claim. New V2 claims bind the explicit customer
identity.

### 4. Financial completion is independent of loyalty settlement

Inventory commit and one basket-level financial transaction remain the payment boundary. Once both
are durable, the checkout becomes `COMPLETED`, stores its authoritative receipt, and releases the
lane even when customer-profile or loyalty-ledger storage is unavailable.

A completed checkout also stores an embedded loyalty obligation:

```ts
type CheckoutLoyaltyProjection =
  | { readonly status: 'not-applicable' }
  | {
      readonly status: 'pending' | 'awarded' | 'manual-review';
      readonly customerKey: string; // internal only
      readonly pointsEarned: number;
      readonly policyVersion: 'self-checkout-usd-v1';
      readonly nextActionAt: string | null;
      readonly attempts: number;
      readonly lease: CheckoutLease | null;
    };
```

The obligation is embedded in the same checkout compare-and-swap that records financial completion.
Loyalty retry scheduling and leases are independent from the payment state machine's scheduling
fields.

The public checkout projection strips customer key, schedule, attempts, and lease. It exposes only
status, points, and policy version.

### 5. Minimal profile and append-only ledger

Use two Cloudant databases/stores.

A customer profile is keyed by `customerKey` and contains:

- the exact identity tuple and key version;
- status: `active`, `rebuilding`, or `quarantined`;
- finalized integer point balance and derived tier;
- last contiguous applied award sequence;
- at most one durable pending award;
- recovery generation and timestamps.

Profiles require no name, phone, or email.

A loyalty ledger entry has deterministic id:

```text
loyalty-earn:<base64url(checkoutId)>
```

It binds customer key, checkout id, financial transaction id, trusted store, currency and total
minor units, integer points, policy version, customer sequence, and one persisted award timestamp.

The ledger is the rebuildable source of award history. The profile balance/tier is a CAS-maintained
projection.

"Append-only" is enforced through a repository exposing only create, read, and bounded query
operations. The underlying Cloudant Writer identity remains technically capable of mutation, so IAM,
manual-access audit, periodic integrity checks, and an audited repair procedure are also required.

### 6. Recoverable exactly-once settlement

Every settlement attempt reads the deterministic ledger id before reserving a sequence.

1. If the ledger exists, validate its full immutable binding.
   - If the profile's contiguous watermark is at least the entry sequence, the award is finalized;
     reconstruct the checkout projection.
   - If the exact pending award exists, finish it.
   - A gap, non-matching pending award, or binding mismatch is corruption.
2. If the ledger is absent, CAS an active profile to reserve its next sequence as a pending award.
   - Persist checkout, transaction, amount, points, policy, sequence, and `awardedAt` before
     creating the ledger.
   - A different pending checkout causes bounded retry; the same checkout never receives another
     sequence.
3. Create the deterministic ledger entry from the persisted pending award.
   - A conflict is replay only when every binding matches.
4. CAS the profile to add points exactly once, advance the contiguous watermark, derive tier, and
   clear that exact pending award.
5. Under the dedicated checkout loyalty lease, CAS the checkout projection to `awarded` and clear
   its loyalty schedule/lease.

This ledger-first retry rule handles an ambiguous successful profile-finalization write: the retry
sees the ledger and finalized watermark and never reserves sequence `N+1`.

The worker asserts or renews its checkout loyalty lease immediately before profile reserve, ledger
create, profile finalize, and checkout projection write. Deterministic bindings still make a stale
duplicate harmless if lease loss races a cross-document call.

Retryable storage failures keep the checkout loyalty obligation pending with bounded backoff.
Schema/binding corruption quarantines the customer profile, marks only loyalty as manual review,
alerts using non-PII references, and requires audited repair. It never reverses financial completion
or holds the lane.

### 7. Rebuild and missing-profile behavior

A missing profile must not silently start at zero if ledger history exists.

Before zero-profile creation, query for existing ledger history. If history exists, create or CAS
the profile into `rebuilding`, block new awards for the customer, page ledger entries under one
recovery generation, require unique contiguous sequences and exact bindings, and install the rebuilt
projection only if that generation remains unchanged.

Malformed records, gaps, or inconsistent bindings quarantine the profile rather than guessing.

### 8. Loyalty policy V1

Server policy `self-checkout-usd-v1` is integer-only and order-independent:

- `10 * floor(totalMinorUnits / 100)` points;
- total is the server-owned, tax-inclusive quote total;
- tiers are Bronze at 0, Silver at 1,000, Gold at 5,000, and Platinum at 10,000 finalized points;
- no tier or promotion multiplier;
- guests earn nothing;
- authenticated totals below one whole USD produce a final zero-point award without a ledger entry;
- no redemption, expiration, transfer, merge, refund clawback, or retroactive guest claim in V1.

The order-independent formula prevents concurrent checkouts from earning different values based on
which one obtains the profile first.

The existing device-local staff/Dexie policy remains unchanged and separate. Unifying balances or
policies requires another ADR and migration.

### 9. Public projections and browser state

A checkout capability can return only:

```ts
type PublicCheckoutLoyalty =
  | { readonly status: 'not-applicable' }
  | {
      readonly status: 'pending' | 'awarded' | 'manual-review';
      readonly pointsEarned: number;
      readonly policyVersion: 'self-checkout-usd-v1';
    };
```

It never exposes historical balance, identity, email, tier, customer key, sequence, schedule, or
lease.

The bearer-authenticated loyalty endpoint derives the caller's key and returns only finalized
balance, tier, policy version, projection status/time, and a neutral unavailable/manual-review state
when rebuilding or quarantined. It takes no customer-id parameter.

The Angular read model captures customer subject plus a monotonic session generation with every
request. It discards a response unless both still match, preventing customer A's in-flight response
from repopulating state after logout or customer B sign-in. It never writes server loyalty into the
Dexie customer repository.

All customer loyalty and checkout responses use `Cache-Control: no-store` and the configured
checkout CORS boundary.

### 10. Privacy and retention

App ID subject, customer key, profile, ledger, and internal transaction bindings are personal data.
Access is restricted to `pos-api`, reconciliation, and migration identities. Normal logs exclude
them.

V1 performs no automatic deletion. Production activation requires approved retention and
subject-deletion/pseudonymization procedures. Financial sale records are not silently deleted with a
loyalty profile.

## Rejected alternatives

- Email lookup or implicit merge with a Dexie customer.
- Adding the customer audience to staff `authorize()`.
- Accepting browser customer ids, totals, tier, points, or payment state.
- Persisting a bearer token for reconciliation.
- Requiring a fresh bearer to recover or finish a paid checkout.
- A mutable profile balance without an append-only ledger.
- Blocking financial completion or lane release on loyalty availability.
- Tier-multiplied V1 earnings whose value depends on concurrent processing order.
- Awarding points locally after server-completed self-checkout.

## Consequences

### Positive

- Staff/customer audience isolation stays explicit.
- Guest payment remains available.
- Idempotency cannot transfer a sale or award between identities.
- Financial receipts and lane release remain available during loyalty outages.
- Crash/retry and background reconciliation cannot award twice.
- Checkout capabilities reveal only checkout-local facts.
- No profile completion fields are required merely to pay or earn.

### Costs

- The checkout document gains a second durable schedule/lease concern.
- Profile/ledger reconciliation and rebuild require indexes and operational ownership.
- Rollout requires a compatibility release before V2 activation.
- The application operates two intentionally separate loyalty namespaces until a future migration.

## Rollout and rollback

1. Ship compatibility readers while writing V1.
2. Provision customer audience config, profile/ledger databases, and required indexes.
3. Verify mixed-version reads and rollback to the compatibility release.
4. Enable V2 writes behind a server flag.
5. Enable authenticated loyalty reads.
6. Verify sandbox exactly-once settlement, loyalty-outage receipt availability, reconciliation, and
   privacy projections.
7. Activate production loyalty only after policy, retention, IAM, monitoring, rebuild, and incident
   runbooks are approved.

No Terraform apply, Code Engine deployment, schedule mutation, production enablement, commit, push,
or pull request is implied by this ADR.

## Required verification

- Customer token cannot enter a staff route; staff token cannot become a customer.
- Invalid present bearer cannot downgrade to guest.
- Same idempotency key cannot change guest/customer ownership.
- V1 guest claim replays for guest but conflicts for authenticated create.
- Token expiry or logout after create cannot block completion or reconciliation.
- Crash or ambiguous success at every profile, ledger, and checkout write settles once.
- Profile finalization success with lost response does not allocate a second sequence.
- Loyalty outage still returns the financial receipt and releases the lane.
- Concurrent checkouts for one customer produce two contiguous entries and one correct balance.
- Lease loss at each loyalty boundary cannot duplicate an award.
- Rebuild blocks new awards and rejects gaps/corruption.
- Staff transaction responses contain no customer identity metadata.
- In-flight balance response from one customer cannot populate another session.
