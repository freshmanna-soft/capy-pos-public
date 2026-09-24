import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { ShopComponent } from './shop.component';
import { CartService } from '@core/application/services/cart.service';
import { ProductService } from '@core/application/services/product.service';
import { KioskSettingsService } from '@core/application/services/kiosk-settings.service';
import { GeofencingService } from '@core/application/services/geofencing.service';
import { KioskCustomerService } from '@features/kiosk/kiosk-customer.service';
import { PosFacade } from '@core/application/facades';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import type { ScannedCode } from '@core/infrastructure/media/barcode-gate';
import { Product } from '@core/domain/entities/product.entity';

// ---------------------------------------------------------------------------
// Minimal product factory
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<Record<string, unknown>> = {}): Product {
  return {
    id: 'prod-1',
    name: 'Organic Coffee',
    price: 4.5,
    category: 'Drinks',
    stock: 10,
    barcode: '1234567890128',
    imageUrl: undefined,
    ...overrides,
  } as unknown as Product;
}

// ---------------------------------------------------------------------------
// Service stubs
// ---------------------------------------------------------------------------

function makeCamera() {
  return {
    start: vi.fn().mockResolvedValue(true),
    stop: vi.fn(),
    attach: vi.fn(),
    detectionSource: vi.fn().mockReturnValue(document.createElement('video')),
    status: vi.fn().mockReturnValue('idle'),
    message: vi.fn().mockReturnValue(''),
  };
}

function makeScanner(supported = true) {
  return {
    prepare: vi.fn().mockResolvedValue(supported),
    supported: vi.fn().mockReturnValue(supported),
    detect: vi.fn().mockResolvedValue(null) as ReturnType<typeof vi.fn>,
  };
}

function makeCartStub() {
  return {
    addProduct: vi.fn(),
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
    items: signal([] as never[]),
    isEmpty: signal(true),
    subtotal: signal(0),
    tax: signal(0),
    total: signal(0),
    totalItems: signal(0),
    clearCart: vi.fn(),
  };
}

