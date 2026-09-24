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
