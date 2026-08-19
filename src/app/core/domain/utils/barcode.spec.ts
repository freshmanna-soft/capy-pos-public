import {
  barcodeKey,
  describeBarcode,
  gtinCheckDigit,
  isValidGtin,
  normalizeBarcode,
} from './barcode';

describe('gtinCheckDigit', () => {
  // One algorithm for three lengths, because a UPC-A is an EAN-13 with a leading
  // zero. Each body below is a real code with its published check digit.
  it.each([
    ['400638133393', 1, 'EAN-13'],
    ['9638507', 4, 'EAN-8'],
    ['03600029145', 2, 'UPC-A'],
    ['01234500006', 5, 'UPC-A from an expanded UPC-E'],
  ])('computes %s → %i (%s)', (body, expected) => {
    expect(gtinCheckDigit(body)).toBe(expected);
  });

  it('does not use the card-payment Luhn algorithm', () => {
    // Luhn doubles alternate digits and casts out nines; GTIN weights them 3 and 1.
    // They disagree on this body, and using the wrong one would accept mistyped
    // barcodes while rejecting valid ones.
    expect(gtinCheckDigit('03600029145')).toBe(2);
  });
});

describe('isValidGtin', () => {
  it.each(['4006381333931', '96385074', '036000291452', '012345000065'])('accepts %s', (value) => {
    expect(isValidGtin(value)).toBe(true);
  });

  it('rejects a single mistyped digit', () => {
    // The whole reason to show a check-digit hint: one wrong digit in thirteen is
    // invisible to the person reading it off a box.
    expect(isValidGtin('4006381333932')).toBe(false);
  });

  it.each(['', '123', '12345678901234567', 'ABC12345'])(
    'rejects %s, which carries no check digit to verify',
    (value) => {
      expect(isValidGtin(value)).toBe(false);
    }
  );
});

describe('normalizeBarcode', () => {
  it('strips the spaces and hyphens people add when reading digits aloud', () => {
    expect(normalizeBarcode(' 4006-3813 33931 ')).toBe('4006381333931');
  });

  it('expands UPC-E to the UPC-A it stands for', () => {
    // The load-bearing case. The scanner accepts upc_e, and its 8-digit output is
    // a different string from the 12-digit code on the same tin — stored as-is,
    // the same product enters the catalogue twice under two keys that no
    // comparison would match.
    expect(normalizeBarcode('01234565')).toBe('012345000065');
  });

  it.each([
    ['01234565', '012345000065', 'mode 5-9: the mode digit ends the product number'],
    ['04963406', '049000006346', 'mode 0: three zeros move into the middle'],
    ['01234531', '012300000451', 'mode 3'],
    ['01234543', '012340000053', 'mode 4'],
  ])('expands %s → %s (%s)', (upce, upca) => {
    expect(normalizeBarcode(upce)).toBe(upca);
    // Expansion has to preserve the identity, and the check digit is the proof:
    // it was computed over the expanded form in the first place.
    expect(isValidGtin(upca)).toBe(true);
  });

  it('leaves an EAN-8 alone rather than mistaking it for a compressed UPC', () => {
    // Both are eight digits. A UPC-E always opens with number system 0 or 1, so
    // anything else is an EAN-8 and is left to validate as one.
    expect(normalizeBarcode('96385074')).toBe('96385074');
  });

  it('passes an alphanumeric code through, upper-cased', () => {
    // Internal Code 39 / Code 128 labels are identities in their own right; the
    // casing fold is so two spellings of one shelf label still collide.
    expect(normalizeBarcode('shelf-a12')).toBe('SHELFA12');
  });

  it('returns empty for nothing, because most products legitimately have no code', () => {
    expect(normalizeBarcode('   ')).toBe('');
  });
});

describe('describeBarcode', () => {
  it.each([
    ['4006381333931', 'ean13'],
    ['96385074', 'ean8'],
    ['036000291452', 'upca'],
    ['01234565', 'upce'],
    ['SHELF-A12', 'other'],
  ])('classifies %s as %s', (raw, kind) => {
    expect(describeBarcode(raw).kind).toBe(kind);
  });

  it('reports a compressed code by what was scanned, not by what it became', () => {
    // After expansion a UPC-E is indistinguishable from any UPC-A, and the person
    // who just scanned the short code is better served by being told it was
    // recognized and expanded than by being shown a length they never typed.
    const described = describeBarcode('01234565');
    expect(described.kind).toBe('upce');
    expect(described.value).toBe('012345000065');
    expect(described.valid).toBe(true);
  });

  it('flags a bad check digit without refusing the value', () => {
    // Advisory, never a gate — the field still holds what was entered.
    const described = describeBarcode('4006381333932');
    expect(described.valid).toBe(false);
    expect(described.value).toBe('4006381333932');
  });

  it('treats a code with no check digit as valid rather than broken', () => {
    // Store-printed labels carry no check digit at all. Marking them invalid would
    // put a warning on exactly the products most likely to be typed by hand.
    const described = describeBarcode('SHELF-A12');
    expect(described.uncheckable).toBe(true);
    expect(described.valid).toBe(true);
  });
});

describe('barcodeKey', () => {
  it('collapses the four GTIN widths onto one key', () => {
    // A UPC-A is an EAN-13 with a leading zero, which is an ITF-14 with two. The
    // same article printed at a different width must not read as a second product.
    expect(barcodeKey('036000291452')).toBe(barcodeKey('0036000291452'));
    expect(barcodeKey('036000291452')).toBe('00036000291452');
  });

  it('gives a UPC-E the same key as the UPC-A it stands for', () => {
    expect(barcodeKey('01234565')).toBe(barcodeKey('012345000065'));
  });

  it('keeps genuinely different codes apart', () => {
    expect(barcodeKey('4006381333931')).not.toBe(barcodeKey('5901234123457'));
  });

  it('leaves a non-numeric code as its own identity', () => {
    // Padding a store label with zeros would be meaningless.
    expect(barcodeKey('SHELF-A12')).toBe('SHELFA12');
  });

  it('returns empty for no code, so it can never key a collision', () => {
    expect(barcodeKey('')).toBe('');
  });
});
