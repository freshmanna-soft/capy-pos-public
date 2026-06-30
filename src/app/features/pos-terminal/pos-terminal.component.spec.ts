import { TestBed, ComponentFixture } from '@angular/core/testing';
import { PosTerminalComponent } from '@features/pos-terminal/pos-terminal.component';
import { ReceiptComponent } from '@features/pos-terminal/components/receipt/receipt.component';
import {
  CheckoutComponent,
  PaymentResult,
} from '@features/pos-terminal/components/checkout/checkout.component';
import { ProductSearchComponent } from '@features/pos-terminal/components/product-search/product-search.component';
import { ShoppingCartComponent } from '@features/pos-terminal/components/shopping-cart/shopping-cart.component';
import { CartService } from '@core/application/services/cart.service';
import { Product } from '@core/domain/entities/product.entity';
import { ProductBuilder } from '@core/domain/entities/product.builder';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { PosFacade } from '@core/application/facades';
import { GenerateReceiptUseCase } from '@core/application/use-cases/generate-receipt.use-case';
import { AdjustStockOnSaleUseCase } from '@core/application/use-cases/adjust-stock-on-sale.use-case';

/**
 * Unit Tests for PosTerminalComponent - S1-4: Add to Cart Interaction
 * Sprint 1 - Issue #4: Add to Cart Interaction
 *
 * Tests the integration between ProductSearch and ShoppingCart
 * via the PosTerminalComponent orchestrator (now using PosFacade).
 *
 * Acceptance Criteria:
 * - AC1: Clicking a product in the grid adds it to the cart
 * - AC2: Clicking the same product again increments quantity
 * - AC3: Out-of-stock products cannot be added to cart
 * - AC4: Cart state updates correctly after adding products
 * - AC5: Adding product beyond stock limit is prevented
 */
