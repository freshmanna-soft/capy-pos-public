import {
  ApplicationRef,
  ComponentRef,
  EnvironmentInjector,
  createComponent,
  createEnvironmentInjector,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, type Route } from '@angular/router';
import { PosFacade } from '@core/application/facades/pos.facade';
import { CartService } from '@core/application/services/cart.service';
import { ProductService } from '@core/application/services/product.service';
import { AuditLogService } from '@core/infrastructure/audit/audit-log.service';
import { CustomerService } from '@core/application/services/customer.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import { AdjustStockOnSaleUseCase } from '@core/application/use-cases/adjust-stock-on-sale.use-case';
import { AwardLoyaltyPointsUseCase } from '@core/application/use-cases/award-loyalty-points.use-case';
import { GenerateReceiptUseCase } from '@core/application/use-cases/generate-receipt.use-case';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { Product } from '@core/domain/entities/product.entity';
import { routes } from '../../app.routes';
import { SelfCheckoutComponent } from './self-checkout.component';

/**
 * The customer basket belongs to the `/self-checkout` route injector.
 *
 * The root cart is the staff till. A second cart and facade on the componentless
 * parent isolate customer scans while allowing every child route to inherit the
 * same sale in progress. Destroying a lane component during a side trip must not
 * destroy that basket; destroying the parent route must.
 */
describe('self-checkout cart boundary', () => {
  /** `036000291452` — a real UPC-A, check digit and all. */
  const UPCA = '036000291452';

  function product(id: string, name: string, barcode: string): Product {
    return new Product(id, name, 2.5, `SKU-${id}`, 'drinks', 10, undefined, undefined, barcode);
  }

  const CASHIER_ITEM = product('till-1', 'Sencha Tin', '5901234123457');
  const LANE_ITEM = product('lane-1', 'Yuzu Soda', UPCA);
  const selfCheckout = routes.find((route) => route.path === 'self-checkout') as Route;

  let appRoot: EnvironmentInjector;
  let routeInjector: EnvironmentInjector;
  let rootCart: CartService;
  let laneRef: ComponentRef<SelfCheckoutComponent> | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ProductService,
          useValue: { getActiveProducts: () => Promise.resolve([LANE_ITEM]) },
        },
        { provide: EventBusService, useValue: { publish: vi.fn() } },
        { provide: GenerateReceiptUseCase, useValue: {} },
        { provide: AdjustStockOnSaleUseCase, useValue: {} },
        { provide: DexieDatabase, useValue: {} },
        { provide: AuditLogService, useValue: { log: vi.fn() } },
        { provide: TelemetryService, useValue: {} },
        { provide: CustomerService, useValue: {} },
        { provide: AwardLoyaltyPointsUseCase, useValue: {} },
        {
          provide: BarcodeScannerService,
          useValue: {
            prepare: vi.fn().mockResolvedValue(false),
            detect: vi.fn().mockResolvedValue(null),
            supported: vi.fn().mockReturnValue(false),
          },
        },
        {
          provide: CameraService,
          useValue: {
            start: vi.fn().mockResolvedValue(false),
            stop: vi.fn(),
            attach: vi.fn(),
            detectionSource: vi.fn().mockReturnValue(null),
          },
        },
      ],
    });

    appRoot = TestBed.inject(EnvironmentInjector);
    routeInjector = createEnvironmentInjector(selfCheckout.providers ?? [], appRoot);
    rootCart = TestBed.inject(CartService);
    rootCart.addProduct(CASHIER_ITEM);
    laneRef = null;
  });

  afterEach(() => {
    laneRef?.destroy();
    routeInjector.destroy();
  });

  async function openLane(): Promise<ComponentRef<SelfCheckoutComponent>> {
    const host = document.createElement('div');
    laneRef = createComponent(SelfCheckoutComponent, {
      hostElement: host,
      environmentInjector: routeInjector,
    });
    TestBed.inject(ApplicationRef).attachView(laneRef.hostView);
    laneRef.changeDetectorRef.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    laneRef.changeDetectorRef.detectChanges();
    return laneRef;
  }

  function childInjector(path: string): EnvironmentInjector {
    const child = selfCheckout.children?.find((route) => route.path === path);
    return createEnvironmentInjector(child?.providers ?? [], routeInjector);
  }

  it('shows the customer an empty basket even when the till has a sale in progress', async () => {
    const ref = await openLane();

    expect(rootCart.items().length).toBe(1);
    expect(
      ref.location.nativeElement.querySelector('[data-testid="self-checkout-cart-empty"]')
    ).not.toBeNull();
    expect(ref.location.nativeElement.textContent).not.toContain('Sencha Tin');
  });

  it("rings the customer's item into the route cart and leaves the till untouched", () => {
    const routeCart = routeInjector.get(CartService);
    const routeFacade = routeInjector.get(PosFacade);

    expect(routeFacade.addToCart(LANE_ITEM)).toBe(true);

    expect(routeCart).not.toBe(rootCart);
    expect(routeCart.items().map((item) => item.product.id)).toEqual(['lane-1']);
    expect(rootCart.items().map((item) => item.product.id)).toEqual(['till-1']);
  });

  it.each(['sign-up', 'sign-in', 'check-email', 'pay'])(
    'preserves the basket across a lane → %s → lane side trip',
    async (path) => {
      const routeCart = routeInjector.get(CartService);
      routeInjector.get(PosFacade).addToCart(LANE_ITEM);
      const firstLane = await openLane();
      firstLane.destroy();
      laneRef = null;

      const sideRoute = childInjector(path);
      try {
        expect(sideRoute.get(CartService)).toBe(routeCart);
        expect(sideRoute.get(PosFacade)).toBe(routeInjector.get(PosFacade));
      } finally {
        sideRoute.destroy();
      }

      const reopenedLane = await openLane();
      expect(routeCart.items().map((item) => item.product.id)).toEqual(['lane-1']);
      expect(reopenedLane.location.nativeElement.textContent).toContain('Yuzu Soda');
      expect(rootCart.items().map((item) => item.product.id)).toEqual(['till-1']);
    }
  );
});
