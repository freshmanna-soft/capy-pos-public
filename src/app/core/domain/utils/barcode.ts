/**
 * Barcode identity — turning what a scanner or a cashier gives us into the one
 * string this catalogue will key a product on.
 *
 * This exists because a product's barcode is an *identity*, and the till trusts it
 * absolutely: `ClerkFacade` looks a scanned code up and rings the result straight
 * into the cart at full confidence. Two products sharing a key is therefore not a
 * tidiness problem, it is a wrong price on a receipt — so the comparison has to be
 * done on a normalized form rather than on whatever characters arrived.
 *
 * **Normalize to compare; store what arrived.** The till's lookup
 * (`ClerkFacade.buildCodeIndex`) indexes `product.barcode` verbatim and looks up
 * the raw string `BarcodeDetector` reports — which for a UPC-E is the 8-digit
 * compressed form. Storing the expanded 12-digit equivalent instead would make
 * every UPC-E product unscannable at the counter: the same class of silent failure
 * this module exists to prevent, only inverted. So `barcodeKey` is for deciding
 * *"is this the same product?"*, and never for deciding what to save.
 */

/** What kind of code we appear to be holding. */
export type BarcodeKind = 'ean13' | 'ean8' | 'upca' | 'upce' | 'gtin14' | 'other';

export interface BarcodeDescription {
  /**
   * The canonical form, for display and comparison.
   *
   * Not necessarily what to store — see the note on `barcodeKey`. A UPC-E's
   * canonical form is its expanded UPC-A, but the till scans the compressed
   * original.
   */
  value: string;
  kind: BarcodeKind;
  /**
   * Whether the check digit agrees with the rest of the digits.
   *
   * Advisory, never a gate. Plenty of shops label their own stock with internal
   * Code 128 or store-printed labels that carry no check digit at all, and
   * refusing those would make the field unusable for exactly the products most
   * likely to be typed in by hand.
   */
  valid: boolean;
  /** True when the code carries no check digit to verify in the first place. */
  uncheckable: boolean;
}

/**
 * Reduce a scanned or typed code to its canonical form.
 *
 * Two jobs. The obvious one is stripping the spaces and hyphens people put in
 * when reading digits off a package. The load-bearing one is **expanding UPC-E**:
 * the scanner is configured to accept `upc_e`, and the 8-digit string it returns
 * for a tin of beans is a completely different string from the 12-digit UPC-A on
 * the same tin. Store both as they arrive and the same product enters the
 * catalogue twice under two keys that no string comparison would ever match —
 * which is precisely the duplicate this normalization exists to make visible.
 */
export function normalizeBarcode(raw: string): string {
  const digitsOrWord = raw.trim().replace(/[\s-]/g, '');
  if (digitsOrWord.length === 0) {
    return '';
  }
  // Only numeric codes have a canonical form worth deriving. Alphanumeric codes
  // (Code 39, Code 128, QR payloads) are identities in their own right and are
  // passed through untouched apart from case, so two spellings of the same
  // internal label still collide.
  if (!/^\d+$/.test(digitsOrWord)) {
    return digitsOrWord.toUpperCase();
  }
  return digitsOrWord.length === 8 && isUpcE(digitsOrWord)
    ? expandUpcE(digitsOrWord)
    : digitsOrWord;
}

/**
 * The check digit a GTIN's body should end with.
 *
 * One algorithm covers EAN-8, UPC-A and EAN-13 because they are the same scheme
 * at three lengths — a UPC-A is just an EAN-13 with a leading zero. Weights
 * alternate 3 and 1 walking *leftwards* from the last body digit, which is what
 * makes the length irrelevant.
 *
 * Deliberately not `luhnCheck` from the card-payment use case: that is mod-10
 * with doubling-and-casting-out-nines, a different algorithm for a different
 * numbering system, and reusing it here would validate the wrong things.
 *
 * @param body The code *without* its trailing check digit.
 */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    // Rightmost body digit weighs 3, then alternating.
    const weight = (body.length - 1 - i) % 2 === 0 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** True when a numeric GTIN's own check digit agrees with its body. */
export function isValidGtin(value: string): boolean {
  if (!/^\d+$/.test(value) || !GTIN_LENGTHS.has(value.length)) {
    return false;
  }
  const body = value.slice(0, -1);
  return gtinCheckDigit(body) === Number(value.slice(-1));
}

