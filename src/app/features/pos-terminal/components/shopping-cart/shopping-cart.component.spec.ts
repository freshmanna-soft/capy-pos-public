import { TestBed } from '@angular/core/testing';
import { ShoppingCartComponent } from './shopping-cart.component';
import { CartService } from '../../../../core/application/services/cart.service';
import { Product } from '../../../../core/domain/entities/product.entity';

/**
 * Unit Tests for ShoppingCartComponent
 * Sprint 1 - Issue #3: Shopping Cart Component
 * 
 * Acceptance Criteria:
 * - AC1: Display cart items with product name, price, quantity
 * - AC2: Quantity controls (increase/decrease/manual input)
 * - AC3: Remove item from cart
 * - AC4: Cart summary (subtotal, tax, total)
 * - AC5: Clear cart with confirmation
 * - AC6: Empty cart state display
 * - AC7: Checkout button
 */
describe('ShoppingCartComponent', () => {
  let component: ShoppingCartComponent;
  let cartService: CartService;

  const mockProduct = new Product(
    'prod-1', 'Organic Coffee', 12.99, 'COF-001', 'Beverages', 50, 'Premium coffee'
  );

  const mockProduct2 = new Product(
    'prod-2', 'Green Tea', 8.49, 'TEA-001', 'Beverages', 30, 'Matcha green tea'
  );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShoppingCartComponent],
    }).compileComponents();

    cartService = TestBed.inject(CartService);
    // Clear cart state between tests
    cartService.clearCart();

    const fixture = TestBed.createComponent(ShoppingCartComponent);
    component = fixture.componentInstance;
  });

  describe('Initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should inject CartService', () => {
      expect(component.cartService).toBeTruthy();
    });
  });

  describe('AC1: Display Cart Items', () => {
    it('should show empty cart when no items', () => {
      expect(cartService.isEmpty()).toBe(true);
      expect(cartService.totalItems()).toBe(0);
    });

    it('should display items after adding products', () => {
      component.addProduct(mockProduct);
      expect(cartService.isEmpty()).toBe(false);
      expect(cartService.items().length).toBe(1);
      expect(cartService.items()[0].product.name).toBe('Organic Coffee');
    });
  });

  describe('AC2: Quantity Controls', () => {
    beforeEach(() => {
      component.addProduct(mockProduct);
    });

    it('should increase quantity', () => {
      cartService.increaseQuantity('prod-1');
      expect(cartService.items()[0].quantity).toBe(2);
    });

    it('should decrease quantity', () => {
      cartService.increaseQuantity('prod-1'); // qty = 2
      cartService.decreaseQuantity('prod-1'); // qty = 1
      expect(cartService.items()[0].quantity).toBe(1);
    });

    it('should update quantity via input', () => {
      const event = { target: { value: '5' } } as unknown as Event;
      component.updateQuantity('prod-1', event);
      expect(cartService.items()[0].quantity).toBe(5);
    });

    it('should not allow quantity below 1', () => {
      const event = { target: { value: '0' } } as unknown as Event;
      component.updateQuantity('prod-1', event);
      // Should reset to 1
      expect((event.target as HTMLInputElement).value).toBe('1');
    });

    it('should cap quantity at stock level', () => {
      const event = { target: { value: '999' } } as unknown as Event;
      component.updateQuantity('prod-1', event);
      expect(cartService.items()[0].quantity).toBe(50); // stock is 50
    });
  });

  describe('AC3: Remove Item', () => {
    it('should remove item from cart', () => {
      component.addProduct(mockProduct);
      component.addProduct(mockProduct2);
      expect(cartService.items().length).toBe(2);

      cartService.removeItem('prod-1');
      expect(cartService.items().length).toBe(1);
      expect(cartService.items()[0].product.id).toBe('prod-2');
    });
  });

  describe('AC4: Cart Summary', () => {
    it('should calculate subtotal correctly', () => {
      component.addProduct(mockProduct); // 12.99
      component.addProduct(mockProduct2); // 8.49
      expect(cartService.subtotal()).toBeCloseTo(21.48, 2);
    });

    it('should calculate tax correctly', () => {
      component.addProduct(mockProduct); // 12.99
      const expectedTax = 12.99 * cartService.taxRate();
      expect(cartService.tax()).toBeCloseTo(expectedTax, 2);
    });

    it('should calculate total (subtotal + tax)', () => {
      component.addProduct(mockProduct); // 12.99
      const expectedTotal = 12.99 + (12.99 * cartService.taxRate());
      expect(cartService.total()).toBeCloseTo(expectedTotal, 2);
    });

    it('should update totals when quantity changes', () => {
      component.addProduct(mockProduct); // 12.99
      cartService.increaseQuantity('prod-1'); // qty = 2
      expect(cartService.subtotal()).toBeCloseTo(25.98, 2);
    });
  });

  describe('AC5: Clear Cart', () => {
    it('should clear all items from cart', () => {
      component.addProduct(mockProduct);
      component.addProduct(mockProduct2);
      expect(cartService.items().length).toBe(2);

      // Directly call cartService.clearCart() (component uses confirm dialog)
      cartService.clearCart();
      expect(cartService.items().length).toBe(0);
      expect(cartService.isEmpty()).toBe(true);
    });
  });

  describe('AC6: Empty Cart State', () => {
    it('should report empty when no items', () => {
      expect(cartService.isEmpty()).toBe(true);
      expect(cartService.totalItems()).toBe(0);
    });
  });

  describe('AC7: Add Product (Public API)', () => {
    it('should add product via public method', () => {
      component.addProduct(mockProduct);
      expect(cartService.items().length).toBe(1);
    });

    it('should increment quantity if product already in cart', () => {
      component.addProduct(mockProduct);
      component.addProduct(mockProduct);
      expect(cartService.items().length).toBe(1);
      expect(cartService.items()[0].quantity).toBe(2);
    });
  });
});
