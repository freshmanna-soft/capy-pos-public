import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { PosFacade } from './pos.facade';
import { CartService } from '@core/application/services/cart.service';
import { GenerateReceiptUseCase } from '@core/application/use-cases/generate-receipt.use-case';
import { AdjustStockOnSaleUseCase } from '@core/application/use-cases/adjust-stock-on-sale.use-case';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { EventType } from '@core/infrastructure/messaging/event-bus.events';
import { AuditLogService } from '@core/infrastructure/audit/audit-log.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import { CustomerService } from '@core/application/services/customer.service';
import { AwardLoyaltyPointsUseCase } from '@core/application/use-cases/award-loyalty-points.use-case';
import { Product } from '@core/domain/entities/product.entity';
import { Customer, CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';

describe('PosFacade', () => {
  let facade: PosFacade;
  let mockCartService: {
    items: WritableSignal<unknown[]>;
    revision: WritableSignal<number>;
    totalItems: WritableSignal<number>;
    subtotal: WritableSignal<number>;
    tax: WritableSignal<number>;
    total: WritableSignal<number>;
    isEmpty: WritableSignal<boolean>;
    addProduct: ReturnType<typeof vi.fn>;
    increaseQuantity: ReturnType<typeof vi.fn>;
    decreaseQuantity: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
    clearCart: ReturnType<typeof vi.fn>;
    getQuantity: ReturnType<typeof vi.fn>;
    hasProduct: ReturnType<typeof vi.fn>;
  };
  let mockGenerateReceipt: {
    execute: ReturnType<typeof vi.fn>;
    fromSnapshot: ReturnType<typeof vi.fn>;
  };
  let mockAdjustStock: { execute: ReturnType<typeof vi.fn> };
  let mockDb: { initializeWithSeedData: ReturnType<typeof vi.fn> };
  let mockEventBus: { publish: ReturnType<typeof vi.fn> };
  let mockCustomers: { getCustomerByLoyaltyCode: ReturnType<typeof vi.fn> };
  let mockAwardLoyalty: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockCartService = {
      items: signal([]),
      revision: signal(0),
      totalItems: signal(0),
      subtotal: signal(0),
      tax: signal(0),
      total: signal(0),
      isEmpty: signal(true),
      addProduct: vi.fn(),
      increaseQuantity: vi.fn(),
      decreaseQuantity: vi.fn(),
      removeItem: vi.fn(),
      clearCart: vi.fn(),
      getQuantity: vi.fn().mockReturnValue(0),
      hasProduct: vi.fn().mockReturnValue(false),
    };

    mockGenerateReceipt = {
      execute: vi.fn().mockReturnValue({ items: [], total: 0 }),
      fromSnapshot: vi.fn(),
    };

    mockAdjustStock = {
      execute: vi
        .fn()
        .mockResolvedValue({ success: true, adjustedProducts: [], failedAdjustments: [] }),
    };

    mockDb = {
      initializeWithSeedData: vi.fn().mockResolvedValue(undefined),
    };

    mockEventBus = { publish: vi.fn() };

    mockCustomers = { getCustomerByLoyaltyCode: vi.fn().mockResolvedValue(null) };
    mockAwardLoyalty = {
      execute: vi.fn().mockResolvedValue({
        awarded: true,
        points: 100,
        balance: 100,
        previousTier: CustomerTier.BRONZE,
        tier: CustomerTier.BRONZE,
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        PosFacade,
        { provide: CartService, useValue: mockCartService },
        { provide: GenerateReceiptUseCase, useValue: mockGenerateReceipt },
        { provide: AdjustStockOnSaleUseCase, useValue: mockAdjustStock },
        { provide: DexieDatabase, useValue: mockDb },
        { provide: CustomerService, useValue: mockCustomers },
        { provide: AwardLoyaltyPointsUseCase, useValue: mockAwardLoyalty },
        { provide: EventBusService, useValue: mockEventBus },
      ],
    });

    facade = TestBed.inject(PosFacade);
  });

  describe('creation', () => {
    it('should be created', () => {
      expect(facade).toBeTruthy();
    });
  });

  describe('cart state delegation', () => {
    it('should expose cart items from CartService', () => {
      expect(facade.cartItems()).toEqual([]);
    });

    it('should expose totalItems from CartService', () => {
      expect(facade.totalItems()).toBe(0);
    });

    it('should expose subtotal from CartService', () => {
      expect(facade.subtotal()).toBe(0);
    });

    it('should expose tax from CartService', () => {
      expect(facade.tax()).toBe(0);
    });

    it('should expose total from CartService', () => {
      expect(facade.total()).toBe(0);
    });

    it('should expose isEmpty from CartService', () => {
      expect(facade.isCartEmpty()).toBe(true);
    });
  });

  describe('cart operations', () => {
    const mockProduct = {
      id: 'prod-1',
      name: 'Test Product',
      stock: 10,
      isOutOfStock: () => false,
    } as unknown as Product;

    it('should delegate addToCart to CartService', () => {
      facade.addToCart(mockProduct);
      expect(mockCartService.addProduct).toHaveBeenCalledWith(mockProduct);
    });

    it('should reject out-of-stock products', () => {
      const outOfStockProduct = {
        ...mockProduct,
        stock: 0,
        isOutOfStock: () => true,
      } as unknown as Product;

      const result = facade.addToCart(outOfStockProduct);
      expect(result).toBe(false);
      expect(mockCartService.addProduct).not.toHaveBeenCalled();
    });

    it('should reject products exceeding available stock', () => {
      mockCartService.getQuantity.mockReturnValue(10);
      const result = facade.addToCart(mockProduct);
      expect(result).toBe(false);
      expect(mockCartService.addProduct).not.toHaveBeenCalled();
    });

    it('should delegate increaseQuantity to CartService', () => {
      facade.increaseQuantity('prod-1');
      expect(mockCartService.increaseQuantity).toHaveBeenCalledWith('prod-1');
    });

    it('should delegate decreaseQuantity to CartService', () => {
      facade.decreaseQuantity('prod-1');
      expect(mockCartService.decreaseQuantity).toHaveBeenCalledWith('prod-1');
    });

    it('should delegate removeFromCart to CartService', () => {
      facade.removeFromCart('prod-1');
      expect(mockCartService.removeItem).toHaveBeenCalledWith('prod-1');
    });

    it('should delegate clearCart to CartService', () => {
      facade.clearCart();
      expect(mockCartService.clearCart).toHaveBeenCalled();
    });

    it('should delegate getQuantity to CartService', () => {
      mockCartService.getQuantity.mockReturnValue(3);
      expect(facade.getQuantity('prod-1')).toBe(3);
    });
  });

  describe('event bus publishing', () => {
    const mockProduct = {
      id: 'prod-1',
      name: 'Test Product',
      price: 4.5,
      stock: 10,
      isOutOfStock: () => false,
    } as unknown as Product;

    it('publishes cart.item.added on a successful add', () => {
      facade.addToCart(mockProduct);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EventType.CART_ITEM_ADDED,
          source: 'PosFacade',
          priority: 'normal',
          payload: expect.objectContaining({ productId: 'prod-1' }),
        })
      );
    });

    it('does NOT publish when an add is rejected', () => {
      mockCartService.getQuantity.mockReturnValue(10);
      facade.addToCart(mockProduct);
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });

    it('publishes cart.item.removed on remove', () => {
      facade.removeFromCart('prod-1');
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: EventType.CART_ITEM_REMOVED, source: 'PosFacade' })
      );
    });

    it('publishes transaction.completed (high) on checkout', async () => {
      await facade.checkout({ method: 'cash', amount: 100 } as never);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EventType.TRANSACTION_COMPLETED,
          priority: 'high',
          payload: expect.objectContaining({ amount: 100, method: 'cash' }),
        })
      );
    });
  });

  describe('checkout operations', () => {
    it('should generate receipt and adjust stock on checkout', async () => {
      const mockItems = [{ product: { id: 'p1' }, quantity: 2 }];
      mockCartService.items = signal(mockItems as unknown[]);

      // Re-create facade with updated cart items
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          PosFacade,
          { provide: CartService, useValue: { ...mockCartService, items: signal(mockItems) } },
          { provide: GenerateReceiptUseCase, useValue: mockGenerateReceipt },
          { provide: AdjustStockOnSaleUseCase, useValue: mockAdjustStock },
          { provide: DexieDatabase, useValue: mockDb },
          { provide: CustomerService, useValue: mockCustomers },
          { provide: AwardLoyaltyPointsUseCase, useValue: mockAwardLoyalty },
          { provide: EventBusService, useValue: mockEventBus },
        ],
      });
      facade = TestBed.inject(PosFacade);

      const paymentResult = { method: 'cash', amount: 100 };
      const receipt = await facade.checkout(paymentResult as never);

      expect(mockGenerateReceipt.execute).toHaveBeenCalledWith(paymentResult);
      expect(mockAdjustStock.execute).toHaveBeenCalled();
      expect(receipt).toEqual({ items: [], total: 0 });
    });

    it('should clear cart after successful checkout', async () => {
      const paymentResult = { method: 'cash', amount: 50 };
      await facade.checkout(paymentResult as never);
      expect(mockCartService.clearCart).toHaveBeenCalled();
    });

    it('should still complete checkout even if stock adjustment fails', async () => {
      mockAdjustStock.execute.mockResolvedValue({
        success: false,
        adjustedProducts: [],
        failedAdjustments: [{ productId: 'p1', reason: 'not found' }],
      });

      const paymentResult = { method: 'card', amount: 75 };
      const receipt = await facade.checkout(paymentResult as never);

      expect(receipt).toBeTruthy();
      expect(mockCartService.clearCart).toHaveBeenCalled();
    });
  });

  describe('checkout observability (#92)', () => {
    function setup(overrides: { auditReject?: boolean; telemetryThrow?: boolean } = {}) {
      const mockAudit = {
        log: vi
          .fn()
          .mockReturnValue(
            overrides.auditReject ? Promise.reject(new Error('db down')) : Promise.resolve()
          ),
      };
      const mockTelemetry = {
        recordCounter: vi.fn(() => {
          if (overrides.telemetryThrow) throw new Error('telemetry down');
        }),
        recordGauge: vi.fn(),
      };
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          PosFacade,
          {
            provide: CartService,
            useValue: {
              ...mockCartService,
              items: signal([{ product: { id: 'p1' }, quantity: 1 }]),
            },
          },
          { provide: GenerateReceiptUseCase, useValue: mockGenerateReceipt },
          { provide: AdjustStockOnSaleUseCase, useValue: mockAdjustStock },
          { provide: DexieDatabase, useValue: mockDb },
          { provide: CustomerService, useValue: mockCustomers },
          { provide: AwardLoyaltyPointsUseCase, useValue: mockAwardLoyalty },
          { provide: EventBusService, useValue: mockEventBus },
          { provide: AuditLogService, useValue: mockAudit },
          { provide: TelemetryService, useValue: mockTelemetry },
        ],
      });
      return { facade: TestBed.inject(PosFacade), mockAudit, mockTelemetry };
    }

    it('records an audit entry and telemetry on checkout', async () => {
      const { facade, mockAudit, mockTelemetry } = setup();
      await facade.checkout({ method: 'cash', amount: 100, transactionId: 'TXN-1' } as never);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'processPayment', entityId: 'TXN-1' })
      );
      expect(mockTelemetry.recordCounter).toHaveBeenCalledWith('payments.processed', 1, {
        method: 'cash',
      });
      expect(mockTelemetry.recordGauge).toHaveBeenCalled();
    });

    it('still returns a receipt when audit logging rejects', async () => {
      const { facade } = setup({ auditReject: true });
      const receipt = await facade.checkout({
        method: 'cash',
        amount: 100,
        transactionId: 'TXN-2',
      } as never);
      // Flush the fire-and-forget rejection so its .catch runs.
      await new Promise((r) => setTimeout(r, 0));
      expect(receipt).toBeTruthy();
    });

    it('still returns a receipt when telemetry throws', async () => {
      const { facade } = setup({ telemetryThrow: true });
      const receipt = await facade.checkout({
        method: 'card',
        amount: 50,
        transactionId: 'TXN-3',
      } as never);
      expect(receipt).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Loyalty at checkout (#177)
  // ---------------------------------------------------------------------------

  describe('attaching a customer by loyalty code', () => {
    function card(overrides: Partial<{ id: string; name: string }> = {}): Customer {
      return new Customer({
        id: overrides.id ?? 'customer-1',
        name: overrides.name ?? 'Marco Rossi',
        email: 'marco@example.com',
        phone: '+1234567890',
        status: CustomerStatus.ACTIVE,
        loyaltyPoints: 250,
        tier: CustomerTier.BRONZE,
        loyaltyCode: 'CAPY-B3KMNPQR',
      });
    }

    it('starts every sale anonymous', () => {
      expect(facade.attachedCustomer()).toBeNull();
    });

    it('attaches the customer the code resolves to', async () => {
      mockCustomers.getCustomerByLoyaltyCode.mockResolvedValue(card());

      const attached = await facade.attachCustomerByLoyaltyCode('capy b3kmnpqr');

      expect(mockCustomers.getCustomerByLoyaltyCode).toHaveBeenCalledWith('capy b3kmnpqr');
      expect(attached).toEqual({
        id: 'customer-1',
        name: 'Marco Rossi',
        loyaltyPoints: 250,
        tier: CustomerTier.BRONZE,
      });
      expect(facade.attachedCustomer()).toEqual(attached);
    });

    it('announces the attach without putting the customer on the bus by name', async () => {
      mockCustomers.getCustomerByLoyaltyCode.mockResolvedValue(card());

      await facade.attachCustomerByLoyaltyCode('CAPY-B3KMNPQR');

      const published = mockEventBus.publish.mock.calls.at(-1)?.[0];
      expect(published.type).toBe(EventType.CUSTOMER_ATTACHED);
      expect(published.payload).toEqual({ customerId: 'customer-1', tier: CustomerTier.BRONZE });
      expect(JSON.stringify(published)).not.toContain('Marco');
    });

    it('leaves the sale anonymous when the code matches nobody', async () => {
      mockCustomers.getCustomerByLoyaltyCode.mockResolvedValue(null);

      const attached = await facade.attachCustomerByLoyaltyCode('CAPY-00000000');

      expect(attached).toBeNull();
      expect(facade.attachedCustomer()).toBeNull();
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });

    it('leaves the sale anonymous when the lookup fails, rather than throwing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockCustomers.getCustomerByLoyaltyCode.mockRejectedValue(new Error('IndexedDB is gone'));

      await expect(facade.attachCustomerByLoyaltyCode('CAPY-B3KMNPQR')).resolves.toBeNull();

      expect(facade.attachedCustomer()).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('drops the attached customer on request', async () => {
      mockCustomers.getCustomerByLoyaltyCode.mockResolvedValue(card());
      await facade.attachCustomerByLoyaltyCode('CAPY-B3KMNPQR');

      facade.detachCustomer();

      expect(facade.attachedCustomer()).toBeNull();
    });

    it('releases the card when the cart is cleared', async () => {
      mockCustomers.getCustomerByLoyaltyCode.mockResolvedValue(card());
      await facade.attachCustomerByLoyaltyCode('CAPY-B3KMNPQR');

      facade.clearCart();

      // Clearing the cart voids the sale. Leaving the card attached would bill the
      // next shopper's points to whoever walked away.
      expect(mockCartService.clearCart).toHaveBeenCalled();
      expect(facade.attachedCustomer()).toBeNull();
    });

    it('replaces the attached customer when a second card is scanned', async () => {
      mockCustomers.getCustomerByLoyaltyCode.mockResolvedValue(card());
      await facade.attachCustomerByLoyaltyCode('CAPY-B3KMNPQR');

      mockCustomers.getCustomerByLoyaltyCode.mockResolvedValue(
        card({ id: 'customer-2', name: 'Lena Fischer' })
      );
      await facade.attachCustomerByLoyaltyCode('CAPY-C4LMNPQR');

      expect(facade.attachedCustomer()?.id).toBe('customer-2');
    });
  });

  describe('earning loyalty points at checkout', () => {
    const payment = { method: 'cash', amount: 42.75, transactionId: 'TXN-9' };

    async function attach(): Promise<void> {
      mockCustomers.getCustomerByLoyaltyCode.mockResolvedValue(
        new Customer({
          id: 'customer-1',
          name: 'Marco Rossi',
          email: 'marco@example.com',
          phone: '+1234567890',
          status: CustomerStatus.ACTIVE,
          loyaltyPoints: 250,
          tier: CustomerTier.BRONZE,
          loyaltyCode: 'CAPY-B3KMNPQR',
        })
      );
      await facade.attachCustomerByLoyaltyCode('CAPY-B3KMNPQR');
    }

    it('awards points for the attached customer on the amount paid', async () => {
      await attach();

      await facade.checkout(payment as never);

      await vi.waitFor(() =>
        expect(mockAwardLoyalty.execute).toHaveBeenCalledWith({
          customerId: 'customer-1',
          purchaseAmount: 42.75,
        })
      );
    });

    it('publishes the award, including whether the sale promoted them', async () => {
      mockAwardLoyalty.execute.mockResolvedValue({
        awarded: true,
        points: 420,
        balance: 1050,
        previousTier: CustomerTier.BRONZE,
        tier: CustomerTier.SILVER,
      });
      await attach();

      await facade.checkout(payment as never);

      await vi.waitFor(() => {
        const award = mockEventBus.publish.mock.calls
          .map((call) => call[0])
          .find((event) => event.type === EventType.LOYALTY_POINTS_AWARDED);
        expect(award?.payload).toEqual({
          customerId: 'customer-1',
          points: 420,
          balance: 1050,
          tier: CustomerTier.SILVER,
          promoted: true,
        });
      });
    });

    it('reports no promotion when the sale did not cross a threshold', async () => {
      mockAwardLoyalty.execute.mockResolvedValue({
        awarded: true,
        points: 420,
        balance: 670,
        previousTier: CustomerTier.BRONZE,
        tier: CustomerTier.BRONZE,
      });
      await attach();

      await facade.checkout(payment as never);

      await vi.waitFor(() => {
        const award = mockEventBus.publish.mock.calls
          .map((call) => call[0])
          .find((event) => event.type === EventType.LOYALTY_POINTS_AWARDED);
        expect(award?.payload).toMatchObject({ promoted: false });
      });
    });

    it('behaves exactly as before when no customer is attached', async () => {
      const receipt = await facade.checkout(payment as never);

      expect(mockAwardLoyalty.execute).not.toHaveBeenCalled();
      expect(receipt).toBeTruthy();
      expect(mockCartService.clearCart).toHaveBeenCalled();
      expect(
        mockEventBus.publish.mock.calls.some(
          (call) => call[0].type === EventType.LOYALTY_POINTS_AWARDED
        )
      ).toBe(false);
    });

    it('completes the sale and logs when the loyalty write fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mockAwardLoyalty.execute.mockResolvedValue({
        awarded: false,
        points: 0,
        balance: null,
        previousTier: null,
        tier: null,
        reason: 'award-failed',
        error: 'write conflict',
      });
      await attach();

      const receipt = await facade.checkout(payment as never);

      expect(receipt).toBeTruthy();
      expect(mockCartService.clearCart).toHaveBeenCalled();
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
      expect(
        mockEventBus.publish.mock.calls.some(
          (call) => call[0].type === EventType.LOYALTY_POINTS_AWARDED
        )
      ).toBe(false);
      warnSpy.mockRestore();
    });

    it('completes the sale when the award rejects outright', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockAwardLoyalty.execute.mockRejectedValue(new Error('unexpected'));
      await attach();

      const receipt = await facade.checkout(payment as never);

      expect(receipt).toBeTruthy();
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
      errorSpy.mockRestore();
    });

    it('does not award twice when the receipt is returned before the write lands', async () => {
      await attach();

      await facade.checkout(payment as never);
      await vi.waitFor(() => expect(mockAwardLoyalty.execute).toHaveBeenCalledTimes(1));
    });

    it('detaches the customer once the sale completes', async () => {
      await attach();
      expect(facade.attachedCustomer()).not.toBeNull();

      await facade.checkout(payment as never);

      // The next shopper must not inherit the last one's card.
      expect(facade.attachedCustomer()).toBeNull();
    });

    it('awards the customer captured at the start of the sale, not after the detach', async () => {
      await attach();

      await facade.checkout(payment as never);

      await vi.waitFor(() =>
        expect(mockAwardLoyalty.execute).toHaveBeenCalledWith(
          expect.objectContaining({ customerId: 'customer-1' })
        )
      );
    });
  });

  describe('database initialization', () => {
    it('should delegate initializeDatabase to DexieDatabase', async () => {
      await facade.initializeDatabase();
      expect(mockDb.initializeWithSeedData).toHaveBeenCalled();
    });
  });

  describe('cartRevision', () => {
    it('should expose the revision from CartService', () => {
      expect(facade.cartRevision()).toBe(0);
      mockCartService.revision.set(7);
      expect(facade.cartRevision()).toBe(7);
    });
  });
});

