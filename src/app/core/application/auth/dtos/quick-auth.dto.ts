/**
 * DTOs for quick sign-in at the till — the passkey and PIN paths.
 *
 * Deliberately says nothing about WebAuthn. The application layer's interest is
 * "can this device verify a person quickly, and who has set that up here"; the
 * ceremony that answers it belongs to the adapter.
 */

/**
 * What this device can actually offer, resolved at the moment the login screen
 * renders.
 *
 * Both flags are needed and they fail differently. `passkeySupported` is about
 * the browser and the hardware — no platform authenticator means the button
 * cannot work at all. `passkeyEnrolledHere` is about this till — support with
 * nothing enrolled would show a button that opens an OS prompt with no
 * credentials to pick from, which reads as broken rather than as "not set up
 * yet".
 */
export interface QuickAuthCapabilitiesDto {
  /** A platform authenticator (Touch ID, Windows Hello, Android fingerprint) exists. */
  readonly passkeySupported: boolean;
  /** At least one passkey has been enrolled on this device for this origin. */
  readonly passkeyEnrolledHere: boolean;
  /** At least one operator has set a PIN, so the PIN path is worth offering. */
  readonly pinAvailable: boolean;
}

/**
 * One enrolled passkey, for the "this device" list in settings.
 *
 * `label` is how the operator tells one entry from another when they have
 * enrolled on the counter till and the back-office laptop both. `lastUsedAt` is
 * what makes a stale entry safe to remove — nobody deletes a credential they
 * cannot identify.
 */
export interface PasskeySummaryDto {
  readonly credentialId: string;
  readonly label: string;
  /**
   * ISO-8601, or null when the stored timestamp could not be read.
   *
   * Nullable rather than defaulted because a database restored from a JSON snapshot
   * can carry timestamps that no longer parse, and an entry whose date is unknown is
   * still an entry the operator must be able to see and remove. A fabricated date
   * would be worse than an absent one — see `readInstant` in the adapter.
   */
  readonly createdAt: string | null;
  /** ISO-8601, or null when never used or unreadable. */
  readonly lastUsedAt: string | null;
}

/**
 * An operator offered on the PIN keypad.
 *
 * Names are shown before anyone has authenticated, which is a deliberate
 * trade-off and worth being explicit about: a shift picker that lists who works
 * here is normal at a counter and saves typing an email in front of a queue, but
 * it does disclose staff names to anyone standing at the till. Only operators
 * who have actually set a PIN are listed, so the disclosure is limited to people
 * who opted into this path.
 */
export interface QuickSignInOperatorDto {
  readonly operatorId: string;
  readonly displayName: string;
}
