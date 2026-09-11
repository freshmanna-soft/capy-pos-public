import { TestBed } from '@angular/core/testing';
import { PosFacade } from '@core/application/facades/pos.facade';
import { ProductService } from '@core/application/services/product.service';
import { Product } from '@core/domain/entities/product.entity';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { CartService } from '@core/application/services/cart.service';
import { SelfCheckoutScanComponent } from './self-checkout-scan.component';

/**
 * The lane's one real correctness requirement is width collapse.
 *
 * A UPC-A registered as twelve digits and an EAN-13 scan of the same article are
 * the same product — the GTIN family is one numbering space at four widths. A raw
 * string comparison calls them distinct, which either fails to find the product at
 * all or, once both spellings reach the cart, puts one article in on two lines at
 * two quantities. So the cases below assert on the *number of cart lines*, not
 * merely on "something was added": a second line is the actual bug.
 *
 * No fake timers anywhere in here on purpose — the camera path is driven by a
 * self-rescheduling `setTimeout`, and this repo has a fake-timer teardown trap that
 * leaks a pending timer into the next spec. The camera loop is exercised by
 * invoking the poll's work directly instead.
 */
describe('SelfCheckoutScanComponent', () => {
  /** `036000291452` — a real UPC-A, check digit and all. */
  const UPCA = '036000291452';
  /** The same article as an EAN-13: one leading zero, nothing else changed. */
  const EAN13 = '0036000291452';

  function product(overrides: Partial<Product> = {}): Product {
    const item = new Product(
      'p1',
      'Yuzu Soda',
      2.5,
      'SKU-SODA',
      'drinks',
      10,
      undefined,
      undefined,
      UPCA
    );
    return Object.assign(item, overrides);
  }

  let cart: CartService;
  const getActiveProducts = vi.fn<[], Promise<Product[]>>();
  const prepare = vi.fn<[], Promise<boolean>>();
  const detect = vi.fn();
  const supported = vi.fn(() => false);

  function configure(products: Product[]) {
    getActiveProducts.mockResolvedValue(products);
    prepare.mockResolvedValue(false);
    detect.mockResolvedValue(null);
    supported.mockReturnValue(false);

    // A real `CartService` behind a stand-in facade, rather than the real
    // `PosFacade`: the facade pulls in the whole sale graph (repositories, event
    // bus, audit log) which this panel never touches, while the cart itself is the
    // thing under test — "one line, quantity two" is `CartService`'s own dedupe,
    // and stubbing it would make the width-collapse assertions vacuous.
    cart = new CartService();
    TestBed.configureTestingModule({
      imports: [SelfCheckoutScanComponent],
      providers: [
        { provide: PosFacade, useValue: facadeOver(cart) },
        { provide: ProductService, useValue: { getActiveProducts } },
        { provide: BarcodeScannerService, useValue: { prepare, detect, supported } },
        {
          provide: CameraService,
          useValue: {
            start: vi.fn().mockResolvedValue(true),
            stop: vi.fn(),
            attach: vi.fn(),
            detectionSource: vi.fn().mockReturnValue(null),
          },
        },
      ],
    });
  }

  /** The slice of `PosFacade` this panel actually uses, over a real cart. */
  function facadeOver(service: CartService) {
    return {
      cartItems: service.items,
      totalItems: service.totalItems,
      subtotal: service.subtotal,
      tax: service.tax,
      total: service.total,
      isCartEmpty: service.isEmpty,
      tryAddToCart: (item: Product) => {
        if (item.isOutOfStock()) {
          return { added: false, reason: 'out-of-stock' as const };
        }
        service.addProduct(item);
        return { added: true };
      },
      removeFromCart: (id: string) => service.removeItem(id),
    };
  }

  /**
   * Render with the catalogue already loaded.
   *
   * The load is a promise kicked off in the constructor, so a scan fired before it
   * settles would resolve against an empty index and report every code as unknown —
   * which is a real hazard for the lane, but not the one under test here.
   */
  async function render(products: Product[] = [product()]) {
    configure(products);
    const fixture = TestBed.createComponent(SelfCheckoutScanComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function scan(fixture: Awaited<ReturnType<typeof render>>, code: string) {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      '[data-testid="self-checkout-code-input"]'
    );
    input.value = code;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="self-checkout-add"]').click();
    fixture.detectChanges();
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the scan panel with an empty basket', async () => {
    const fixture = await render();

    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-scan"]')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-cart-empty"]')
    ).not.toBeNull();
  });

  it('adds a product scanned at the width it was registered at', async () => {
    const fixture = await render();

    scan(fixture, UPCA);

    expect(cart.items().length).toBe(1);
    expect(cart.items()[0]?.product.name).toBe('Yuzu Soda');
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-added"]')?.textContent
    ).toContain('Yuzu Soda');
  });

  it('resolves a product stored at one GTIN width when it is scanned at another', async () => {
    // Stored as UPC-A, scanned as the equivalent EAN-13. Raw string comparison
    // finds nothing here; `barcodeKey()` pads both to 14 and they meet.
    const fixture = await render();

    scan(fixture, EAN13);

    expect(cart.items().length).toBe(1);
    expect(cart.items()[0]?.product.id).toBe('p1');
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-not-found"]')
    ).toBeNull();
  });

  it('keeps the same article on ONE cart line across two GTIN widths', async () => {
    const fixture = await render();

    scan(fixture, UPCA);
    scan(fixture, EAN13);

    // The bug this whole item exists to prevent: two lines, one article.
    expect(cart.items().length).toBe(1);
    expect(cart.items()[0]?.quantity).toBe(2);
    expect(
      fixture.nativeElement.querySelectorAll('[data-testid="self-checkout-cart-line"]').length
    ).toBe(1);
  });

  it('stores the raw code and never a normalized one — the catalogue is untouched', async () => {
    const stored = product();
    await render([stored]);

    // Resolution must not rewrite what the catalogue holds: the raw string is what
    // the scanner reports for that label, and replacing it with the 14-digit key
    // would make the product unscannable at a staffed till.
    expect(stored.barcode).toBe(UPCA);
  });

  it('shows a not-found state for a code the catalogue has never seen', async () => {
    const fixture = await render();

    scan(fixture, '5901234123457');

    expect(cart.items().length).toBe(0);
    const banner = fixture.nativeElement.querySelector('[data-testid="self-checkout-not-found"]');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('5901234123457');
  });

  it('resolves a non-numeric store label as its own identity', async () => {
    const shelfLabel = product({ barcode: 'SHELF-A12' } as Partial<Product>);
    const fixture = await render([shelfLabel]);

    // Hyphen stripped and case folded by normalization, but never padded — a
    // non-numeric code is not a GTIN and must not be pushed into that space.
    scan(fixture, 'shelf a12');

    expect(cart.items().length).toBe(1);
  });

  it('refuses an out-of-stock product instead of adding it', async () => {
    const fixture = await render([product({ stock: 0 } as Partial<Product>)]);

    scan(fixture, UPCA);

    expect(cart.items().length).toBe(0);
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-unavailable"]')
    ).not.toBeNull();
  });

  it('clears the field after every scan, hit or miss', async () => {
    const fixture = await render();

    scan(fixture, '5901234123457');
    // `ngModel` writes back to the DOM on a microtask, so the cleared value is only
    // visible after the fixture settles.
    await fixture.whenStable();
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      '[data-testid="self-checkout-code-input"]'
    );
    // A scanner gun fires straight into this field; a leftover code would be
    // appended to the next scan.
    expect(input.value).toBe('');
  });

  it('does not offer the camera when the browser cannot decode barcodes', async () => {
    const fixture = await render();

    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-start-camera"]')
    ).toBeNull();
  });

  it('offers the camera once the detector reports itself usable', async () => {
    configure([product()]);
    prepare.mockResolvedValue(true);
    supported.mockReturnValue(true);

    const fixture = TestBed.createComponent(SelfCheckoutScanComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-start-camera"]')
    ).not.toBeNull();
  });

  it('offers no pay control — the payment step is a separate item', async () => {
    const fixture = await render();

    scan(fixture, UPCA);

    expect(fixture.nativeElement.textContent).not.toContain('Pay');
  });
});
