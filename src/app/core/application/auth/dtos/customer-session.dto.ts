/**
 * CustomerSessionDto
 *
 * Read model returned after a successful customer authentication or
 * self-registration (Epic #261). The customer-side counterpart of
 * {@link AuthSessionDto}, deliberately a separate type rather than a reuse:
 * a customer identity has no tenant *memberships* and no tenant switching —
 * it is scoped to the one store it signed up against, holding a single
 * low-privilege `customer` role. Modelling that as an `AuthSessionDto` with
 * an always-empty `memberships` array would invite the multi-tenant code
 * paths (`switchTenant`, `availableTenantIds`) to be pointed at it.
 */
export interface CustomerSessionDto {
  /** App ID subject for this customer — NOT an `operatorId`, and not a Dexie `Customer.id`. */
  readonly customerId: string;
  /** The email the customer registered with; shown in the self-checkout header. */
  readonly email: string;
  /** The single store this identity belongs to. */
  readonly tenantId: string;
  /** Role names — in practice the single `customer` role (see Epic #261 items 2/6). */
  readonly roles: readonly string[];
  /** Expanded permission strings (e.g. ['sale:process']) */
  readonly permissions: readonly string[];
  /** Signed JWT — treat as opaque in the presentation layer */
  readonly accessToken: string;
  /** ISO-8601 expiry timestamp */
  readonly expiresAt: string;
}
