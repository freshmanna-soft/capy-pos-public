import { TestBed } from '@angular/core/testing';
import { CalculateCartTotalsUseCase, CartDiscount } from './calculate-cart-totals.use-case';
import { CartService } from '../services/cart.service';
import { Product } from '../../domain/entities/product.entity';

/**
 * Unit Tests for CalculateCartTotalsUseCase
 * Sprint 1 - Issue #5: Cart Total Calculation
 *
 * Tests cover:
 * - Subtotal calculation (sum of item prices × quantities)
 * - Tax calculation (applied to subtotal)
 * - Discount application (percentage and fixed)
 * - Total amount due (subtotal + tax - discounts)
 * - Dynamic updates when cart changes
 * - Edge cases (empty cart, single item, large quantities)
 */
describe('CalculateCartTotalsUseCase', () => {
  let useCase: CalculateCartTotalsUseCase;
  let cartService: CartService;

  const mockProduct1 = new Product(
    'prod-1', 'Organic Coffee', 12.99, 'COF-001', 'Beverages', 50, 'Premium coffee'
  );

  const mockProduct2 = new Product(
    'prod-2', 'Green Tea', 8.49, 'TEA-001', 'Beverages', 30, 'Matcha green tea'
  );

  const mockProduct3 = new Product(
    'prod-3', 'Croissant', 3.50, 'BKR-001', 'Bakery', 100, 'Fresh croissant'
  );

  beforeEach(() => {
    TestBed.configureTestingModule({});
    useCase = TestBed.inject(CalculateCartTotalsUseCase);
    cartService = TestBed.inject(CartService);
    cartService.clearCart();
  });

  describe('Empty Cart', () => {
    it('should return zero totals for empty cart', () => {
      const totals = useCase.totals();
      expect(totals.subtotal).toBe(0);
      expect(totals.taxAmount).toBe(0);
      expect(totals.discountAmount).toBe(0);
      expect(totals.total).toBe(0);
      expect(totals.itemCount).toBe(0);
      expect(totals.isEmpty).toBe(true);
    });

    it('should not display discount when cart is empty', () => {
      useCase.applyDiscount({ type: 'percentage', value: 10, label: '10% Off' });
      const totals = useCase.totals();
      expect(totals.discountAmount).toBe(0);
    });
  });

  describe('Subtotal Calculation', () => {
    it('should calculate subtotal for single item', () => {
      cartService.addProduct(mockProduct1); // 12.99
      const totals = useCase.totals();
      expect(totals.subtotal).toBeCloseTo(12.99, 2);
    });

    it('should calculate subtotal for multiple items', () => {
      cartService.addProduct(mockProduct1); // 12.99
      cartService.addProduct(mockProduct2); // 8.49
      const totals = useCase.totals();
      expect(totals.subtotal).toBeCloseTo(21.48, 2);
    });

    it('should calculate subtotal with quantities', () => {
      cartService.addProduct(mockProduct1); // 12.99
      cartService.increaseQuantity('prod-1'); // qty = 2
      const totals = useCase.totals();
      expect(totals.subtotal).toBeCloseTo(25.98, 2);
    });

    it('should calculate subtotal for large quantities', () => {
      cartService.addProduct(mockProduct3); // 3.50
      cartService.updateQuantity('prod-3', 20); // qty = 20
      const totals = useCase.totals();
      expect(totals.subtotal).toBeCloseTo(70.00, 2);
    });
  });

  describe('Tax Calculation', () => {
    it('should calculate tax on subtotal', () => {
      cartService.addProduct(mockProduct1); // 12.99
      const totals = useCase.totals();
      const expectedTax = 12.99 * 0.085; // default 8.5%
      expect(totals.taxAmount).toBeCloseTo(expectedTax, 2);
      expect(totals.taxRate).toBe(0.085);
    });

    it('should calculate tax with custom rate', () => {
      cartService.addProduct(mockProduct1); // 12.99
      cartService.setTaxRate(0.10); // 10%
      const totals = useCase.totals();
      expect(totals.taxAmount).toBeCloseTo(1.30, 2);
    });

    it('should calculate tax after discount', () => {
      cartService.addProduct(mockProduct1); // 12.99
      useCase.applyDiscount({ type: 'fixed', value: 2.99, label: '$2.99 Off' });
      const totals = useCase.totals();
      // Taxable amount = 12.99 - 2.99 = 10.00
      const expectedTax = 10.00 * 0.085;
      expect(totals.taxAmount).toBeCloseTo(expectedTax, 2);
    });
  });

  describe('Discount - Percentage', () => {
    it('should apply percentage discount', () => {
      cartService.addProduct(mockProduct1); // 12.99
      useCase.applyDiscount({ type: 'percentage', value: 10, label: '10% Off' });
      const totals = useCase.totals();
      expect(totals.discountAmount).toBeCloseTo(1.30, 2);
      expect(totals.discountLabel).toBe('10% Off');
    });

    it('should apply 50% discount', () => {
      cartService.addProduct(mockProduct1); // 12.99
      useCase.applyDiscount({ type: 'percentage', value: 50, label: '50% Off' });
      const totals = useCase.totals();
      expect(totals.discountAmount).toBeCloseTo(6.50, 2);
    });

    it('should reject percentage discount over 100%', () => {
      expect(() => {
        useCase.applyDiscount({ type: 'percentage', value: 101, label: 'Invalid' });
      }).toThrow('Percentage discount cannot exceed 100%');
    });

    it('should reject negative discount', () => {
      expect(() => {
        useCase.applyDiscount({ type: 'percentage', value: -5, label: 'Invalid' });
      }).toThrow('Discount value cannot be negative');
    });
  });

  describe('Discount - Fixed Amount', () => {
    it('should apply fixed discount', () => {
      cartService.addProduct(mockProduct1); // 12.99
      useCase.applyDiscount({ type: 'fixed', value: 5.00, label: '$5 Off' });
      const totals = useCase.totals();
      expect(totals.discountAmount).toBeCloseTo(5.00, 2);
    });

    it('should cap fixed discount at subtotal', () => {
      cartService.addProduct(mockProduct3); // 3.50
      useCase.applyDiscount({ type: 'fixed', value: 10.00, label: '$10 Off' });
      const totals = useCase.totals();
      expect(totals.discountAmount).toBeCloseTo(3.50, 2);
    });

    it('should remove discount', () => {
      cartService.addProduct(mockProduct1); // 12.99
      useCase.applyDiscount({ type: 'fixed', value: 5.00, label: '$5 Off' });
      expect(useCase.discountAmount()).toBeCloseTo(5.00, 2);

      useCase.removeDiscount();
      expect(useCase.discountAmount()).toBe(0);
      expect(useCase.discount()).toBeNull();
    });
  });

  describe('Total Calculation', () => {
    it('should calculate total as subtotal + tax (no discount)', () => {
      cartService.addProduct(mockProduct1); // 12.99
      const totals = useCase.totals();
      const expected = 12.99 + (12.99 * 0.085);
      expect(totals.total).toBeCloseTo(expected, 2);
    });

    it('should calculate total with discount', () => {
      cartService.addProduct(mockProduct1); // 12.99
      useCase.applyDiscount({ type: 'fixed', value: 2.99, label: '$2.99 Off' });
      const totals = useCase.totals();
      // Taxable = 12.99 - 2.99 = 10.00
      // Tax = 10.00 * 0.085 = 0.85
      // Total = 10.00 + 0.85 = 10.85
      expect(totals.total).toBeCloseTo(10.85, 2);
    });

    it('should calculate total with multiple items and discount', () => {
      cartService.addProduct(mockProduct1); // 12.99
      cartService.addProduct(mockProduct2); // 8.49
      useCase.applyDiscount({ type: 'percentage', value: 10, label: '10% Off' });
      const totals = useCase.totals();
      // Subtotal = 21.48
      // Discount = 21.48 * 0.10 = 2.148 → 2.15
      // Taxable = 21.48 - 2.15 = 19.33
      // Tax = 19.33 * 0.085 = 1.643 → 1.64
      // Total = 19.33 + 1.64 = 20.97
      expect(totals.total).toBeCloseTo(20.97, 1);
    });
  });

  describe('Dynamic Updates', () => {
    it('should update totals when item is added', () => {
      cartService.addProduct(mockProduct1);
      const totals1 = useCase.totals();
      expect(totals1.subtotal).toBeCloseTo(12.99, 2);

      cartService.addProduct(mockProduct2);
      const totals2 = useCase.totals();
      expect(totals2.subtotal).toBeCloseTo(21.48, 2);
    });

    it('should update totals when quantity changes', () => {
      cartService.addProduct(mockProduct1);
      expect(useCase.totals().subtotal).toBeCloseTo(12.99, 2);

      cartService.increaseQuantity('prod-1');
      expect(useCase.totals().subtotal).toBeCloseTo(25.98, 2);
    });

    it('should update totals when item is removed', () => {
      cartService.addProduct(mockProduct1);
      cartService.addProduct(mockProduct2);
      expect(useCase.totals().subtotal).toBeCloseTo(21.48, 2);

      cartService.removeItem('prod-1');
      expect(useCase.totals().subtotal).toBeCloseTo(8.49, 2);
    });

    it('should update totals when cart is cleared', () => {
      cartService.addProduct(mockProduct1);
      cartService.addProduct(mockProduct2);
      expect(useCase.totals().isEmpty).toBe(false);

      cartService.clearCart();
      expect(useCase.totals().isEmpty).toBe(true);
      expect(useCase.totals().subtotal).toBe(0);
      expect(useCase.totals().total).toBe(0);
    });

    it('should update discount amount when subtotal changes', () => {
      cartService.addProduct(mockProduct1); // 12.99
      useCase.applyDiscount({ type: 'percentage', value: 10, label: '10% Off' });
      expect(useCase.discountAmount()).toBeCloseTo(1.30, 2);

      cartService.addProduct(mockProduct2); // +8.49 = 21.48
      expect(useCase.discountAmount()).toBeCloseTo(2.15, 2);
    });
  });

  describe('Item Count', () => {
    it('should track total item count', () => {
      expect(useCase.totals().itemCount).toBe(0);

      cartService.addProduct(mockProduct1);
      expect(useCase.totals().itemCount).toBe(1);

      cartService.addProduct(mockProduct2);
      expect(useCase.totals().itemCount).toBe(2);

      cartService.increaseQuantity('prod-1');
      expect(useCase.totals().itemCount).toBe(3);
    });
  });
});
