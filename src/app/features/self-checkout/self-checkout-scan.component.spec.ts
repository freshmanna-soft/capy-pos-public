import { TestBed } from '@angular/core/testing';
import { PosFacade } from '@core/application/facades/pos.facade';
import { ProductService } from '@core/application/services/product.service';
import { Product } from '@core/domain/entities/product.entity';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { CartService } from '@core/application/services/cart.service';
import { ScannedCode } from '@core/infrastructure/media/barcode-gate';
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
 * Fake timers appear only in the camera group, which needs them: that path is a
 * self-rescheduling `setTimeout`. They come with `vi.useRealTimers()` in teardown
 * ahead of the shared one, which is the repo's known fake-timer trap — the shared
 * teardown awaits a real 0ms tick and never resolves while fake timers are still
 * installed, leaking a pending timer into whichever spec runs next.
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
  const cameraStart = vi.fn<[], Promise<boolean>>();
  const cameraStop = vi.fn();
  const attach = vi.fn();
  const detectionSource = vi.fn<[], HTMLVideoElement | null>();

  function configure(products: Product[]) {
    getActiveProducts.mockResolvedValue(products);
    prepare.mockResolvedValue(false);
    detect.mockResolvedValue(null);
    supported.mockReturnValue(false);
    cameraStart.mockResolvedValue(true);
    detectionSource.mockReturnValue(null);

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
            start: cameraStart,
            stop: cameraStop,
            attach,
            detectionSource,
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
   * The load is a promise kicked off in the constructor, so most cases want it
   * settled first. The scans that beat it are their own group below.
   */
  async function render(products: Product[] = [product()]) {
    configure(products);
    const fixture = TestBed.createComponent(SelfCheckoutScanComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /** A catalogue load this spec settles by hand. */
  function deferredCatalogue() {
    let arrive!: (products: Product[]) => void;
    let fail!: (reason: unknown) => void;
    const promise = new Promise<Product[]>((resolve, reject) => {
      arrive = resolve;
      fail = reject;
    });
    getActiveProducts.mockReturnValue(promise);
    return { arrive, fail };
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
    // Ahead of the shared teardown, which awaits a real 0ms tick and would never
    // resolve with fake timers still installed.
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
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

  it('ignores the add control when nothing has been entered', async () => {
    const fixture = await render();

    fixture.nativeElement.querySelector('[data-testid="self-checkout-add"]').click();
    fixture.detectChanges();

    // A bumped button is not a scan, and answering it with "we don't recognise" for
    // an empty code would be noise the customer has to read past.
    expect(cart.items().length).toBe(0);
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-not-found"]')
    ).toBeNull();
  });

  it('takes an item back out of the basket', async () => {
    const fixture = await render();
    scan(fixture, UPCA);

    fixture.nativeElement.querySelector('[data-testid="self-checkout-cart-line"] button').click();
    fixture.detectChanges();

    // Changing your mind at the lane has to work without staff.
    expect(cart.items().length).toBe(0);
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-cart-empty"]')
    ).not.toBeNull();
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

  /**
   * Scans that beat the catalogue.
   *
   * The load is a promise started in the constructor and a hardware gun fires the
   * instant a customer reaches the lane, so this window is not hypothetical. Every
   * case here is about one thing: a stocked item must never be reported as
   * unrecognized because of a race the customer cannot see.
   */
  describe('before the catalogue has loaded', () => {
    function renderPending() {
      configure([]);
      const catalogue = deferredCatalogue();
      const fixture = TestBed.createComponent(SelfCheckoutScanComponent);
      fixture.detectChanges();
      return { fixture, catalogue };
    }

    it('says the items are still coming', () => {
      const { fixture } = renderPending();

      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-catalogue-loading"]')
      ).not.toBeNull();
    });

    it('drops the hint once they arrive', async () => {
      const { fixture, catalogue } = renderPending();

      catalogue.arrive([product()]);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-catalogue-loading"]')
      ).toBeNull();
    });

    it('holds a scan and rings it up when the items arrive', async () => {
      const { fixture, catalogue } = renderPending();

      scan(fixture, EAN13);

      expect(cart.items().length).toBe(0);
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-waiting"]')?.textContent
      ).toContain(EAN13);
      // The bug this guards: a stocked article called unknown because the index was
      // still empty.
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-not-found"]')
      ).toBeNull();

      catalogue.arrive([product()]);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(cart.items().length).toBe(1);
      expect(cart.items()[0]?.quantity).toBe(1);
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-added"]')?.textContent
      ).toContain('Yuzu Soda');
    });

    it('holds only the last code — a customer who scanned twice is owed one', async () => {
      const { fixture, catalogue } = renderPending();

      scan(fixture, UPCA);
      scan(fixture, EAN13);

      catalogue.arrive([product()]);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(cart.items().length).toBe(1);
      expect(cart.items()[0]?.quantity).toBe(1);
    });

    it('still answers a held code that turns out to be unknown', async () => {
      const { fixture, catalogue } = renderPending();

      scan(fixture, '5901234123457');
      catalogue.arrive([product()]);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(cart.items().length).toBe(0);
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-not-found"]')?.textContent
      ).toContain('5901234123457');
    });

    it('sends the customer to a staffed till when the catalogue cannot be read', async () => {
      const { fixture, catalogue } = renderPending();

      scan(fixture, UPCA);
      catalogue.fail(new Error('offline'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-catalogue-error"]')
      ).not.toBeNull();
      // Neither a lie about the code nor a phantom add: the banner is the answer.
      expect(cart.items().length).toBe(0);
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-not-found"]')
      ).toBeNull();
    });

    it('reports a scan made after a failed load without inventing a verdict', async () => {
      const { fixture, catalogue } = renderPending();

      catalogue.fail(new Error('offline'));
      await fixture.whenStable();
      fixture.detectChanges();

      scan(fixture, UPCA);

      expect(cart.items().length).toBe(0);
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-not-found"]')
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-waiting"]')
      ).toBeNull();
    });
  });
  /**
   * The camera path.
   *
   * An accelerator, not the way in: `BarcodeDetector` is Chromium-only, so a lane on
   * Safari types instead. What it must never do is ring an item up more than the
   * customer presented it — a jar held up for two seconds decodes sixteen times.
   */
  describe('the camera path', () => {
    /** A code the decoder claims to see, big enough in frame to count. */
    function seen(value: string): ScannedCode {
      return { value, format: 'ean_13', box: { x: 0.35, y: 0.4, width: 0.3, height: 0.2 } };
    }

    /**
     * A lane with the camera on offer.
     *
     * The frame and the camera's answer are arguments rather than mocks set by the
     * caller beforehand, because `configure()` re-arms every double — an override
     * made before this call would be quietly undone inside it.
     */
    async function openLane(
      options: {
        products?: Product[];
        /** What the decoder reports each look, or `null` for "frame not examined". */
        frame?: ScannedCode[] | null;
        /** Whether the camera opens at all, and whether it yields a picture. */
        opens?: boolean;
        picture?: boolean;
      } = {}
    ) {
      vi.useFakeTimers();
      // jsdom has no media pipeline: `play()` is unimplemented and returns undefined,
      // which `bindPreview` would then call `.catch` on.
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      configure(options.products ?? [product()]);
      prepare.mockResolvedValue(true);
      supported.mockReturnValue(true);
      detect.mockResolvedValue(options.frame ?? null);
      cameraStart.mockResolvedValue(options.opens ?? true);
      detectionSource.mockReturnValue((options.picture ?? true) ? ({} as HTMLVideoElement) : null);

      const fixture = TestBed.createComponent(SelfCheckoutScanComponent);
      fixture.detectChanges();
      // The catalogue load and the detector probe are both promises started in the
      // constructor; the camera button does not exist until the probe has answered.
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      return fixture;
    }

    function startCamera(fixture: Awaited<ReturnType<typeof openLane>>) {
      fixture.nativeElement.querySelector('[data-testid="self-checkout-start-camera"]').click();
      fixture.detectChanges();
    }

    it('opens the camera and shows the customer what it sees', async () => {
      const fixture = await openLane();

      startCamera(fixture);
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();

      expect(cameraStart).toHaveBeenCalled();
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-preview"]')
      ).not.toBeNull();
      // Attached from both sides, because the element and the stream arrive in either
      // order and a video attached too late never gets any pixels.
      expect(attach).toHaveBeenCalled();
    });

    it('opens the camera once when the control is double-tapped', async () => {
      const fixture = await openLane();
      const start = fixture.nativeElement.querySelector(
        '[data-testid="self-checkout-start-camera"]'
      );

      // Two taps landing before Angular has swapped the button for "Stop camera" —
      // ordinary on a touch screen. A second `start()` would strand the first stream.
      start.click();
      start.click();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();

      expect(cameraStart).toHaveBeenCalledTimes(1);
    });

    it('falls back to typing when the camera will not open', async () => {
      const fixture = await openLane({ opens: false });

      startCamera(fixture);
      await vi.advanceTimersByTimeAsync(500);
      fixture.detectChanges();

      // A refused permission must leave the lane usable, not stuck on a dead preview.
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-preview"]')
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-start-camera"]')
      ).not.toBeNull();
      expect(detect).not.toHaveBeenCalled();
    });

    it('adds the article it decodes from a frame', async () => {
      const fixture = await openLane({ frame: [seen(EAN13)] });

      startCamera(fixture);
      await vi.advanceTimersByTimeAsync(300);
      fixture.detectChanges();

      // Decoded as an EAN-13, stored as a UPC-A: the same width collapse as the
      // typed path, reached through the camera.
      expect(cart.items().length).toBe(1);
      expect(cart.items()[0]?.product.id).toBe('p1');
    });

    it('rings one jar up once however many frames it appears in', async () => {
      const fixture = await openLane({ frame: [seen(UPCA)] });

      startCamera(fixture);
      await vi.advanceTimersByTimeAsync(1200);
      fixture.detectChanges();

      // Ten looks at the same jar is one jar. Without the gate it is ten.
      expect(detect.mock.calls.length).toBeGreaterThan(1);
      expect(cart.items().length).toBe(1);
      expect(cart.items()[0]?.quantity).toBe(1);
    });

    it('keeps looking through frames that were never examined', async () => {
      // Null is "not examined", not "nothing there" — a decode already in flight or a
      // video with no pixels yet. Ending the scan on it would hang the lane.
      const fixture = await openLane({ frame: null });

      startCamera(fixture);
      await vi.advanceTimersByTimeAsync(1000);
      fixture.detectChanges();

      expect(detect.mock.calls.length).toBeGreaterThan(1);
      expect(cart.items().length).toBe(0);
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-preview"]')
      ).not.toBeNull();
    });

    it('asks the decoder nothing until there is a picture', async () => {
      const fixture = await openLane({ picture: false });

      startCamera(fixture);
      await vi.advanceTimersByTimeAsync(1000);

      expect(detect).not.toHaveBeenCalled();
    });

    it('closes the camera when the customer puts it away', async () => {
      const fixture = await openLane();

      startCamera(fixture);
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      fixture.nativeElement.querySelector('[data-testid="self-checkout-stop-camera"]').click();
      fixture.detectChanges();

      expect(cameraStop).toHaveBeenCalled();
      expect(
        fixture.nativeElement.querySelector('[data-testid="self-checkout-preview"]')
      ).toBeNull();
    });

    it('closes the camera when the lane is left mid-scan', async () => {
      const fixture = await openLane();

      startCamera(fixture);
      await vi.advanceTimersByTimeAsync(0);
      fixture.destroy();

      // The shell navigating back to the till must not leave a customer-facing
      // camera running on the terminal.
      expect(cameraStop).toHaveBeenCalled();
    });
  });
});
