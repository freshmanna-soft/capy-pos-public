import { TestBed, ComponentFixture } from '@angular/core/testing';
import { PosTerminalComponent } from './pos-terminal.component';
import { CartService } from '../../core/application/services/cart.service';
import { GenerateReceiptUseCase } from '../../core/application/use-cases/generate-receipt.use-case';
import { Product } from '../../core/domain/entities/product.entity';
import { DexieDatabase } from '../../core/infrastructure/database/dexie-database.service';
import { PRODUCT_REPOSITORY } from '../../core/infrastructure/factories/repository.factory';
import { PaymentResult } from './components/checkout/checkout.component';

/**
 * Unit Tests for PosTerminalComponent - S1-4: Add to Cart Interaction
 * Sprint 1 - Issue #4: Add to Cart Interaction
 * 
 * Tests the integration between ProductSearch/ProductGrid and ShoppingCart
 * via the PosTerminalComponent orchestrator.
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
    coffee: new Product('1', 'Organic Coffee', 12.99, 'COF-001', 'Beverages', 50, 'Premium coffee', undefined, undefined, '☕'),
    tea: new Product('2', 'Green Tea', 8.49, 'TEA-001', 'Beverages', 30, 'Matcha green tea', undefined, undefined, '🍵'),
    chocolate: new Product('3', 'Chocolate Bar', 3.99, 'CHO-001', 'Snacks', 100, 'Dark chocolate', undefined, undefined, '🍫'),
    outOfStock: new Product('4', 'Sold Out Item', 5.99, 'OOS-001', 'Snacks', 0, 'Unavailable', undefined, undefined, '❌'),
    lowStock: new Product('5', 'Last One', 15.99, 'LOW-001', 'Electronics', 1, 'Only 1 left', undefined, undefined, '📱'),
  };

  const mockDexieDatabase = {
    initializeWithSeedData: vi.fn().mockResolvedValue(undefined),
  };

  const mockProductRepository = {
    search: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    getCategories: vi.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    vi.useFakeTimers();

    await TestBed.configureTestingModule({
      imports: [PosTerminalComponent],
      providers: [
        CartService,
        { provide: DexieDatabase, useValue: mockDexieDatabase },
        { provide: PRODUCT_REPOSITORY, useValue: mockProductRepository },
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

      const expectedTotal = 12.99 + (12.99 * 0.085);
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

  describe('S3-2: Receipt Generation after Payment', () => {
    const mockPaymentResult: PaymentResult = {
      method: 'cash',
      amount: 50.0,
      change: 35.9,
      transactionId: 'TXN-TEST-001',
      timestamp: new Date('2026-06-08T14:30:00'),
    };

    it('should show receipt after payment completes', () => {
      addProduct(mockProducts.coffee);
      component.handlePaymentComplete(mockPaymentResult);

      expect(component.showReceipt()).toBe(true);
      expect(component.showCheckout()).toBe(false);
    });

    it('should generate receipt data with cart items before clearing', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.tea);

      component.handlePaymentComplete(mockPaymentResult);

      const receipt = component.receiptData();
      expect(receipt).not.toBeNull();
      expect(receipt!.items).toHaveLength(2);
      expect(receipt!.items[0].product.name).toBe('Organic Coffee');
      expect(receipt!.items[1].product.name).toBe('Green Tea');
    });

    it('should include correct totals in receipt', () => {
      addProduct(mockProducts.coffee); // 12.99

      component.handlePaymentComplete(mockPaymentResult);

      const receipt = component.receiptData();
      expect(receipt!.subtotal).toBeCloseTo(12.99, 2);
      expect(receipt!.taxRate).toBe(0.085);
      expect(receipt!.tax).toBeCloseTo(12.99 * 0.085, 2);
      expect(receipt!.total).toBeCloseTo(12.99 + 12.99 * 0.085, 2);
    });

    it('should include payment details in receipt', () => {
      addProduct(mockProducts.coffee);

      component.handlePaymentComplete(mockPaymentResult);

      const receipt = component.receiptData();
      expect(receipt!.payment.method).toBe('cash');
      expect(receipt!.payment.amount).toBe(50.0);
      expect(receipt!.payment.change).toBe(35.9);
      expect(receipt!.payment.transactionId).toBe('TXN-TEST-001');
    });

    it('should clear cart after generating receipt', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.tea);

      component.handlePaymentComplete(mockPaymentResult);

      expect(cartService.isEmpty()).toBe(true);
    });

    it('should store lastPayment signal', () => {
      addProduct(mockProducts.coffee);

      component.handlePaymentComplete(mockPaymentResult);

      expect(component.lastPayment()).toBe(mockPaymentResult);
    });

    it('should dismiss receipt and reset state on new transaction', () => {
      addProduct(mockProducts.coffee);
      component.handlePaymentComplete(mockPaymentResult);

      expect(component.showReceipt()).toBe(true);

      component.handleNewTransactionFromReceipt();

      expect(component.showReceipt()).toBe(false);
      expect(component.receiptData()).toBeNull();
      expect(component.lastPayment()).toBeNull();
    });

    it('should handle receipt with multiple quantities', () => {
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.coffee);
      addProduct(mockProducts.coffee);

      component.handlePaymentComplete(mockPaymentResult);

      const receipt = component.receiptData();
      expect(receipt!.items).toHaveLength(1);
      expect(receipt!.items[0].quantity).toBe(3);
      expect(receipt!.subtotal).toBeCloseTo(12.99 * 3, 2);
    });
  });
});
