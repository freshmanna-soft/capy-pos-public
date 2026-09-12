/**
 * Sign-up refusal → customer-facing copy.
 *
 * `infra/appid-token-relay/src/customer-signup.ts` deliberately answers with
 * machine answers and leaves the wording to this form (Epic #261 item 16), so
 * the mapping lives here, as a pure function rather than inside the component:
 * each refusal has its own copy for its own reason, and a pure function is what
 * lets each reason be asserted without a fixture.
 *
 * The gateway (`AppIdCustomerAuthAdapter.signUp`) rethrows the relay's `error`
 * string verbatim and attaches the HTTP status it arrived with, falling back to
 * `Customer sign-up returned <status>` for a body that carries nothing — which is
 * exactly the 429 case, whose body is deliberately content-free.
 *
 * So classification reads the status first and the wording second, and the two
 * are combined the way the relay itself combines them (`signupRefusal`: "the
 * status **and** the wording, in that order — so no wording on its own can turn
 * an outage into an answer"). Here the same discipline runs in the other
 * direction: no *status* on its own turns an unrelated refusal into password
 * copy. The relay answers `400` for its own request validation too
 * (`customer-signup-validate.ts`: "email must be a valid email address."), and a
 * shopper told their password broke a rule when their address was the problem
 * has been sent to fix the wrong field. Those request-validation refusals now get
 * copy of their own instead of the generic sentence, because they are permanent —
 * a retry of the same address or passphrase is refused identically — and each one
 * names the field it blames (see {@link RefusedField}).
 */

/**
 * Which of the form's two fields the customer has to change, or null when the
 * refusal blames neither (a rate limit, an outage).
 *
 * This replaced an `alreadyRegistered` flag, which existed to reveal a "Try
 * signing in" link on the 409 — a link that pointed at `/self-checkout`, where no
 * sign-in form exists (Epic #261 item 18 is unbuilt), so the most common refusal
 * ended in a dead end. The copy still says to try signing in, because the shopper
 * needs to know the address is taken; what the *form* does with a refusal is now
 * the thing this type carries, and it is a field association rather than a
 * navigation. WCAG 3.3.1 asks for the item in error to be identified, and until
 * this existed a refusal named a field in prose while every input stayed
 * `aria-invalid=null`.
 */
export type RefusedField = 'email' | 'password' | null;

/** What a customer is told, and (for 400) what App ID said they must change. */
export interface SignUpRefusalCopy {
  /** The sentence shown to the customer. */
  readonly message: string;
  /**
   * The tenant's password-policy explanation, when the refusal carried one.
   * Surfaced verbatim because it is the only part that says what to change.
   */
  readonly detail: string | null;
  /** The input to mark as the one in error, when the refusal blames one. */
  readonly field: RefusedField;
}

const DUPLICATE_COPY =
  'That email address already has an account. Try signing in instead — and check your inbox for a verification email if you never confirmed it.';

const POLICY_COPY = 'That password does not meet this store’s password rules.';

/**
 * Neutral on purpose. The 429 body says nothing (item 8c keeps it
 * content-free so it leaks nothing), so this invents no reason for it.
 */
const RATE_LIMITED_COPY = 'Too many sign-up attempts just now. Please try again shortly.';

/**
 * The relay's *own* request validation refused the address
 * (`customer-signup-validate.ts`), which is a permanent refusal: the same address
 * will be refused identically every time, so generic "please try again" copy sent
 * the shopper into a loop and named no field to fix. `customerEmailValidator` is
 * what should keep this unreachable — see its own note on the parity — and this is
 * the second line of defence for the day the two rules drift.
 */
const EMAIL_SHAPE_COPY =
  'That email address was not accepted. Check it for a typo — an address looks like name@example.com.';

/**
 * The relay refused the passphrase on *shape*, not on the tenant's policy — in
 * practice only its `MAX_PASSWORD_LENGTH` bound, since an empty one cannot leave
 * this form. Distinct from {@link POLICY_COPY} because nothing about the store's
 * rules is being reported, and equally permanent: worth its own sentence for the
 * same reason the email one is.
 */
const PASSWORD_SHAPE_COPY = 'That password could not be used. Try a shorter one.';

const GENERIC_COPY = 'We could not create your account just now. Please try again.';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '';
}

/**
 * The adapter's own message for a refusal that carried no body, and the ONLY
 * message a status is read out of. Start-anchored: prose can contain this
 * sentence's numbers but cannot begin with its wording.
 */
const NO_BODY_FALLBACK = /^Customer sign-up returned (\d{3})\b/;