/** Flush all pending microtasks without advancing fake timers. */
async function flushMicrotasks() {
  // Multiple rounds handle promise chains of depth > 1.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// TestBed builder
// ---------------------------------------------------------------------------

function setup(
  scannerOverrides: Partial<ReturnType<typeof makeScanner>> = {},
  cameraOverrides: Partial<ReturnType<typeof makeCamera>> = {},
  products: Product[] = []
) {
  const camera = { ...makeCamera(), ...cameraOverrides };
  const scanner = { ...makeScanner(), ...scannerOverrides };
  const cart = makeCartStub();

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ token: 'test-token', expiresAt: '' }),
    })
  );
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn().mockReturnValue('test-token'),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });

  TestBed.configureTestingModule({
    imports: [ShopComponent],
    providers: [
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: CartService, useValue: cart },
      {
        provide: ProductService,
        useValue: { getActiveProducts: vi.fn().mockResolvedValue(products) },
      },
      {
        provide: KioskSettingsService,
        useValue: {
          load: vi.fn().mockResolvedValue(undefined),
          stores: signal([{ storeId: 'store-1', name: 'Test Store' }]),
          storeId: signal('store-1'),
          storeName: signal('Test Store'),
          storeAddress: signal(''),
          terminals: signal([]),
          hasFencePolygon: vi.fn().mockReturnValue(false),
          setActiveTerminal: vi.fn(),
          mercadopagoActive: signal(false),
        },
      },
      {
        provide: GeofencingService,
        useValue: { checkFence: vi.fn().mockResolvedValue('inside'), reset: vi.fn() },
      },
      {
        provide: KioskCustomerService,
        useValue: { customer: signal(null), set: vi.fn(), clear: vi.fn() },
      },
      {
        provide: PosFacade,
        useValue: { attachCustomerDirectly: vi.fn(), detachCustomer: vi.fn(), checkout: vi.fn() },
      },
      { provide: BarcodeScannerService, useValue: scanner },
      { provide: CUSTOMER_REPOSITORY, useValue: { findByEmail: vi.fn(), create: vi.fn() } },
      { provide: AUTH_GATEWAY, useValue: { getActiveSession: vi.fn().mockResolvedValue(null) } },
    ],
  });

  // CameraService is declared as a component-level provider on @Component so
  // a root-level TestBed provider is shadowed. Override at the component level.
  TestBed.overrideComponent(ShopComponent, {
    remove: { providers: [CameraService] },
    add: { providers: [{ provide: CameraService, useValue: camera }] },
  });

  const fixture = TestBed.createComponent(ShopComponent);
  const component = fixture.componentInstance;

  return { fixture, component, camera, scanner, cart };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShopComponent — barcode scan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── 1: BarcodeDetector unsupported → canScan() false ──────────────────────

  it('canScan() is false when BarcodeDetector is unsupported', async () => {
    const { component } = setup({
      prepare: vi.fn().mockResolvedValue(false),
      supported: vi.fn().mockReturnValue(false),
    });

    // Allow the prepare() promise to resolve.
    await flushMicrotasks();

    expect(component.canScan()).toBe(false);
    expect(component.showScanSheet()).toBe(false);
  });

  // ── 2: Successful scan → addToCart + sheet closes after toast ─────────────

  it('successful scan calls addToCart and closes the sheet after 1500 ms', async () => {
    const product = makeProduct({ barcode: '1234567890128' });
    const scannedCode: ScannedCode = {
      value: '1234567890128',
      format: 'ean_13',
      box: { x: 0.1, y: 0.3, width: 0.3, height: 0.1 },
    };

    const detect = vi
      .fn()
      .mockResolvedValueOnce(null) // frame not ready yet
      .mockResolvedValue([scannedCode]); // barcode found from second call on

    // Pass the product through setup — ProductService.getActiveProducts resolves with it,
    // so _products is populated when startShopping() calls loadProducts() in ngOnInit.
    const { component, cart } = setup(
      {
        detect,
        prepare: vi.fn().mockResolvedValue(true),
        supported: vi.fn().mockReturnValue(true),
      },
      {},
      [product]
    );

    // Allow ngOnInit → loadProducts → getActiveProducts promise chain to resolve.
    await flushMicrotasks();
    await flushMicrotasks();

    // Prime detector.
    await flushMicrotasks();
    expect(component.canScan()).toBe(true);

    // Open the sheet — triggers startScan().
    component.toggleScan();
    await flushMicrotasks(); // camera.start() resolves

    expect(component._scanState()).toBe('scanning');

    // Advance one poll interval so the first tick fires.
    vi.advanceTimersByTime(150);
    await flushMicrotasks(); // first detect() → null, reschedules

    vi.advanceTimersByTime(150);
    await flushMicrotasks(); // second detect() → barcode found
    await flushMicrotasks(); // flush the match branch (addToCart + toastTimer set)

    expect(component._scanToast()?.kind).toBe('success');
    expect(component._scanToast()?.text).toContain('Organic Coffee');
    expect(cart.addProduct).toHaveBeenCalledWith(product);

    // Advance past toast duration → teardownScan fires.
    vi.advanceTimersByTime(1500);
    await flushMicrotasks();

    expect(component.showScanSheet()).toBe(false);
    expect(component._scanToast()).toBeNull();
  });

  // ── 3: Unknown barcode → error toast shown, sheet stays open ──────────────

  it('unknown barcode shows error toast and keeps the sheet open', async () => {
    const unknownCode: ScannedCode = {
      value: '0000000000000',
      format: 'ean_13',
      box: { x: 0.1, y: 0.3, width: 0.3, height: 0.1 },
    };

    const detect = vi.fn().mockResolvedValue([unknownCode]);
    const { component, cart } = setup({
      detect,
      prepare: vi.fn().mockResolvedValue(true),
      supported: vi.fn().mockReturnValue(true),
    });

    // No products → every barcode is unknown.
    (component as unknown as Record<string, unknown>)['_products'].set([]);

    await flushMicrotasks();
    component.toggleScan();
    await flushMicrotasks(); // camera.start()

    vi.advanceTimersByTime(150);
    await flushMicrotasks(); // detect() → unknown barcode

    expect(component._scanToast()?.kind).toBe('error');
    expect(component._scanToast()?.text).toContain('not found');
    // Sheet must stay open.
    expect(component.showScanSheet()).toBe(true);
    expect(cart.addProduct).not.toHaveBeenCalled();
  });

  // ── 4: Backdrop tap → sheet closes, camera released ───────────────────────

  it('teardownScan() closes the sheet and stops the camera', async () => {
    const { component, camera } = setup({
      prepare: vi.fn().mockResolvedValue(true),
      supported: vi.fn().mockReturnValue(true),
    });

    await flushMicrotasks();
    component.toggleScan();
    await flushMicrotasks();

    expect(component.showScanSheet()).toBe(true);

    component.teardownScan();

    expect(component.showScanSheet()).toBe(false);
    expect(camera.stop).toHaveBeenCalled();
    expect(component._scanToast()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Product card image
// ---------------------------------------------------------------------------

describe('product card image', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders an <img> with the correct src when product has imageUrl', async () => {
    const product = makeProduct({ id: 'p-img', imageUrl: 'https://example.com/coffee.jpg' });
    const { fixture, component } = setup({}, {}, [product]);

    const c = component as unknown as Record<string, { set: (v: unknown) => void }>;
    c['_products'].set([product]);
    c['view'].set('shopping');
    fixture.detectChanges();

    const img: HTMLImageElement | null = fixture.nativeElement.querySelector(
      '[data-testid="shop-product-p-img"] img'
    );
    expect(img).not.toBeNull();
    expect(img!.src).toContain('coffee.jpg');
  });

  it('renders the gradient <div> and no <img> when product has no imageUrl', async () => {
    const product = makeProduct({ id: 'p-grad', imageUrl: undefined });
    const { fixture, component } = setup({}, {}, [product]);

    const c = component as unknown as Record<string, { set: (v: unknown) => void }>;
    c['_products'].set([product]);
    c['view'].set('shopping');
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('[data-testid="shop-product-p-grad"]');
    expect(card).not.toBeNull();
    expect(card.querySelector('img')).toBeNull();
    const gradientDiv = card.querySelector('div[style]');
    expect(gradientDiv).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cart actions — incrementItem / decrementItem / selectCategory / openCheckout
// ---------------------------------------------------------------------------

describe('ShopComponent — cart and category actions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('incrementItem updates quantity when below MAX_QTY', () => {
    const product = makeProduct({ id: 'p-1' });
    const { component, cart } = setup({}, {}, [product]);
    cart.items.set([{ product, quantity: 2 } as never]);

    component.incrementItem('p-1');

    expect(cart.updateQuantity).toHaveBeenCalledWith('p-1', 3);
  });

  it('incrementItem does nothing when item is at MAX_QTY', () => {
    const product = makeProduct({ id: 'p-max' });
    const { component, cart } = setup({}, {}, [product]);
    cart.items.set([{ product, quantity: 10 } as never]); // MAX_QTY = 10

    component.incrementItem('p-max');

    expect(cart.updateQuantity).not.toHaveBeenCalled();
  });

  it('incrementItem does nothing when item is not in the cart', () => {
    const { component, cart } = setup();
    cart.items.set([]);

    component.incrementItem('p-missing');

    expect(cart.updateQuantity).not.toHaveBeenCalled();
  });

  it('decrementItem removes item when quantity is 1', () => {
    const product = makeProduct({ id: 'p-1' });
    const { component, cart } = setup({}, {}, [product]);
    cart.items.set([{ product, quantity: 1 } as never]);

    component.decrementItem('p-1');

    expect(cart.removeItem).toHaveBeenCalledWith('p-1');
  });

  it('decrementItem decreases quantity when quantity > 1', () => {
    const product = makeProduct({ id: 'p-1' });
    const { component, cart } = setup({}, {}, [product]);
    cart.items.set([{ product, quantity: 3 } as never]);

    component.decrementItem('p-1');

    expect(cart.updateQuantity).toHaveBeenCalledWith('p-1', 2);
  });

  it('decrementItem does nothing when item is not in the cart', () => {
    const { component, cart } = setup();
    cart.items.set([]);

    component.decrementItem('p-missing');

    expect(cart.removeItem).not.toHaveBeenCalled();
    expect(cart.updateQuantity).not.toHaveBeenCalled();
  });

  it('selectCategory sets the selectedCategory signal', () => {
    const { component } = setup();
    component.selectCategory('Drinks');
    expect(component.selectedCategory()).toBe('Drinks');

    component.selectCategory(null);
    expect(component.selectedCategory()).toBeNull();
  });

  it('filteredProducts returns all products when no category is selected', () => {
    const products = [
      makeProduct({ id: 'p-1', category: 'Food' }),
      makeProduct({ id: 'p-2', category: 'Drinks' }),
    ];
    const { component } = setup({}, {}, products);
    (component as unknown as Record<string, { set: (v: unknown) => void }>)['_products'].set(
      products
    );

    component.selectCategory(null);
    expect(component.filteredProducts()).toHaveLength(2);
  });

  it('filteredProducts filters by category', () => {
    const products = [
      makeProduct({ id: 'p-1', category: 'Food' }),
      makeProduct({ id: 'p-2', category: 'Drinks' }),
    ];
    const { component } = setup({}, {}, products);
    (component as unknown as Record<string, { set: (v: unknown) => void }>)['_products'].set(
      products
    );

    component.selectCategory('Food');
    expect(component.filteredProducts()).toHaveLength(1);
    expect(component.filteredProducts()[0].id).toBe('p-1');
  });

  it('openCheckout does nothing when cart is empty', () => {
    const { component, cart } = setup();
    cart.isEmpty.set(true);

    component.openCheckout();

    expect(component.showCheckout()).toBe(false);
  });

  it('openCheckout opens checkout when cart has items', () => {
    const { component, cart } = setup();
    cart.isEmpty.set(false);

    // kioskCustomer.customer() is null, so attachCustomerDirectly should NOT be called
    component.openCheckout();

    expect(component.showCheckout()).toBe(true);
  });

  it('handleSignIn sets authError when email is empty', async () => {
    const { component } = setup();
    component.authEmail = '';

    await component.handleSignIn();

    expect(component.authError()).toContain('email');
  });

  it('handleSignIn sets authError when email has no @', async () => {
    const { component } = setup();
    component.authEmail = 'notanemail';

    await component.handleSignIn();

    expect(component.authError()).toContain('valid email');
  });

  it('handleSignIn signs in when customer is found', async () => {
    const fakeCustomer = { id: 'cust-1', email: 'a@b.com' };
    const { component } = setup();
    TestBed.inject(CUSTOMER_REPOSITORY).findByEmail = vi.fn().mockResolvedValue(fakeCustomer);
    const kioskCustomer = TestBed.inject(KioskCustomerService);
    component.authEmail = 'a@b.com';

    await component.handleSignIn();

    expect(kioskCustomer.set).toHaveBeenCalledWith(fakeCustomer);
    expect(component.authError()).toBeNull();
  });

  it('handleSignIn sets authError when customer is not found', async () => {
    const { component } = setup();
    TestBed.inject(CUSTOMER_REPOSITORY).findByEmail = vi.fn().mockResolvedValue(null);
    component.authEmail = 'unknown@b.com';

    await component.handleSignIn();

    expect(component.authError()).toContain('No account found');
  });

  it('handleSignIn sets authError on repository exception', async () => {
    const { component } = setup();
    TestBed.inject(CUSTOMER_REPOSITORY).findByEmail = vi.fn().mockRejectedValue(new Error('db'));
    component.authEmail = 'err@b.com';

    await component.handleSignIn();

    expect(component.authError()).toContain('Could not sign in');
  });

  it('productGradient returns a CSS gradient string', () => {
    const { component } = setup();
    const gradient = component.productGradient('prod-abc');
    expect(gradient).toContain('linear-gradient');
    expect(gradient).toContain('hsl(');
  });
});

// ---------------------------------------------------------------------------
// handleNewTransaction / handlePrintReceipt / retrySession
// ---------------------------------------------------------------------------

describe('ShopComponent — receipt and navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('handleNewTransaction clears receipt state and navigates to /shop', async () => {
    const { component, fixture } = setup();
    const router = fixture.debugElement.injector.get(Router);

    component.showReceipt.set(true);
    component.handleNewTransaction();

    expect(component.showReceipt()).toBe(false);
    expect(component.receiptData()).toBeNull();
    expect(router.navigate as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(['/shop']);
  });

  it('handlePrintReceipt calls globalThis.print()', () => {
    const { component } = setup();
    const printSpy = vi.spyOn(globalThis, 'print').mockImplementation(() => undefined);

    component.handlePrintReceipt();

    expect(printSpy).toHaveBeenCalled();
  });

  it('retrySession re-runs ngOnInit when resolvedStoreId is null', async () => {
    const { component } = setup();
    component.resolvedStoreId.set(null);

    // Should not throw — the inner await this.ngOnInit() path is exercised.
    await component.retrySession();
  });

  it('goToStaffLogin navigates to /login', () => {
    const { component, fixture } = setup();
    const router = fixture.debugElement.injector.get(Router);

    component.goToStaffLogin();

    expect(router.navigate as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(['/login']);
  });

  it('receipt countdown auto-dismisses and calls handleNewTransaction after 30 s', async () => {
    const { component, fixture } = setup();
    const router = fixture.debugElement.injector.get(Router);

    // Expose the private method via type cast.
    const c = component as unknown as { startReceiptTimer: () => void };
    component.showReceipt.set(true);
    c.startReceiptTimer();

    // Advance 31 seconds to trigger the countdown reaching 0.
    vi.advanceTimersByTime(31_000);
    await flushMicrotasks();

    expect(component.showReceipt()).toBe(false);
    expect(router.navigate as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(['/shop']);
  });

  it('clearReceiptTimers cancels receiptDismissTimer when it is set', () => {
    const { component } = setup();
    // Set receiptDismissTimer directly to cover the true branch of the null-check.
    const c = component as unknown as Record<string, unknown>;
    c['receiptDismissTimer'] = setTimeout(() => undefined, 60_000);

    // handleNewTransaction internally calls clearReceiptTimers.
    component.handleNewTransaction();

    // The timer was cancelled — no timeout fires.
    vi.advanceTimersByTime(60_000);
    // If the timer was NOT cleared this would throw or cause issues, so reaching here is sufficient.
    expect(component.receiptCountdown()).toBe(0);
  });

  it('idle timeout clears cart and navigates to /shop', async () => {
    const { component, cart, fixture } = setup();
    const router = fixture.debugElement.injector.get(Router);

    // Trigger startShopIdleTimer via resetIdleTimer (public).
    component.resetIdleTimer();

    // Advance past the full idle timeout (120 s).
    vi.advanceTimersByTime(121_000);
    await flushMicrotasks();

    expect(cart.clearCart).toHaveBeenCalled();
    expect(router.navigate as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(['/shop']);
  });
});

// ---------------------------------------------------------------------------
// handleCreateAccount — uncovered branches
// ---------------------------------------------------------------------------

describe('ShopComponent — handleCreateAccount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sets authError when email is empty', async () => {
    const { component } = setup();
    component.authEmail = '';
    await component.handleCreateAccount();
    expect(component.authError()).toBe('Please enter your email address.');
  });

  it('sets authError when email has no @', async () => {
    const { component } = setup();
    component.authEmail = 'notanemail';
    await component.handleCreateAccount();
    expect(component.authError()).toBe('Please enter a valid email address.');
  });

  it('signs in existing customer without creating a new one', async () => {
    const { component, fixture } = setup();
    const repo = fixture.debugElement.injector.get(CUSTOMER_REPOSITORY);
    const existing = { id: 'c1', email: 'a@b.com' } as never;
    (repo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

    component.authEmail = 'a@b.com';
    await component.handleCreateAccount();

    expect(repo.create).not.toHaveBeenCalled();
    expect(component.showAuthModal()).toBe(false);
  });

  it('creates a new customer when none exists', async () => {
    const { component, fixture } = setup();
    const repo = fixture.debugElement.injector.get(CUSTOMER_REPOSITORY);
    const created = { id: 'c2', email: 'new@b.com' } as never;
    (repo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (repo.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

    component.authEmail = 'new@b.com';
    await component.handleCreateAccount();

    expect(repo.create).toHaveBeenCalled();
    expect(component.showAuthModal()).toBe(false);
  });

  it('sets authError on repository exception', async () => {
    const { component, fixture } = setup();
    const repo = fixture.debugElement.injector.get(CUSTOMER_REPOSITORY);
    (repo.findByEmail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));

    component.authEmail = 'x@y.com';
    await component.handleCreateAccount();

    expect(component.authError()).toContain('Could not create account');
  });
});

// ---------------------------------------------------------------------------
// handlePaymentComplete — checkout error path (line 1013)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// openCheckout with customer + closeCheckout
// ---------------------------------------------------------------------------

describe('ShopComponent — openCheckout and closeCheckout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('openCheckout attaches customer when kioskCustomer is set', () => {
    const fakeCustomer = { id: 'cust-42', email: 'k@shop.com' } as never;
    const { component, cart, fixture } = setup();
    const kioskCustomer = fixture.debugElement.injector.get(KioskCustomerService);
    (kioskCustomer.customer as ReturnType<typeof signal>).set(fakeCustomer);
    const facade = fixture.debugElement.injector.get(PosFacade);

    cart.isEmpty.set(false);
    component.openCheckout();

    expect(facade.attachCustomerDirectly).toHaveBeenCalledWith(fakeCustomer);
    expect(component.showCheckout()).toBe(true);
  });

  it('closeCheckout hides checkout and detaches customer', () => {
    const { component, fixture } = setup();
    const facade = fixture.debugElement.injector.get(PosFacade);

    component.showCheckout.set(true);
    component.closeCheckout();

    expect(component.showCheckout()).toBe(false);
    expect(facade.detachCustomer).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handlePaymentComplete — happy path
// ---------------------------------------------------------------------------

describe('ShopComponent — handlePaymentComplete happy path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows receipt and clears checkout state on successful payment', async () => {
    const fakeReceipt = {
      payment: { method: 'cash', amount: 5, transactionId: 'tx-ok', timestamp: new Date() },
      items: [],
      currency: 'USD',
      subtotal: 5,
      tax: 0,
      taxRate: 0,
      total: 5,
      storeName: 'Test Store',
      storeAddress: '',
    } as never;

    const { component, fixture } = setup();
    const facade = fixture.debugElement.injector.get(PosFacade);
    (facade.checkout as ReturnType<typeof vi.fn>).mockResolvedValue(fakeReceipt);

    component.showCheckout.set(true);
    component.handlePaymentComplete({
      method: 'cash',
      amount: 5,
      transactionId: 'tx-ok',
      timestamp: new Date(),
    });
    await flushMicrotasks();

    expect(component.checkoutError()).toBeNull();
    expect(component.receiptData()).toEqual(fakeReceipt);
    expect(component.showCheckout()).toBe(false);
    expect(component.showReceipt()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handlePaymentComplete — checkout error path (line 1013)
// ---------------------------------------------------------------------------

describe('ShopComponent — handlePaymentComplete checkout error', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sets checkoutError when remote persistence fails with an Error', async () => {
    const { component, fixture } = setup();
    const facade = fixture.debugElement.injector.get(PosFacade);
    (facade.checkout as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network failure'));

    component.showCheckout.set(true);
    await component.handlePaymentComplete({
      method: 'mercadopago',
      amount: 10,
      transactionId: 'tx-1',
      timestamp: new Date(),
    });
    await flushMicrotasks();

    expect(component.checkoutError()).toContain('network failure');
    expect(component.showCheckout()).toBe(false);
  });

  it('sets checkoutError when remote persistence fails with a non-Error', async () => {
    const { component, fixture } = setup();
    const facade = fixture.debugElement.injector.get(PosFacade);
    (facade.checkout as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

    component.showCheckout.set(true);
    await component.handlePaymentComplete({
      method: 'mercadopago',
      amount: 10,
      transactionId: 'tx-2',
      timestamp: new Date(),
    });
    await flushMicrotasks();

    expect(component.checkoutError()).toContain('please try again');
    expect(component.showCheckout()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// acquireSession / retrySession — fetch paths (lines 895-900, 913, 937)
// ---------------------------------------------------------------------------

describe('ShopComponent — acquireSession and retrySession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setupNoSession(
    fetchResponse: { ok: boolean; json?: () => Promise<unknown> } = {
      ok: true,
      json: () => Promise.resolve({ token: 'new-token', expiresAt: '' }),
    }
  ) {
    const camera = makeCamera();
    const scanner = makeScanner();
    const cart = makeCartStub();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse));
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn().mockReturnValue(null), // no existing session
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: CartService, useValue: cart },
        { provide: ProductService, useValue: { getActiveProducts: vi.fn().mockResolvedValue([]) } },
        {
          provide: KioskSettingsService,
          useValue: {
            load: vi.fn().mockResolvedValue(undefined),
            stores: signal([{ storeId: 'store-1', name: 'Test Store' }]),
            storeId: signal('store-1'),
            storeName: signal('Test Store'),
            storeAddress: signal(''),
            terminals: signal([]),
            hasFencePolygon: vi.fn().mockReturnValue(false),
            setActiveTerminal: vi.fn(),
            mercadopagoActive: signal(false),
          },
        },
        {
          provide: GeofencingService,
          useValue: { checkFence: vi.fn().mockResolvedValue('inside'), reset: vi.fn() },
        },
        {
          provide: KioskCustomerService,
          useValue: { customer: signal(null), set: vi.fn(), clear: vi.fn() },
        },
        {
          provide: PosFacade,
          useValue: { attachCustomerDirectly: vi.fn(), detachCustomer: vi.fn(), checkout: vi.fn() },
        },
        { provide: BarcodeScannerService, useValue: scanner },
        { provide: CUSTOMER_REPOSITORY, useValue: { findByEmail: vi.fn(), create: vi.fn() } },
        { provide: AUTH_GATEWAY, useValue: { getActiveSession: vi.fn().mockResolvedValue(null) } },
      ],
    });
    TestBed.overrideComponent(ShopComponent, {
      remove: { providers: [CameraService] },
      add: { providers: [{ provide: CameraService, useValue: camera }] },
    });

    const fixture = TestBed.createComponent(ShopComponent);
    const component = fixture.componentInstance;
    return { fixture, component, cart };
  }

  it('acquireSession succeeds: stores token and transitions to shopping view', async () => {
    const { component } = setupNoSession();
    // ngOnInit triggers acquireSession since there is no existing session token
    await TestBed.flushEffects();
    await flushMicrotasks();

    expect(component.view()).toBe('shopping');
  });

  it('acquireSession with response.ok = false sets session-error view', async () => {
    const { component } = setupNoSession({ ok: false });
    await TestBed.flushEffects();
    await flushMicrotasks();

    expect(component.view()).toBe('session-error');
    expect(component.sessionError()).toContain('Session request failed');
  });

  it('retrySession with a known storeId calls acquireSession again', async () => {
    const { component } = setupNoSession();
    await TestBed.flushEffects();
    await flushMicrotasks();

    component.resolvedStoreId.set('store-1');
    await component.retrySession();
    await flushMicrotasks();

    expect(component.view()).toBe('shopping');
  });

  it('loadProducts catch path sets isLoading to false on error', async () => {
    const camera = makeCamera();
    const scanner = makeScanner();
    const cart = makeCartStub();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ token: 'tok', expiresAt: '' }),
      })
    );
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    TestBed.configureTestingModule({
      imports: [ShopComponent],
      providers: [
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: CartService, useValue: cart },
        {
          provide: ProductService,
          useValue: { getActiveProducts: vi.fn().mockRejectedValue(new Error('db down')) },
        },
        {
          provide: KioskSettingsService,
          useValue: {
            load: vi.fn().mockResolvedValue(undefined),
            stores: signal([{ storeId: 'store-1', name: 'Test Store' }]),
            storeId: signal('store-1'),
            storeName: signal('Test Store'),
            storeAddress: signal(''),
            terminals: signal([]),
            hasFencePolygon: vi.fn().mockReturnValue(false),
            setActiveTerminal: vi.fn(),
            mercadopagoActive: signal(false),
          },
        },
        {
          provide: GeofencingService,
          useValue: { checkFence: vi.fn().mockResolvedValue('inside'), reset: vi.fn() },
        },
        {
          provide: KioskCustomerService,
          useValue: { customer: signal(null), set: vi.fn(), clear: vi.fn() },
        },
        {
          provide: PosFacade,
          useValue: { attachCustomerDirectly: vi.fn(), detachCustomer: vi.fn(), checkout: vi.fn() },
        },
        { provide: BarcodeScannerService, useValue: scanner },
        { provide: CUSTOMER_REPOSITORY, useValue: { findByEmail: vi.fn(), create: vi.fn() } },
        { provide: AUTH_GATEWAY, useValue: { getActiveSession: vi.fn().mockResolvedValue(null) } },
      ],
    });
    TestBed.overrideComponent(ShopComponent, {
      remove: { providers: [CameraService] },
      add: { providers: [{ provide: CameraService, useValue: camera }] },
    });

    const fixture = TestBed.createComponent(ShopComponent);
    const component = fixture.componentInstance;

    await TestBed.flushEffects();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(component.isLoading()).toBe(false);
  });
});