describe('PosTerminalComponent (S1-4: Add to Cart Interaction)', () => {
  let component: PosTerminalComponent;
  let fixture: ComponentFixture<PosTerminalComponent>;
  let cartService: CartService;

  const mockProducts = {
    coffee: new ProductBuilder()
      .withId('1')
      .withName('Organic Coffee')
      .withPrice(12.99)
      .withSku('COF-001')
      .withCategory('Beverages')
      .withStock(50)
      .withDescription('Premium coffee')
      .withEmoji('☕')
      .build(),
    tea: new ProductBuilder()
      .withId('2')
      .withName('Green Tea')
      .withPrice(8.49)
      .withSku('TEA-001')
      .withCategory('Beverages')
      .withStock(30)
      .withDescription('Matcha green tea')
      .withEmoji('🍵')
      .build(),
    chocolate: new ProductBuilder()
      .withId('3')
      .withName('Chocolate Bar')
      .withPrice(3.99)
      .withSku('CHO-001')
      .withCategory('Snacks')
      .withStock(100)
      .withDescription('Dark chocolate')
      .withEmoji('🍫')
      .build(),
    outOfStock: new ProductBuilder()
      .withId('4')
      .withName('Sold Out Item')
      .withPrice(5.99)
      .withSku('OOS-001')
      .withCategory('Snacks')
      .withStock(0)
      .withDescription('Unavailable')
      .withEmoji('❌')
      .build(),
    lowStock: new ProductBuilder()
      .withId('5')
      .withName('Last One')
      .withPrice(15.99)
      .withSku('LOW-001')
      .withCategory('Electronics')
      .withStock(1)
      .withDescription('Only 1 left')
      .withEmoji('📱')
      .build(),
  };

  const mockDexieDatabase = {
    initializeWithSeedData: vi.fn().mockResolvedValue(undefined),
  };

  const mockProductRepository = {
    search: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    getCategories: vi.fn().mockResolvedValue([]),
    adjustStock: vi.fn().mockResolvedValue({ id: '1', stock: 49 }),
  };

  const mockTransactionRepository = {
    save: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    vi.useFakeTimers();

    // Mock scrollTo for jsdom (not available in test environment)
    Element.prototype.scrollTo = vi.fn();

    await TestBed.configureTestingModule({
      imports: [
        PosTerminalComponent,
        ReceiptComponent,
        CheckoutComponent,
        ProductSearchComponent,
        ShoppingCartComponent,
      ],
      providers: [
        CartService,
        GenerateReceiptUseCase,
        AdjustStockOnSaleUseCase,
        PosFacade,
        { provide: DexieDatabase, useValue: mockDexieDatabase },
        { provide: PRODUCT_REPOSITORY, useValue: mockProductRepository },
        { provide: 'ITransactionRepository', useValue: mockTransactionRepository },
      ],
    }).compileComponents();

    cartService = TestBed.inject(CartService);
    fixture = TestBed.createComponent(PosTerminalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    // Reset receipt state to prevent NG0950 errors during cleanup
    component.handleNewTransactionFromReceipt();
    cartService.clearCart();
    fixture.destroy();
    vi.useRealTimers();
  });

  /** Helper to add product and flush setTimeout */
  function addProduct(product: Product): void {
    component.handleProductSelected(product);
    vi.advanceTimersByTime(0);
  }

  describe('AC1: Adding a product to an empty cart', () => {
    it('should add a product to the cart when handleProductSelected is called', () => {
      addProduct(mockProducts.coffee);

      expect(cartService.items().length).toBe(1);
      expect(cartService.items()[0].product.id).toBe('1');
      expect(cartService.items()[0].product.name).toBe('Organic Coffee');
      expect(cartService.items()[0].quantity).toBe(1);
    });

    it('should update total items count after adding a product', () => {
      addProduct(mockProducts.coffee);

      expect(cartService.totalItems()).toBe(1);
    });

    it('should calculate correct subtotal after adding a product', () => {
      addProduct(mockProducts.coffee);

      expect(cartService.subtotal()).toBe(12.99);
    });
  });

  describe('AC2: Adding the same product again (quantity increment)', () => {
    it('should increment quantity when same product is added twice', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.coffee);

      expect(cartService.items().length).toBe(1);
      expect(cartService.items()[0].quantity).toBe(2);
    });

    it('should update subtotal correctly for multiple quantities', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.coffee);

      expect(cartService.subtotal()).toBeCloseTo(12.99 * 3, 2);
      expect(cartService.totalItems()).toBe(3);
    });
  });

  describe('AC3: Adding different products', () => {
    it('should add multiple different products to the cart', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.tea);
      addProduct(mockProducts.chocolate);

      expect(cartService.items().length).toBe(3);
      expect(cartService.totalItems()).toBe(3);
    });

    it('should calculate correct subtotal for multiple products', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.tea);

      expect(cartService.subtotal()).toBeCloseTo(12.99 + 8.49, 2);
    });

    it('should maintain separate quantities for different products', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.tea);

      const coffeeItem = cartService.getItem('1');
      const teaItem = cartService.getItem('2');

      expect(coffeeItem?.quantity).toBe(2);
      expect(teaItem?.quantity).toBe(1);
    });
  });

  describe('AC4: Out-of-stock product prevention', () => {
    it('should NOT add out-of-stock product to cart', () => {
      addProduct(mockProducts.outOfStock);

      expect(cartService.items().length).toBe(0);
      expect(cartService.totalItems()).toBe(0);
    });

    it('should not affect existing cart items when out-of-stock product is attempted', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.outOfStock);

      expect(cartService.items().length).toBe(1);
      expect(cartService.items()[0].product.id).toBe('1');
    });
  });

  describe('AC5: Stock limit enforcement', () => {
    it('should not add product beyond available stock', () => {
      // lowStock has stock of 1
      addProduct(mockProducts.lowStock);
      addProduct(mockProducts.lowStock);

      const item = cartService.getItem('5');
      expect(item?.quantity).toBe(1); // Should not exceed stock
    });

    it('should allow adding up to stock limit', () => {
      // tea has stock of 30
      for (let i = 0; i < 5; i++) {
        addProduct(mockProducts.tea);
      }

      const item = cartService.getItem('2');
      expect(item?.quantity).toBe(5); // Well within stock limit
    });
  });

  describe('Cart state consistency', () => {
    it('should have empty cart initially', () => {
      expect(cartService.isEmpty()).toBe(true);
      expect(cartService.items().length).toBe(0);
      expect(cartService.totalItems()).toBe(0);
      expect(cartService.subtotal()).toBe(0);
    });

    it('should not be empty after adding a product', () => {
      addProduct(mockProducts.coffee);

      expect(cartService.isEmpty()).toBe(false);
    });

    it('should calculate tax correctly', () => {
      addProduct(mockProducts.coffee);

      // Default tax rate is 8.5%
      expect(cartService.tax()).toBeCloseTo(12.99 * 0.085, 2);
    });

    it('should calculate total (subtotal + tax) correctly', () => {
      addProduct(mockProducts.coffee);

      const expectedTotal = 12.99 + 12.99 * 0.085;
      expect(cartService.total()).toBeCloseTo(expectedTotal, 2);
    });
  });

  describe('New Transaction', () => {
    it('should clear the cart when clearCart is called on service', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.tea);

      expect(cartService.items().length).toBe(2);

      cartService.clearCart();

      expect(cartService.isEmpty()).toBe(true);
      expect(cartService.items().length).toBe(0);
    });
  });

  describe('startNewTransaction', () => {
    it('should clear the cart when the user confirms', () => {
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.tea);
      expect(cartService.items().length).toBe(2);

      component.startNewTransaction();

      expect(confirmSpy).toHaveBeenCalled();
      expect(cartService.isEmpty()).toBe(true);
      confirmSpy.mockRestore();
    });

    it('should NOT clear the cart when the user cancels confirmation', () => {
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      addProduct(mockProducts.coffee);
      expect(cartService.items().length).toBe(1);

      component.startNewTransaction();

      expect(cartService.items().length).toBe(1);
      confirmSpy.mockRestore();
    });

    it('should clear without confirmation when the cart is already empty', () => {
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      expect(cartService.isEmpty()).toBe(true);

      component.startNewTransaction();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(cartService.isEmpty()).toBe(true);
      confirmSpy.mockRestore();
    });
  });

  describe('handleAddProduct', () => {
    it('should focus the product search input', () => {
      const focusSpy = vi.fn();
      (component as never as { productSearch: { focusSearch: () => void } }).productSearch = {
        focusSearch: focusSpy,
      };

      component.handleAddProduct();

      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe('openCheckout', () => {
    it('should set showCheckout to true when cart is not empty', () => {
      addProduct(mockProducts.coffee);
      expect(component.showCheckout()).toBe(false);

      component.openCheckout();

      expect(component.showCheckout()).toBe(true);
    });

    it('should NOT set showCheckout to true when cart is empty', () => {
      expect(cartService.isEmpty()).toBe(true);

      component.openCheckout();

      expect(component.showCheckout()).toBe(false);
    });
  });

  describe('closeCheckout', () => {
    it('should set showCheckout to false', () => {
      addProduct(mockProducts.coffee);
      component.openCheckout();
      expect(component.showCheckout()).toBe(true);

      component.closeCheckout();

      expect(component.showCheckout()).toBe(false);
    });
  });

  describe('handlePrintReceipt', () => {
    it('should call window.print()', () => {
      const printSpy = vi.spyOn(globalThis, 'print').mockImplementation(() => undefined);

      component.handlePrintReceipt();

      expect(printSpy).toHaveBeenCalled();
      printSpy.mockRestore();
    });
  });

  describe('handleProductSelected feedback', () => {
    it('should add the product synchronously (no setTimeout deferral)', () => {
      component.handleProductSelected(mockProducts.coffee);

      // No timer advance needed — the add is immediate.
      expect(cartService.items().length).toBe(1);
    });

    it('should not add an out-of-stock product', () => {
      component.handleProductSelected(mockProducts.outOfStock);

      expect(cartService.isEmpty()).toBe(true);
    });
  });

  describe('S3-2: Receipt Generation after Payment', () => {
    const mockPaymentResult: PaymentResult = {
      method: 'cash',
      amount: 50,
      change: 35.9,
      transactionId: 'TXN-TEST-001',
      timestamp: new Date('2026-06-08T14:30:00'),
    };

    it('should show receipt after payment completes', async () => {
      addProduct(mockProducts.coffee);
      component.handlePaymentComplete(mockPaymentResult);

      // handlePaymentComplete is async (uses .then()), flush microtasks
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.showReceipt()).toBe(true);
      expect(component.showCheckout()).toBe(false);
    });

    it('should generate receipt data with cart items before clearing', async () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.tea);

      component.handlePaymentComplete(mockPaymentResult);

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const receipt = component.receiptData();
      expect(receipt).not.toBeNull();
      expect(receipt!.items).toHaveLength(2);
      expect(receipt!.items[0].product.name).toBe('Organic Coffee');
      expect(receipt!.items[1].product.name).toBe('Green Tea');
    });

    it('should include correct totals in receipt', async () => {
      addProduct(mockProducts.coffee); // 12.99

      component.handlePaymentComplete(mockPaymentResult);

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const receipt = component.receiptData();
      expect(receipt!.subtotal).toBeCloseTo(12.99, 2);
      expect(receipt!.taxRate).toBe(0.085);
      expect(receipt!.tax).toBeCloseTo(12.99 * 0.085, 2);
      expect(receipt!.total).toBeCloseTo(12.99 + 12.99 * 0.085, 2);
    });

    it('should include payment details in receipt', async () => {
      addProduct(mockProducts.coffee);

      component.handlePaymentComplete(mockPaymentResult);

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const receipt = component.receiptData();
      expect(receipt!.payment.method).toBe('cash');
      expect(receipt!.payment.amount).toBe(50);
      expect(receipt!.payment.change).toBe(35.9);
      expect(receipt!.payment.transactionId).toBe('TXN-TEST-001');
    });

    it('should clear cart after generating receipt', async () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.tea);

      component.handlePaymentComplete(mockPaymentResult);

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(cartService.isEmpty()).toBe(true);
    });

    it('should store lastPayment signal', async () => {
      addProduct(mockProducts.coffee);

      component.handlePaymentComplete(mockPaymentResult);

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.lastPayment()).toBe(mockPaymentResult);
    });

    it('should dismiss receipt and reset state on new transaction', async () => {
      addProduct(mockProducts.coffee);
      component.handlePaymentComplete(mockPaymentResult);

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(component.showReceipt()).toBe(true);

      component.handleNewTransactionFromReceipt();

      expect(component.showReceipt()).toBe(false);
      expect(component.receiptData()).toBeNull();
      expect(component.lastPayment()).toBeNull();
    });

    it('should handle receipt with multiple quantities', async () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.coffee);

      component.handlePaymentComplete(mockPaymentResult);

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const receipt = component.receiptData();
      expect(receipt!.items).toHaveLength(1);
      expect(receipt!.items[0].quantity).toBe(3);
      expect(receipt!.subtotal).toBeCloseTo(12.99 * 3, 2);
    });
  });

  describe('Mobile Cart', () => {
    it('should toggle mobileCartOpen from false to true', () => {
      expect(component.mobileCartOpen()).toBe(false);

      component.toggleMobileCart();

      expect(component.mobileCartOpen()).toBe(true);
    });

    it('should toggle mobileCartOpen from true to false', () => {
      component.toggleMobileCart(); // open
      expect(component.mobileCartOpen()).toBe(true);

      component.toggleMobileCart(); // close

      expect(component.mobileCartOpen()).toBe(false);
    });

    it('should close mobile cart via closeMobileCart', () => {
      component.toggleMobileCart(); // open
      expect(component.mobileCartOpen()).toBe(true);

      component.closeMobileCart();

      expect(component.mobileCartOpen()).toBe(false);
    });

    it('should be a no-op when closeMobileCart is called while already closed', () => {
      expect(component.mobileCartOpen()).toBe(false);

      component.closeMobileCart();

      expect(component.mobileCartOpen()).toBe(false);
    });
  });

  describe('ngOnInit error path', () => {
    it('should log error when database initialization fails', async () => {
      const errorSpy = vi.spyOn(console, 'error');
      mockDexieDatabase.initializeWithSeedData.mockRejectedValueOnce(new Error('DB init failed'));

      // Re-trigger ngOnInit
      component.ngOnInit();

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(errorSpy).toHaveBeenCalledWith('Failed to initialize database:', expect.any(Error));
    });
  });

  describe('handlePaymentComplete error path', () => {
    it('should log error when checkout fails', async () => {
      const errorSpy = vi.spyOn(console, 'error');
      vi.spyOn(component['posFacade'], 'checkout').mockRejectedValueOnce(
        new Error('Checkout error')
      );

      addProduct(mockProducts.coffee);
      component.handlePaymentComplete({
        method: 'cash',
        amount: 50,
        change: 37.01,
        transactionId: 'TXN-FAIL',
        timestamp: new Date(),
      });

      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(errorSpy).toHaveBeenCalledWith('[POS] Checkout failed:', expect.any(Error));
    });
  });
});