/**
 * The status the relay answered with, when it can be known at all.
 *
 * Two channels, and deliberately only two: the `status` the adapter attaches to
 * what it throws, then {@link NO_BODY_FALLBACK} for the one message the adapter
 * composes itself.
 *
 * This used to scan the whole message for `\b\d{3}\b`, and that is a bug with a
 * name. App ID's policy explanation is forwarded verbatim and routinely quotes
 * its own bounds, so `"… Password must be between 8 and 100 characters."` was
 * read as status **100** — neither 400 nor null, so the policy branch was skipped
 * and `policyDetail` (the only part that says what to change) was dropped, on a
 * password that will be refused again every time it is retried. Every status a
 * refusal really carries now arrives as a number, so there is nothing left to
 * scrape out of a sentence written for a person.
 */
function statusOf(error: unknown, message: string): number | null {
  const carried = (error as { status?: unknown } | null)?.status;
  if (typeof carried === 'number') {
    return carried;
  }
  const embedded = NO_BODY_FALLBACK.exec(message.trim());
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
 * Required for the policy branch even when the status says `400`, because `400`
 * is not only the policy refusal: the relay answers it for its own request
 * validation too ("email must be a valid email address.", "password must be at
 * most 256 characters."). Status alone would put password-rules copy on an
 * address the shopper mistyped. The relay's policy body always leads with the
 * phrase above, so requiring it costs the real case nothing.
 */
function mentionsPasswordPolicy(message: string): boolean {
  return /password (?:policy|rules|requirements)/i.test(message);
}

/**
 * The relay's own request-validation refusals, matched *whole* rather than by
 * prefix.
 *
 * The relay composes these four itself (`customer-signup-validate.ts`) and they
 * are the entire body when it sends them, so the whole sentence is available to
 * match and matching all of it is what keeps the branch honest. A prefix would
 * have been enough for the relay and too much for App ID: its forwarded policy
 * explanation is prose about a person's password and routinely reads
 * `"Password must be between 8 and 100 characters."`, which starts exactly like
 * the passphrase refusal below and means the opposite of it — a *minimum*, answered
 * with "try a shorter one". The policy branch runs first and would normally catch
 * that sentence, but only while it arrives with the relay's lead phrase attached;
 * anchoring both ends means this branch is not the thing standing behind that
 * assumption.
 *
 * Bounds stay `\d+` rather than the literal 254/256: the number is the relay's to
 * change, and it is not what identifies the refusal.
 */
const EMAIL_SHAPE = /^email must be (?:a valid email address|at most \d+ characters)\.?$/i;
const PASSWORD_SHAPE = /^password (?:is required|must be at most \d+ characters)\.?$/i;

/** `400`, the status the relay refuses a password with (`PASSWORD_POLICY_STATUS`). */
const REFUSED_STATUS = 400;
const DUPLICATE_STATUS = 409;
const RATE_LIMITED_STATUS = 429;

/**
 * Classify a failed `signUp` into the copy the form shows.
 *
 * Deliberately total: an unrecognised failure (transport, missing relay config)
 * gets neutral copy rather than the raw error, which is never customer-facing.
 */
export function describeSignUpRefusal(error: unknown): SignUpRefusalCopy {
  const message = messageOf(error);
  const status = statusOf(error, message);

  // Tested before the policy branch: `DUPLICATE_EMAIL_MESSAGE` ends with "reset
  // your password", so a duplicate would otherwise read as a rejected password.
  if (status === DUPLICATE_STATUS || (status === null && mentionsExistingAccount(message))) {
    // The address is what the store refused, so it is the field to mark — the
    // shopper either signs in with it or registers a different one.
    return { message: DUPLICATE_COPY, detail: null, field: 'email' };
  }

  // Status only. Item 8c's limiter answers with no body on purpose, so there is
  // no wording to corroborate and none is wanted.
  if (status === RATE_LIMITED_STATUS) {
    return { message: RATE_LIMITED_COPY, detail: null, field: null };
  }

  // Status *and* wording — see {@link mentionsPasswordPolicy}. `null` is allowed
  // for the status because the real body is the policy sentence itself, never
  // `... returned 400`, so there is often nothing for {@link statusOf} to read.
  if ((status === REFUSED_STATUS || status === null) && mentionsPasswordPolicy(message)) {
    return { message: POLICY_COPY, detail: policyDetail(message), field: 'password' };
  }

  // The relay's own shape checks, after the policy branch so App ID's explanation
  // keeps its own copy. Both are permanent refusals of a specific field, which is
  // the two things generic copy got wrong about them: it invited a retry that
  // cannot succeed, and it pointed at nothing.
  const body = message.trim();
  if ((status === REFUSED_STATUS || status === null) && EMAIL_SHAPE.test(body)) {
    return { message: EMAIL_SHAPE_COPY, detail: null, field: 'email' };
  }
  if ((status === REFUSED_STATUS || status === null) && PASSWORD_SHAPE.test(body)) {
    return { message: PASSWORD_SHAPE_COPY, detail: null, field: 'password' };
  }

  return { message: GENERIC_COPY, detail: null, field: null };
}
