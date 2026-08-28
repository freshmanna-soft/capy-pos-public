/**
 * Loyalty-code identity — the string a returning customer shows the camera.
 *
 * This is the whole of the customer half of #174, and deliberately so: the
 * alternative on the table was face recognition, which stores special-category
 * biometric data to answer the same question by *resemblance*. A printed code
 * answers it by possession, and consent is the act of holding it up. Nothing here
 * is biometric and nothing here identifies a person who did not choose to be
 * identified.
 *
 * Read alongside `barcode.ts`, which does the same job for products and made the
 * same call: **normalize to compare, store what was issued.** The difference is
 * that a product barcode arrives from a manufacturer and we have to take it as it
 * is, whereas a loyalty code is one *we* mint — so the alphabet can be chosen to
 * survive being read aloud over a counter, typed in by hand, and printed on a
 * receipt that has been in a coat pocket.
 *
 * That is why the body is Crockford base32 rather than the more obvious hex or
 * base64. Crockford excludes `I`, `L`, `O` and `U` from the alphabet and folds the
 * first three onto the digits they are mistaken for, so `CAPY-B0ILED0G` and
 * `CAPY-B01LED0G` are the same card — and `U` is left out entirely so a random
 * draw cannot print an obscenity on a customer's keyring.
 */

/**
 * Marks a code as this shop's, so `ClerkFacade` can tell at a glance whether the
 * thing in frame is a customer or a jar of something.
 *
 * A prefix rather than a length check or a checksum, because the two code spaces
 * share one camera: an 8-digit EAN and an 8-character card body are the same
 * shape, and mistaking one for the other means either greeting a tin of beans or
 * charging a customer for their own membership.
 */
export const LOYALTY_CODE_PREFIX = 'CAPY-';

/** How many body characters follow the prefix. */
export const LOYALTY_CODE_BODY_LENGTH = 8;

/**
 * Crockford base32, in canonical order.
 *
 * `I`, `L`, `O` and `U` are absent by design — see the module note. 32^8 is about
 * 1.1e12 codes, so a shop that issues a card a minute for a century still draws
 * with a collision probability in the millionths.
 *
 * The length matters beyond the code space: it is exactly 32, which divides the
 * 256 values of a byte, and that is what lets `generateLoyaltyCode` draw uniformly
 * with a plain modulo. Exported so the spec can hold that invariant.
 */
export const LOYALTY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The misreadings Crockford defines as equal to a digit.
 *
 * Applied on the way *in* only. A code is stored in the alphabet it was minted
 * in, so this fixes the cashier's typing and the scanner's near-misses without
 * ever rewriting what was issued.
 */
const CROCKFORD_FOLD: Record<string, string> = { I: '1', L: '1', O: '0' };

const BODY_PATTERN = new RegExp(`^[${LOYALTY_CODE_ALPHABET}]{${LOYALTY_CODE_BODY_LENGTH}}$`);

/**
 * Mint a code for a customer who does not have one.
 *
 * Uses `crypto.getRandomValues` rather than `Math.random`: this is a bearer token
 * for someone's points balance, and a guessable one would let anybody claim
 * anybody's card by holding up a plausible barcode.
 *
 * The modulo is taken over every byte with no rejection step, which is the
 * opposite of the usual advice and is correct here for one reason: a byte holds
 * 256 values, the alphabet is 32 characters, and 256 is an exact multiple of 32.
 * Each character therefore claims exactly eight of the 256 byte values and the
 * draw is already uniform.
 *
 * Rejection sampling is what *would* bias it. Discarding bytes above the largest
 * multiple of 32 below 256 means discarding nothing — but rejecting above 248,
 * the arithmetic that looks right, leaves 248 usable bytes covering residues
 * 0–23 eight times and residues 24–31 only seven, making the last eight
 * characters of the alphabet (`R`–`Z`) 12.5% rarer than the rest. The invariant
 * this relies on is asserted in the spec, so changing the alphabet to a length
 * that does not divide 256 fails a test rather than quietly skewing the draw.
 */
export function generateLoyaltyCode(): string {
  const bytes = new Uint8Array(LOYALTY_CODE_BODY_LENGTH);
  crypto.getRandomValues(bytes);

  let body = '';
  for (const byte of bytes) {
    body += LOYALTY_CODE_ALPHABET[byte % LOYALTY_CODE_ALPHABET.length]!;
  }
  return LOYALTY_CODE_PREFIX + body;
}

/**
 * Reduce whatever arrived to the form a code is compared on.
 *
 * Case, surrounding whitespace, the internal spaces people add when reading eight
 * characters off a card, and the Crockford misreadings all collapse here.
 *
 * The prefix is **required**, and this is the one rule here worth arguing about.
 * The obvious kindness is to accept a bare body, since a cashier reading a code
 * off a receipt has no reason to type boilerplate — but an eight-character
 * Crockford body and an EAN-8 off a jar are the same shape, so a bare `96385074`
 * would normalize to a perfectly good membership card. `ClerkFacade` asks
 * `isLoyaltyCode` of every code in frame, so that kindness costs a product that
 * never rings up and a customer greeted as a tin of beans. The prefix is printed
 * on the card beside the bars; requiring it is what keeps the two code spaces from
 * overlapping.
 *
 * Returns the empty string for anything that cannot be a code, so callers can
 * treat "not a code" and "no code" identically.
 */
export function normalizeLoyaltyCode(raw: string): string {
  const compact = raw.trim().replace(/[\s-]/g, '').toUpperCase();
  if (compact.length === 0) {
    return '';
  }
  // The separator is stripped above rather than matched, so the prefix is compared
  // without it — `CAPY B3KMNPQR` and `CAPYB3KMNPQR` are the same card.
  const prefix = LOYALTY_CODE_PREFIX.replace('-', '');
  if (!compact.startsWith(prefix)) {
    return '';
  }
  const body = [...compact.slice(prefix.length)]
    .map((char) => CROCKFORD_FOLD[char] ?? char)
    .join('');
  return BODY_PATTERN.test(body) ? LOYALTY_CODE_PREFIX + body : '';
}

/**
 * Whether a string is a loyalty code at all.
 *
 * The question `ClerkFacade` asks of every code in frame before it looks anything
 * up, so it has to be cheap and it has to be certain: a false yes here means a
 * product barcode is treated as a membership card and never rings up.
 */
export function isLoyaltyCode(raw: string): boolean {
  return normalizeLoyaltyCode(raw).length > 0;
}
