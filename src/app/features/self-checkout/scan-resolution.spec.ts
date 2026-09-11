import { Product } from '@core/domain/entities/product.entity';
import { buildScanIndex, resolveScannedCode } from './scan-resolution';

/**
 * The lookup, on its own.
 *
 * The component spec proves the lane behaves — this proves the resolution rules,
 * including the two the panel cannot reach through the DOM: that a product with no
 * barcode is still findable by its SKU, and that a numeric SKU cannot shadow
 * another product's barcode. Both are decisions `buildScanIndex` makes by pass
 * order, and neither shows up as a visible difference until the day it rings up the
 * wrong article at the wrong price.
 */
describe('scan resolution', () => {
  /** `036000291452` — a real UPC-A, check digit and all. */
  const UPCA = '036000291452';
  /** The same article as an EAN-13: one leading zero, nothing else changed. */
  const EAN13 = '0036000291452';
  /** And as an ITF-14 carton code: two. */
  const GTIN14 = '00036000291452';

  function product(
    id: string,
    overrides: { sku?: string; barcode?: string; name?: string } = {}
  ): Product {
    return new Product(
      id,
      overrides.name ?? `Item ${id}`,
      2.5,
      overrides.sku ?? `SKU-${id}`,
      'drinks',
      10,
      undefined,
      undefined,
      overrides.barcode
    );
  }

  describe('GTIN width collapse', () => {
    it.each([
      ['UPC-A', UPCA],
      ['EAN-13', EAN13],
      ['ITF-14', GTIN14],
    ])('resolves a UPC-A product scanned as %s', (_label, scanned) => {
      // One numbering space at four widths: padding to 14 is what makes these meet.
      const stored = product('p1', { barcode: UPCA });

      expect(resolveScannedCode(buildScanIndex([stored]), scanned)).toBe(stored);
    });

    it('resolves a UPC-E scan against the UPC-A it compresses', () => {
      // `04963406` is the compressed form of `049000006346`. Normalization expands
      // before the key is padded, so both forms land on the same key — the lane must
      // not care which of the two the label happens to carry.
      const stored = product('p1', { barcode: '049000006346' });

      expect(resolveScannedCode(buildScanIndex([stored]), '04963406')).toBe(stored);
    });

    it('keeps two genuinely different articles apart', () => {
      const soda = product('p1', { barcode: UPCA });
      const tea = product('p2', { barcode: '5901234123457' });
      const index = buildScanIndex([soda, tea]);

      expect(resolveScannedCode(index, EAN13)).toBe(soda);
      expect(resolveScannedCode(index, '5901234123457')).toBe(tea);
    });
  });

  describe('SKUs', () => {
    it('resolves a product that has no barcode by its SKU', () => {
      // Unbarcoded stock is normal — loose produce, in-store bakery — and the label
      // stuck on it carries the SKU.
      const loose = product('p1', { sku: 'BAKERY-07', barcode: undefined });

      expect(resolveScannedCode(buildScanIndex([loose]), 'bakery 07')).toBe(loose);
    });

    it("lets a barcode win over another product's colliding numeric SKU", () => {
      // The code is physically on the item being scanned, so the barcode owns it.
      // Resolving to the SKU holder would ring up a different article at a different
      // price — silently, and every time.
      const scanned = product('p1', { name: 'Yuzu Soda', barcode: UPCA });
      const collides = product('p2', { name: 'Sencha Tin', sku: EAN13 });

      // Either order of the catalogue: precedence is pass order, not array order.
      expect(resolveScannedCode(buildScanIndex([scanned, collides]), UPCA)).toBe(scanned);
      expect(resolveScannedCode(buildScanIndex([collides, scanned]), UPCA)).toBe(scanned);
    });

    it('leaves the shadowed product reachable by its own barcode', () => {
      // Losing the collided key must not cost the product every way in.
      const scanned = product('p1', { barcode: UPCA });
      const collides = product('p2', { sku: EAN13, barcode: '5901234123457' });
      const index = buildScanIndex([scanned, collides]);

      expect(resolveScannedCode(index, UPCA)).toBe(scanned);
      expect(resolveScannedCode(index, '5901234123457')).toBe(collides);
    });
  });

  describe('codes that resolve to nothing', () => {
    it('returns null for a code the catalogue has never seen', () => {
      expect(resolveScannedCode(buildScanIndex([product('p1')]), '5901234123457')).toBeNull();
    });

    it.each([
      ['an empty string', ''],
      ['whitespace and separators only', ' - '],
    ])('returns null for %s rather than matching an unbarcoded product', (_label, raw) => {
      // A product with no barcode keys to '' under `barcodeKey`; if that were
      // indexed, every empty decode would ring up whichever product came first.
      const noBarcode = product('p1', { sku: 'BAKERY-07', barcode: undefined });

      expect(resolveScannedCode(buildScanIndex([noBarcode]), raw)).toBeNull();
    });

    it('keeps the first of two products sharing a barcode', () => {
      // A data error, not a scan error. Answering with a stable first-wins beats
      // whichever the last pass happened to overwrite.
      const first = product('p1', { barcode: UPCA });
      const duplicate = product('p2', { barcode: EAN13 });

      expect(resolveScannedCode(buildScanIndex([first, duplicate]), GTIN14)).toBe(first);
    });
  });

  it('never rewrites what the catalogue holds', () => {
    // Storing the key would make the product unscannable at a staffed till, whose
    // decoder reports the raw label — a UPC-E's compressed form included.
    const stored = product('p1', { sku: 'SKU-SODA', barcode: UPCA });

    buildScanIndex([stored]);

    expect(stored.barcode).toBe(UPCA);
    expect(stored.sku).toBe('SKU-SODA');
  });
});
