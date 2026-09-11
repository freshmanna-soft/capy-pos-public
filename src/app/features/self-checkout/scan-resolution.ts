import { Product } from '@core/domain/entities/product.entity';
import { barcodeKey } from '@core/domain/utils/barcode';

/**
 * Scan resolution for the self-checkout lane — turning a scanned code into the
 * one product the customer is holding.
 *
 * **Store the raw code; compare on `barcodeKey()`.** The catalogue keeps
 * `product.barcode` exactly as it was registered, because that is the string a
 * scanner reports for that label (a UPC-E's compressed form included). The
 * comparison, though, cannot be a string comparison: the GTIN family is one
 * numbering space at four widths, so `036000291452` and `0036000291452` are the
 * same article printed differently. Comparing raw strings would resolve the two
 * to nothing, or — worse, once each spelling reaches the cart — put the same
 * article in as two separate lines at two separate quantities.
 *
 * `barcodeKey()` pads every numeric code to 14 digits, collapsing all four widths
 * onto one key, and leaves non-numeric codes (store-printed labels, Code 128)
 * alone as identities in their own right. Both sides of the lookup go through it,
 * which is what makes the width irrelevant.
 *
 * Deliberately not modelled on `ClerkFacade.buildCodeIndex()`, which indexes the
 * raw strings and therefore has exactly the width blindness described above.
 */
export type ScanIndex = ReadonlyMap<string, Product>;

/**
 * Index the catalogue by comparison key.
 *
 * Barcodes are laid down first and SKUs only fill keys no barcode claimed, so a
 * numeric SKU that happens to collide with another product's barcode cannot
 * shadow it — the barcode is the code physically on the item being scanned, and
 * resolving it to a different product would ring up the wrong price. The
 * precedence is decided by pass order rather than by array order, so it does not
 * depend on how the catalogue happens to come back from the repository.
 */
export function buildScanIndex(products: readonly Product[]): ScanIndex {
  const index = new Map<string, Product>();

  for (const product of products) {
    claim(index, product.barcode, product);
  }
  for (const product of products) {
    claim(index, product.sku, product);
  }

  return index;
}

/**
 * The product a scanned code refers to, or null when the catalogue has no such
 * article.
 *
 * Null is a first-class answer here, not an error: an unrecognized code is the
 * lane's most common failure and the customer needs to be told, not thrown at.
 */
export function resolveScannedCode(index: ScanIndex, raw: string): Product | null {
  const key = barcodeKey(raw);
  if (key.length === 0) {
    return null;
  }
  return index.get(key) ?? null;
}

/** Add a code under its comparison key, if it is a code at all and still free. */
function claim(index: Map<string, Product>, code: string | undefined, product: Product): void {
  const key = barcodeKey(code ?? '');
  if (key.length === 0 || index.has(key)) {
    return;
  }
  index.set(key, product);
}
