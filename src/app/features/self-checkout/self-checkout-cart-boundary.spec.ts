import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
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
import { SelfCheckoutComponent } from './self-checkout.component';

/**
 * The lane's cart must not be the till's cart.
 *
 * `/self-checkout` is an unguarded route on the same terminal `/pos` runs on, and
 * `CartService` is `providedIn: 'root'`. Left shared, the bleed runs both ways and
 * both ways are real damage: a cashier's in-progress basket renders as the
 * customer's items and totals, and a customer who walks away leaves their scans in
 * the cashier's next sale. `SelfCheckoutComponent` provides `CartService` **and**
 * `PosFacade` to draw the boundary.
 *
 * `PosFacade` is the half that is easy to get wrong and impossible to see: it is a
 * root singleton, so if it is dropped from that providers array the panel still
 * compiles, still adds to a cart, and still passes every other spec in this folder —
 * while writing straight into the till's basket again. So this spec builds the
 * **real** facade (its sale-graph collaborators stubbed, the carts real) and asserts
 * on where the items actually land.
 */
describe('self-checkout cart boundary', () => {
  /** `036000291452` — a real UPC-A, check digit and all. */
  const UPCA = '036000291452';

  function product(id: string, name: string, barcode: string): Product {
    return new Product(id, name, 2.5, `SKU-${id}`, 'drinks', 10, undefined, undefined, barcode);
  }

  /** The cashier's sale in progress, sitting in the root cart. */
  const CASHIER_ITEM = product('till-1', 'Sencha Tin', '5901234123457');
  /** What the customer scans in the lane. */
  const LANE_ITEM = product('lane-1', 'Yuzu Soda', UPCA);

  let rootCart: CartService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ProductService,
          useValue: { getActiveProducts: () => Promise.resolve([LANE_ITEM]) },
        },
        // Everything `PosFacade` injects apart from the cart. Stubbed because the
        // sale graph is irrelevant here — the cart wiring is the whole subject — but
        // present because the real facade's field initializers ask for all of them.
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

    // The till's basket, mid-sale, before anyone opens the lane.
    rootCart = TestBed.inject(CartService);
    rootCart.addProduct(CASHIER_ITEM);
  });

  async function openLane() {
    const fixture = TestBed.createComponent(SelfCheckoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function scan(fixture: Awaited<ReturnType<typeof openLane>>, code: string) {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      '[data-testid="self-checkout-code-input"]'
    );
    input.value = code;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="self-checkout-add"]').click();
    fixture.detectChanges();
  }

  it('shows the customer an empty basket even when the till has a sale in progress', async () => {
    const fixture = await openLane();

    expect(rootCart.items().length).toBe(1);
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-cart-empty"]')
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Sencha Tin');
  });

  it("rings the customer's scan into the lane cart and leaves the till's untouched", async () => {
    const fixture = await openLane();

    scan(fixture, UPCA);

    const laneCart = fixture.debugElement.injector.get(CartService);
    expect(laneCart).not.toBe(rootCart);
    expect(laneCart.items().map((item) => item.product.id)).toEqual(['lane-1']);
    // The one that matters: "Back to till" must not hand the cashier the
    // customer's soda.
    expect(rootCart.items().map((item) => item.product.id)).toEqual(['till-1']);
  });
});
