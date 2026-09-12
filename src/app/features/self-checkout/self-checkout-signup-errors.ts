/**
 * Sign-up refusal → customer-facing copy.
 *
 * `infra/appid-token-relay/src/customer-signup.ts` deliberately answers with
 * machine answers and leaves the wording to this form (Epic #261 item 16), so
 * the mapping lives here, as a pure function rather than inside the component:
 * the three refusals each have their own copy for their own reason, and a pure
 * function is what lets each reason be asserted without a fixture.
 *
 * The gateway (`AppIdCustomerAuthAdapter.signUp`) rethrows the relay's `error`
 * string verbatim, and falls back to `Customer sign-up returned <status>` when
 * the body carries nothing — which is exactly the 429 case, whose body is
 * deliberately content-free. So classification reads, in order: an explicit
 * numeric `status` if the error carries one, the status embedded in that
 * fallback message, then the relay's own wording.
 */

/** What a customer is told, and (for 400) what App ID said they must change. */
export interface SignUpRefusalCopy {
  /** The sentence shown to the customer. */
  readonly message: string;
  /**
   * The tenant's password-policy explanation, when the refusal carried one.
   * Surfaced verbatim because it is the only part that says what to change.
   */
  readonly detail: string | null;
  /** True when the address already has an account — the form offers sign-in. */
  readonly alreadyRegistered: boolean;
}

const DUPLICATE_COPY =
  'That email address already has an account. Try signing in instead — and check your inbox for a verification email if you never confirmed it.';

const POLICY_COPY = 'That password does not meet this store’s password rules.';

/**
 * Neutral on purpose. The 429 body says nothing (item 8c keeps it
 * content-free so it leaks nothing), so this invents no reason for it.
 */
const RATE_LIMITED_COPY = 'Too many sign-up attempts just now. Please try again shortly.';

const GENERIC_COPY = 'We could not create your account just now. Please try again.';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '';
}

/** The status the relay answered with, when it can be known at all. */
function statusOf(error: unknown, message: string): number | null {
  const carried = (error as { status?: unknown } | null)?.status;
  if (typeof carried === 'number') {
    return carried;
  }
  const embedded = /\b(\d{3})\b/.exec(message);
  return embedded ? Number(embedded[1]) : null;
}

/**
 * The relay's 400 body is `<policy message> <App ID's explanation>`, so the
 * explanation is whatever follows our own lead sentence. Returned as null when
 * the relay judged App ID's wording unfit to show and sent nothing extra.
 */
function policyDetail(message: string): string | null {
  const trimmed = message.trim();
  const explanation = /password.*?[.:]\s*(.+)$/is.exec(trimmed)?.[1]?.trim();
  return explanation && explanation.length > 0 ? explanation : null;
}

/**
 * The relay's duplicate wording (`DUPLICATE_EMAIL_MESSAGE`) never says
 * "already" — it says the address cannot be used and that the account may be
 * theirs. It *does* mention "password" (reset yours), so this has to be tested
 * before the policy branch or a duplicate reads as a rejected password.
 */
function mentionsExistingAccount(message: string): boolean {
  return /already|exists|registered|duplicate|cannot be used to sign up|account is yours|sign(?:ing)? in instead/i.test(
    message
  );
}

/**
 * The relay's own policy wording (`PASSWORD_POLICY_MESSAGE`: "does not meet the
 * password policy for this store"), matched as a phrase rather than on the bare
 * word "password".
 *
 * That looseness is what let `403 "Invalid email or password"` — the refusal a
 * `PENDING` account's password grant produced — be read here as a rejected
 * password, telling the customer to change something that was never wrong. The
 * grant is gone (`AppIdCustomerAuthAdapter.signUp` no longer chases the `201`),
 * so nothing sends that message today; the narrow phrase is what stops the *next*
 * stray error mentioning a password from acquiring policy copy by accident.
 *
 * Needed at all because a real `400` usually carries no readable status: the
 * relay's body is the policy sentence itself, not `... returned 400`, so
 * {@link statusOf} finds nothing to parse and the wording is all there is.
 */
function mentionsPasswordPolicy(message: string): boolean {
  return /password (?:policy|rules|requirements)/i.test(message);
}

/**
 * Classify a failed `signUp` into the copy the form shows.
 *
 * Deliberately total: an unrecognised failure (transport, missing relay config)
 * gets neutral copy rather than the raw error, which is never customer-facing.
 */
export function describeSignUpRefusal(error: unknown): SignUpRefusalCopy {
  const message = messageOf(error);
  const status = statusOf(error, message);

  if (status === 409 || (status === null && mentionsExistingAccount(message))) {
    return { message: DUPLICATE_COPY, detail: null, alreadyRegistered: true };
  }

  if (status === 429) {
    return { message: RATE_LIMITED_COPY, detail: null, alreadyRegistered: false };
  }

  if (status === 400 || (status === null && mentionsPasswordPolicy(message))) {
    return { message: POLICY_COPY, detail: policyDetail(message), alreadyRegistered: false };
  }

  return { message: GENERIC_COPY, detail: null, alreadyRegistered: false };
}
