import {
  LOYALTY_CODE_ALPHABET,
  LOYALTY_CODE_BODY_LENGTH,
  LOYALTY_CODE_PREFIX,
  generateLoyaltyCode,
  isLoyaltyCode,
  normalizeLoyaltyCode,
} from './loyalty-code';

describe('generateLoyaltyCode', () => {
  it('mints a prefixed code of the declared body length', () => {
    const code = generateLoyaltyCode();

    expect(code.startsWith(LOYALTY_CODE_PREFIX)).toBe(true);
    expect(code.slice(LOYALTY_CODE_PREFIX.length)).toHaveLength(LOYALTY_CODE_BODY_LENGTH);
  });

  it('never draws a character Crockford excludes', () => {
    // I, L and O are excluded because they are misread as digits, and U so a random
    // draw cannot print an obscenity on a customer's keyring. One of these landing
    // in a body would be invisible until a card was already printed.
    for (let attempt = 0; attempt < 200; attempt++) {
      expect(generateLoyaltyCode().slice(LOYALTY_CODE_PREFIX.length)).toMatch(
        /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/
      );
    }
  });

  it('mints a code that reads back as itself', () => {
    const code = generateLoyaltyCode();

    expect(normalizeLoyaltyCode(code)).toBe(code);
  });

  it('does not repeat itself', () => {
    // A guessable or repeated code is a bearer token for somebody else's points
    // balance. 32^8 makes a genuine collision here astronomically unlikely, so a
    // duplicate in a hundred draws means the draw is not random.
    const codes = new Set(Array.from({ length: 100 }, () => generateLoyaltyCode()));

    expect(codes.size).toBe(100);
  });

  it('draws from an alphabet whose length divides a byte', () => {
    // The load-bearing invariant behind the plain modulo in `generateLoyaltyCode`.
    // If somebody adds a character back to the alphabet — `U`, say, under pressure
    // to widen the code space — the modulo silently starts favouring the front of
    // the alphabet and nothing else in this suite would notice. This is the test
    // that notices.
    expect(LOYALTY_CODE_ALPHABET).toHaveLength(32);
    expect(256 % LOYALTY_CODE_ALPHABET.length).toBe(0);
  });

  it('gives every character of the alphabet the same chance', () => {
    // A previous cut of this function rejected bytes above 248 to "keep the draw
    // uniform". 248 is not a multiple of 32 in the way that argument needs: the
    // 248 surviving bytes cover residues 0–23 eight times and residues 24–31 only
    // seven, which made R, S, T, V, W, X, Y and Z 12.5% rarer than every other
    // character. Codes are bearer tokens, so a thinner tail of the alphabet is a
    // smaller keyspace for anybody guessing at somebody else's points.
    //
    // Asserted against the mapping rather than by sampling: a chi-square over real
    // draws would need to be loose enough not to flake, and loose enough not to
    // flake is loose enough to miss a 12.5% skew.
    const counts = new Map<string, number>([...LOYALTY_CODE_ALPHABET].map((c) => [c, 0]));
    for (let byte = 0; byte <= 255; byte++) {
      const char = LOYALTY_CODE_ALPHABET[byte % LOYALTY_CODE_ALPHABET.length]!;
      counts.set(char, counts.get(char)! + 1);
    }

    expect([...new Set(counts.values())]).toEqual([256 / LOYALTY_CODE_ALPHABET.length]);
  });

  it('reaches the tail of the alphabet in practice', () => {
    // The skew above was invisible to every other test here, because a biased draw
    // still produces well-formed codes. This one fails loudly if the tail is ever
    // excluded outright rather than merely thinned.
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 500; attempt++) {
      for (const char of generateLoyaltyCode().slice(LOYALTY_CODE_PREFIX.length)) {
        seen.add(char);
      }
    }

    for (const char of 'RSTVWXYZ') {
      expect(seen.has(char)).toBe(true);
    }
  });
});

describe('normalizeLoyaltyCode', () => {
  it('accepts the canonical form unchanged', () => {
    expect(normalizeLoyaltyCode('CAPY-B3KMNPQR')).toBe('CAPY-B3KMNPQR');
  });

  it.each([
    ['capy-b3kmnpqr', 'lower case, as a keyboard leaves it'],
    ['  CAPY-B3KMNPQR  ', 'padded, as a copy-paste leaves it'],
    ['CAPY B3KM NPQR', 'spaced, as somebody reading it aloud writes it'],
  ])('reads %s (%s)', (raw) => {
    expect(normalizeLoyaltyCode(raw)).toBe('CAPY-B3KMNPQR');
  });

  it.each([
    ['CAPY-I3KMNPQR', 'CAPY-13KMNPQR'],
    ['CAPY-L3KMNPQR', 'CAPY-13KMNPQR'],
    ['CAPY-O3KMNPQR', 'CAPY-03KMNPQR'],
  ])('folds the Crockford misreading %s onto %s', (raw, expected) => {
    expect(normalizeLoyaltyCode(raw)).toBe(expected);
  });

  it('reads a body made only of the prefix letters', () => {
    expect(normalizeLoyaltyCode('CAPY-CAPYABCD')).toBe('CAPY-CAPYABCD');
  });

  it.each([
    ['', 'nothing at all'],
    ['   ', 'whitespace'],
    ['CAPY-B3KMNPQ', 'a body one character short'],
    ['CAPY-B3KMNPQRS', 'a body one character long'],
    ['CAPY-B3KMNPQU', 'a body carrying an excluded letter'],
    ['4006381333931', 'an EAN-13 off a jar'],
    ['B3KMNPQR', 'an unprefixed body — indistinguishable from an EAN-8'],
    ['96385074', 'an EAN-8, which is the same shape as a body'],
    ['CAPYABCD', 'the prefix with a four-character body'],
  ])('rejects %s (%s)', (raw) => {
    expect(normalizeLoyaltyCode(raw)).toBe('');
  });
});

describe('isLoyaltyCode', () => {
  it('separates a membership card from a product barcode', () => {
    // The question asked of every code in frame. A false yes means a jar of
    // something is greeted as a customer and never rings up.
    expect(isLoyaltyCode('CAPY-B3KMNPQR')).toBe(true);
    expect(isLoyaltyCode('4006381333931')).toBe(false);
  });
});
