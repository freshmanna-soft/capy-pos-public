import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { PosFacade } from './pos.facade';
import { CartService } from '@core/application/services/cart.service';
import { GenerateReceiptUseCase } from '@core/application/use-cases/generate-receipt.use-case';
import { AdjustStockOnSaleUseCase } from '@core/application/use-cases/adjust-stock-on-sale.use-case';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { Product } from '@core/domain/entities/product.entity';

describe('PosFacade', () => {
  let facade: PosFacade;
  let mockCartService: {
    items: WritableSignal<unknown[]>;
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

  beforeEach(() => {
    mockCartService = {
      items: signal([]),
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

    TestBed.configureTestingModule({
      providers: [
        PosFacade,
        { provide: CartService, useValue: mockCartService },
        { provide: GenerateReceiptUseCase, useValue: mockGenerateReceipt },
        { provide: AdjustStockOnSaleUseCase, useValue: mockAdjustStock },
        { provide: DexieDatabase, useValue: mockDb },
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

  describe('database initialization', () => {
    it('should delegate initializeDatabase to DexieDatabase', async () => {
      await facade.initializeDatabase();
      expect(mockDb.initializeWithSeedData).toHaveBeenCalled();
    });
  });
});
