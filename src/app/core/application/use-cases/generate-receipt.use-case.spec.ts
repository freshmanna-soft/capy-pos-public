import { TestBed } from '@angular/core/testing';
import { GenerateReceiptUseCase, ReceiptData } from './generate-receipt.use-case';
import { CartService } from '../services/cart.service';
import { Product } from '../../domain/entities/product.entity';
import { PaymentResult } from '../../../features/pos-terminal/components/checkout/checkout.component';

/**
 * Unit Tests for GenerateReceiptUseCase
 *
 * Sprint 3 Story S3-2: Generate and Display Receipt after Payment
 *
 * Acceptance Criteria:
 * - Receipt generated from current cart state and payment result
 * - Receipt includes all items with quantities and prices
 * - Receipt includes subtotal, tax, taxRate, and total
 * - Receipt includes full payment details (method, amount, change, transactionId)
 * - fromSnapshot reconstructs receipt from persisted data
 */
describe('GenerateReceiptUseCase', () => {
  let useCase: GenerateReceiptUseCase;
  let cartService: CartService;

  const mockPayment: PaymentResult = {
    method: 'cash',
    amount: 50.0,
    change: 7.83,
    transactionId: 'TXN-20260608-001',
    timestamp: new Date('2026-06-08T14:30:00'),
  };

  const mockProducts = {
    coffee: new Product(
      '1', 'Organic Coffee', 12.99, 'COF-001', 'Beverages',
      50, 'Premium coffee', undefined, undefined, '☕'
    ),
    muffin: new Product(
      '2', 'Blueberry Muffin', 4.50, 'MUF-001', 'Food',
      30, 'Fresh muffin', undefined, undefined, '🧁'
    ),
    juice: new Product(
      '3', 'Orange Juice', 6.99, 'JUI-001', 'Beverages',
      20, 'Fresh squeezed', undefined, undefined, '🍊'
    ),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GenerateReceiptUseCase, CartService],
    });

    useCase = TestBed.inject(GenerateReceiptUseCase);
    cartService = TestBed.inject(CartService);
  });

  afterEach(() => {
    cartService.clearCart();
  });

  describe('execute() - Generate from current cart state', () => {
    it('should generate receipt with single item', () => {
      cartService.addProduct(mockProducts.coffee);

      const receipt = useCase.execute(mockPayment);

      expect(receipt.payment).toBe(mockPayment);
      expect(receipt.items).toHaveLength(1);
      expect(receipt.items[0].product.id).toBe('1');
      expect(receipt.items[0].quantity).toBe(1);
    });

    it('should generate receipt with multiple items', () => {
      cartService.addProduct(mockProducts.coffee);
      cartService.addProduct(mockProducts.muffin);
      cartService.addProduct(mockProducts.juice);

      const receipt = useCase.execute(mockPayment);

      expect(receipt.items).toHaveLength(3);
      expect(receipt.items[0].product.name).toBe('Organic Coffee');
      expect(receipt.items[1].product.name).toBe('Blueberry Muffin');
      expect(receipt.items[2].product.name).toBe('Orange Juice');
    });

    it('should capture correct quantities for repeated products', () => {
      cartService.addProduct(mockProducts.coffee);
      cartService.addProduct(mockProducts.coffee);
      cartService.addProduct(mockProducts.muffin);

      const receipt = useCase.execute(mockPayment);

      expect(receipt.items).toHaveLength(2);
      expect(receipt.items[0].quantity).toBe(2);
      expect(receipt.items[1].quantity).toBe(1);
    });

    it('should calculate correct subtotal', () => {
      cartService.addProduct(mockProducts.coffee); // 12.99
      cartService.addProduct(mockProducts.muffin); // 4.50

      const receipt = useCase.execute(mockPayment);

      expect(receipt.subtotal).toBeCloseTo(17.49, 2);
    });

    it('should calculate correct tax at default rate (8.5%)', () => {
      cartService.addProduct(mockProducts.coffee); // 12.99

      const receipt = useCase.execute(mockPayment);

      expect(receipt.taxRate).toBe(0.085);
      expect(receipt.tax).toBeCloseTo(12.99 * 0.085, 2);
    });

    it('should calculate correct total (subtotal + tax)', () => {
      cartService.addProduct(mockProducts.coffee); // 12.99

      const receipt = useCase.execute(mockPayment);

      const expectedTotal = 12.99 + 12.99 * 0.085;
      expect(receipt.total).toBeCloseTo(expectedTotal, 2);
    });

    it('should include full payment details', () => {
      cartService.addProduct(mockProducts.coffee);

      const receipt = useCase.execute(mockPayment);

      expect(receipt.payment.method).toBe('cash');
      expect(receipt.payment.amount).toBe(50.0);
      expect(receipt.payment.change).toBe(7.83);
      expect(receipt.payment.transactionId).toBe('TXN-20260608-001');
      expect(receipt.payment.timestamp).toEqual(new Date('2026-06-08T14:30:00'));
    });

    it('should capture custom tax rate', () => {
      cartService.setTaxRate(0.10); // 10%
      cartService.addProduct(mockProducts.coffee);

      const receipt = useCase.execute(mockPayment);

      expect(receipt.taxRate).toBe(0.10);
      expect(receipt.tax).toBeCloseTo(12.99 * 0.10, 2);
    });

    it('should return a copy of items (not a reference)', () => {
      cartService.addProduct(mockProducts.coffee);

      const receipt = useCase.execute(mockPayment);
      cartService.clearCart();

      // Receipt items should still be intact after cart is cleared
      expect(receipt.items).toHaveLength(1);
      expect(receipt.items[0].product.name).toBe('Organic Coffee');
    });

    it('should handle card payment without change', () => {
      cartService.addProduct(mockProducts.coffee);

      const cardPayment: PaymentResult = {
        method: 'card',
        amount: 14.09,
        change: undefined,
        transactionId: 'TXN-CARD-001',
        timestamp: new Date(),
      };

      const receipt = useCase.execute(cardPayment);

      expect(receipt.payment.method).toBe('card');
      expect(receipt.payment.change).toBeUndefined();
    });

    it('should handle empty cart gracefully', () => {
      const receipt = useCase.execute(mockPayment);

      expect(receipt.items).toHaveLength(0);
      expect(receipt.subtotal).toBe(0);
      expect(receipt.tax).toBe(0);
      expect(receipt.total).toBe(0);
    });
  });

  describe('fromSnapshot() - Reconstruct from persisted data', () => {
    it('should reconstruct receipt from explicit values', () => {
      const items = [
        { product: mockProducts.coffee as any, quantity: 2 },
        { product: mockProducts.muffin as any, quantity: 1 },
      ];

      const receipt = useCase.fromSnapshot(
        mockPayment, items, 30.48, 2.59, 0.085, 33.07
      );

      expect(receipt.payment).toBe(mockPayment);
      expect(receipt.items).toHaveLength(2);
      expect(receipt.subtotal).toBe(30.48);
      expect(receipt.tax).toBe(2.59);
      expect(receipt.taxRate).toBe(0.085);
      expect(receipt.total).toBe(33.07);
    });

    it('should not depend on cart service state', () => {
      cartService.addProduct(mockProducts.juice);

      const items = [
        { product: mockProducts.coffee as any, quantity: 1 },
      ];

      const receipt = useCase.fromSnapshot(
        mockPayment, items, 12.99, 1.10, 0.085, 14.09
      );

      // Should use provided values, not cart state
      expect(receipt.items).toHaveLength(1);
      expect(receipt.items[0].product.name).toBe('Organic Coffee');
      expect(receipt.subtotal).toBe(12.99);
    });
  });
});
