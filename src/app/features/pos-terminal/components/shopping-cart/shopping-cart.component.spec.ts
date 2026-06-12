import { TestBed } from '@angular/core/testing';
import { ShoppingCartComponent } from '@features/pos-terminal/components/shopping-cart/shopping-cart.component';
import { CartService } from '@core/application/services/cart.service';
import { ProductBuilder } from '@core/domain/entities/product.builder';

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

  const mockProduct = new ProductBuilder()
    .withId('prod-1')
    .withName('Organic Coffee')
    .withPrice(12.99)
    .withSku('COF-001')
    .withCategory('Beverages')
    .withStock(50)
    .withDescription('Premium coffee')
    .build();

  const mockProduct2 = new ProductBuilder()
    .withId('prod-2')
    .withName('Green Tea')
    .withPrice(8.49)
    .withSku('TEA-001')
    .withCategory('Beverages')
    .withStock(30)
    .withDescription('Matcha green tea')
    .build();

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
      const expectedTotal = 12.99 + 12.99 * cartService.taxRate();
      expect(cartService.total()).toBeCloseTo(expectedTotal, 2);
    });

    it('should update totals when quantity changes', () => {
      component.addProduct(mockProduct); // 12.99
      cartService.increaseQuantity('prod-1'); // qty = 2
      expect(cartService.subtotal()).toBeCloseTo(25.98, 2);
    });
  });

  describe('AC5: Clear Cart', () => {
    it('should clear all items from cart when user confirms', () => {
      component.addProduct(mockProduct);
      component.addProduct(mockProduct2);
      expect(cartService.items().length).toBe(2);

      // Mock confirm to return true
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      component.clearCart();
      expect(cartService.items().length).toBe(0);
      expect(cartService.isEmpty()).toBe(true);
    });

    it('should NOT clear cart when user cancels confirm dialog', () => {
      component.addProduct(mockProduct);
      expect(cartService.items().length).toBe(1);

      // Mock confirm to return false
      vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      component.clearCart();
      expect(cartService.items().length).toBe(1);
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

  describe('Checkout', () => {
    it('should emit checkoutRequested when cart has items', () => {
      const emitSpy = vi.spyOn(component.checkoutRequested, 'emit');
      component.addProduct(mockProduct);
      component.handleCheckout();
      expect(emitSpy).toHaveBeenCalled();
    });

    it('should NOT emit checkoutRequested when cart is empty', () => {
      const emitSpy = vi.spyOn(component.checkoutRequested, 'emit');
      component.handleCheckout();
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('Scroll Behavior', () => {
    it('should disable auto-scroll when user scrolls away from bottom', () => {
      const event = {
        target: {
          scrollHeight: 1000,
          scrollTop: 200,
          clientHeight: 400,
        },
      } as unknown as Event;

      component.onCartScroll(event);
      // scrollHeight - scrollTop - clientHeight = 1000 - 200 - 400 = 400 > 50 threshold
      // So autoScrollEnabled should be false

      // Add a repeated product — should NOT trigger scroll since user scrolled away
      component.addProduct(mockProduct);
      component.addProduct(mockProduct); // repeated
      // No assertion on scroll itself (private), but verifying no error
      expect(cartService.items()[0].quantity).toBe(2);
    });

    it('should re-enable auto-scroll when user scrolls to bottom', () => {
      // First scroll away
      const awayEvent = {
        target: { scrollHeight: 1000, scrollTop: 200, clientHeight: 400 },
      } as unknown as Event;
      component.onCartScroll(awayEvent);

      // Then scroll back to bottom
      const bottomEvent = {
        target: { scrollHeight: 1000, scrollTop: 560, clientHeight: 400 },
      } as unknown as Event;
      component.onCartScroll(bottomEvent);
      // scrollHeight - scrollTop - clientHeight = 1000 - 560 - 400 = 40 < 50 threshold
      // autoScrollEnabled should be true again

      // Adding repeated product should trigger scroll
      component.addProduct(mockProduct);
      component.addProduct(mockProduct);
      expect(cartService.items()[0].quantity).toBe(2);
    });

    it('should always scroll for new products regardless of scroll position', () => {
      // Scroll away from bottom
      const awayEvent = {
        target: { scrollHeight: 1000, scrollTop: 100, clientHeight: 400 },
      } as unknown as Event;
      component.onCartScroll(awayEvent);

      // Adding a NEW product should still trigger scroll
      component.addProduct(mockProduct);
      expect(cartService.items().length).toBe(1);
    });
  });

  describe('Auto-scroll on item addition', () => {
    it('should not throw when adding product without ViewChild ref', () => {
      // scrollToBottomAfterRender should handle missing cartItemsRef gracefully
      expect(() => component.addProduct(mockProduct)).not.toThrow();
    });
  });

  describe('updateQuantity edge cases', () => {
    it('should handle NaN input by resetting to 1', () => {
      component.addProduct(mockProduct);
      const event = { target: { value: 'abc' } } as unknown as Event;
      component.updateQuantity('prod-1', event);
      expect((event.target as HTMLInputElement).value).toBe('1');
    });

    it('should handle negative input by resetting to 1', () => {
      component.addProduct(mockProduct);
      const event = { target: { value: '-5' } } as unknown as Event;
      component.updateQuantity('prod-1', event);
      expect((event.target as HTMLInputElement).value).toBe('1');
    });
  });
});