/**
 * Normalize a code and say what we think it is, for the field's status line.
 *
 * The point of showing this at all is that a mistyped digit is invisible in a row
 * of thirteen. "EAN-13, check digit doesn't match" turns a silent error into
 * something the person holding the box can fix.
 */
export function describeBarcode(raw: string): BarcodeDescription {
  const value = normalizeBarcode(raw);
  const kind = classify(raw, value);
  const uncheckable = kind === 'other';
  return {
    value,
    kind,
    valid: uncheckable ? true : isValidGtin(value),
    uncheckable,
  };
}

/** Lengths that carry a trailing check digit under the GTIN scheme. */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * The key two codes should be compared on to decide whether they are the same
 * product — and **only** for comparison.
 *
 * Deliberately different from what gets stored. The GTIN family is one numbering
 * space at four widths: a UPC-A is an EAN-13 with a leading zero, which is an
 * ITF-14 with two. So `036000291452` and `0036000291452` are the same article
 * printed differently, and comparing the strings would call them distinct and let
 * the same product into the catalogue twice. Padding every numeric code to 14
 * collapses all four widths onto one key.
 *
 * Non-numeric codes are their own identity and are returned as-is.
 */
export function barcodeKey(raw: string): string {
  const normalized = normalizeBarcode(raw);
  if (normalized.length === 0 || !/^\d+$/.test(normalized)) {
    return normalized;
  }
  return normalized.padStart(14, '0');
}

/**
 * Classify from both forms.
 *
 * The raw string is what decides `upce`: after expansion a UPC-E is
 * indistinguishable from any other UPC-A, and the person who just scanned the
 * short code is better served by being told it was recognized and expanded.
 */
function classify(raw: string, normalized: string): BarcodeKind {
  const rawDigits = raw.trim().replace(/[\s-]/g, '');
  if (rawDigits.length === 8 && isUpcE(rawDigits)) {
    return 'upce';
  }
  if (!/^\d+$/.test(normalized)) {
    return 'other';
  }
  switch (normalized.length) {
    case 8:
      return 'ean8';
    case 12:
      return 'upca';
    case 13:
      return 'ean13';
    case 14:
      // An ITF-14 carton code. Listed in GTIN_LENGTHS, so it has a check digit that
      // can be verified — classifying it as 'other' would mark it uncheckable and
      // quietly skip the one validation it supports.
      return 'gtin14';
    default:
      return 'other';
  }
}

/**
 * Whether 8 digits are a compressed UPC-E rather than an EAN-8.
 *
 * The two lengths collide, so something has to break the tie. A UPC-E always
 * carries number system 0 or 1 in its first digit; EAN-8 codes are allocated from
 * GS1 prefixes that do not start that way. Anything else with 8 digits is left as
 * an EAN-8 and validated as one — the wrong guess here costs a "check digit
 * doesn't match" hint, not a wrong price, because expansion is only attempted
 * when the compressed form's own check digit already agrees.
 */
function isUpcE(digits: string): boolean {
  if (digits[0] !== '0' && digits[0] !== '1') {
    return false;
  }
  const expanded = expandUpcE(digits);
  // A real UPC-E's check digit is the check digit of its expanded UPC-A. If that
  // doesn't hold, treating it as UPC-E would invent an identity.
  return isValidGtin(expanded);
}

/**
 * Expand a UPC-E to the UPC-A it stands for.
 *
 * The sixth of the six middle digits is a mode flag saying where the suppressed
 * zeros belong; the other five carry the manufacturer and product numbers between
 * them, split differently in each mode. The check digit is carried over unchanged
 * because it was computed over the expanded form to begin with.
 */
function expandUpcE(digits: string): string {
  const system = digits[0]!;
  const check = digits[7]!;
  const [d1, d2, d3, d4, d5, mode] = digits.slice(1, 7).split('') as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  switch (mode) {
    case '0':
    case '1':
    case '2':
      return `${system}${d1}${d2}${mode}0000${d3}${d4}${d5}${check}`;
    case '3':
      return `${system}${d1}${d2}${d3}00000${d4}${d5}${check}`;
    case '4':
      return `${system}${d1}${d2}${d3}${d4}00000${d5}${check}`;
    default:
      // 5–9: the mode digit is itself the last digit of the product number.
      return `${system}${d1}${d2}${d3}${d4}${d5}0000${mode}${check}`;
  }
}