/**
 * Sourced from the real service on purpose. The point of `cartRevision` is that a
 * mutation made *outside* this facade is still visible through it, and a mocked
 * CartService can only ever prove the wiring, never that.
 */
describe('PosFacade cartRevision over the real CartService', () => {
  let facade: PosFacade;
  let cartService: CartService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PosFacade,
        CartService,
        { provide: GenerateReceiptUseCase, useValue: { execute: vi.fn(), fromSnapshot: vi.fn() } },
        { provide: AdjustStockOnSaleUseCase, useValue: { execute: vi.fn() } },
        { provide: DexieDatabase, useValue: { initializeWithSeedData: vi.fn() } },
        { provide: CustomerService, useValue: { getCustomerByLoyaltyCode: vi.fn() } },
        { provide: AwardLoyaltyPointsUseCase, useValue: { execute: vi.fn() } },
        { provide: EventBusService, useValue: { publish: vi.fn() } },
        { provide: AuditLogService, useValue: { log: vi.fn() } },
        { provide: TelemetryService, useValue: { recordCounter: vi.fn() } },
      ],
    });
    facade = TestBed.inject(PosFacade);
    cartService = TestBed.inject(CartService);
  });

  function stocked(id: string): Product {
    return new Product(id, 'Flat White', 3, `${id}-SKU`, 'Beverages', 9);
  }

  it('rises for a mutation made straight through CartService, as /pos components make', () => {
    const remembered = facade.cartRevision();

    // `shopping-cart.component.ts` and `checkout.component.ts` inject CartService
    // directly, so this is the ordinary case rather than a contrived one.
    cartService.addProduct(stocked('p1'));

    expect(facade.cartRevision()).toBeGreaterThan(remembered);
  });

  it('rises for a mutation made through the facade', () => {
    const remembered = facade.cartRevision();
    facade.tryAddToCart(stocked('p1'));
    expect(facade.cartRevision()).toBeGreaterThan(remembered);
  });

  it('does not rise for an add the facade refused', () => {
    const remembered = facade.cartRevision();
    // Nothing reached the cart, so nothing moved — a counter that bumped here would
    // report a foreign mutation that never happened.
    facade.tryAddToCart(new Product('p2', 'Sold Out', 3, 'P2-SKU', 'Beverages', 0));
    expect(facade.cartRevision()).toBe(remembered);
  });
});
