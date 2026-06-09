import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CartTotalsComponent } from '@features/pos-terminal/components/cart-totals/cart-totals.component';
import { CalculateCartTotalsUseCase } from '@core/application/use-cases/calculate-cart-totals.use-case';
import { CartService } from '@core/application/services/cart.service';
import { ProductBuilder } from '@core/domain/entities/product.builder';

/**
 * Unit Tests for CartTotalsComponent
 * Sprint 1 - Issue #5: Cart Total Calculation
 *
 * Tests cover:
 * - Component creation
 * - Empty cart state (hidden)
 * - Subtotal display
 * - Tax display with rate
 * - Discount display (conditional)
 * - Total display
 * - Item count display
 * - Currency formatting
 * - Reactive updates when cart changes
 */
describe('CartTotalsComponent', () => {
  let component: CartTotalsComponent;
  let fixture: ComponentFixture<CartTotalsComponent>;
  let cartService: CartService;
  let totalsUseCase: CalculateCartTotalsUseCase;

  const mockProduct1 = new ProductBuilder()
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
      imports: [CartTotalsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CartTotalsComponent);
    component = fixture.componentInstance;
    cartService = TestBed.inject(CartService);
    totalsUseCase = TestBed.inject(CalculateCartTotalsUseCase);
    cartService.clearCart();
    totalsUseCase.removeDiscount();
    fixture.detectChanges();
  });

  describe('Component Creation', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should inject CalculateCartTotalsUseCase', () => {
      expect(component.totalsUseCase).toBeTruthy();
      expect(component.totalsUseCase).toBeInstanceOf(CalculateCartTotalsUseCase);
    });
  });

  describe('Empty Cart State', () => {
    it('should not render cart-totals when cart is empty', () => {
      fixture.detectChanges();
      const totalsEl = fixture.nativeElement.querySelector('[data-testid="cart-totals"]');
      expect(totalsEl).toBeNull();
    });
  });

  describe('Subtotal Display', () => {
    it('should display subtotal for single item', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      const subtotalEl = fixture.nativeElement.querySelector('[data-testid="totals-subtotal"]');
      expect(subtotalEl).toBeTruthy();
      expect(subtotalEl.textContent).toContain('$12.99');
    });

    it('should display subtotal for multiple items', () => {
      cartService.addProduct(mockProduct1);
      cartService.addProduct(mockProduct2);
      fixture.detectChanges();

      const subtotalEl = fixture.nativeElement.querySelector('[data-testid="totals-subtotal"]');
      expect(subtotalEl.textContent).toContain('$21.48');
    });

    it('should display subtotal label', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      const subtotalEl = fixture.nativeElement.querySelector('[data-testid="totals-subtotal"]');
      expect(subtotalEl.textContent).toContain('Subtotal');
    });
  });

  describe('Tax Display', () => {
    it('should display tax amount', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      const taxEl = fixture.nativeElement.querySelector('[data-testid="totals-tax"]');
      expect(taxEl).toBeTruthy();
      // Tax = 12.99 * 0.085 = 1.10
      expect(taxEl.textContent).toContain('$1.10');
    });

    it('should display tax rate percentage', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      const taxEl = fixture.nativeElement.querySelector('[data-testid="totals-tax"]');
      expect(taxEl.textContent).toContain('8.5%');
    });

    it('should update tax when rate changes', () => {
      cartService.addProduct(mockProduct1);
      cartService.setTaxRate(0.1);
      fixture.detectChanges();

      const taxEl = fixture.nativeElement.querySelector('[data-testid="totals-tax"]');
      expect(taxEl.textContent).toContain('10.0%');
      expect(taxEl.textContent).toContain('$1.30');
    });
  });

  describe('Discount Display', () => {
    it('should not display discount when none applied', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      const discountEl = fixture.nativeElement.querySelector('[data-testid="totals-discount"]');
      expect(discountEl).toBeNull();
    });

    it('should display discount when applied', () => {
      cartService.addProduct(mockProduct1);
      totalsUseCase.applyDiscount({ type: 'percentage', value: 10, label: '10% Off' });
      fixture.detectChanges();

      const discountEl = fixture.nativeElement.querySelector('[data-testid="totals-discount"]');
      expect(discountEl).toBeTruthy();
      expect(discountEl.textContent).toContain('10% Off');
      expect(discountEl.textContent).toContain('-$1.30');
    });

    it('should display fixed discount', () => {
      cartService.addProduct(mockProduct1);
      totalsUseCase.applyDiscount({ type: 'fixed', value: 5.0, label: '$5 Off' });
      fixture.detectChanges();

      const discountEl = fixture.nativeElement.querySelector('[data-testid="totals-discount"]');
      expect(discountEl).toBeTruthy();
      expect(discountEl.textContent).toContain('$5 Off');
      expect(discountEl.textContent).toContain('-$5.00');
    });

    it('should hide discount after removal', () => {
      cartService.addProduct(mockProduct1);
      totalsUseCase.applyDiscount({ type: 'fixed', value: 5.0, label: '$5 Off' });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="totals-discount"]')).toBeTruthy();

      totalsUseCase.removeDiscount();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="totals-discount"]')).toBeNull();
    });
  });

  describe('Total Display', () => {
    it('should display total amount', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      const totalEl = fixture.nativeElement.querySelector('[data-testid="totals-total"]');
      expect(totalEl).toBeTruthy();
      // Total = 12.99 + (12.99 * 0.085) = 12.99 + 1.10 = 14.09
      expect(totalEl.textContent).toContain('$14.09');
    });

    it('should display total with discount applied', () => {
      cartService.addProduct(mockProduct1);
      totalsUseCase.applyDiscount({ type: 'fixed', value: 2.99, label: '$2.99 Off' });
      fixture.detectChanges();

      const totalEl = fixture.nativeElement.querySelector('[data-testid="totals-total"]');
      // Taxable = 12.99 - 2.99 = 10.00, Tax = 0.85, Total = 10.85
      expect(totalEl.textContent).toContain('$10.85');
    });

    it('should display Total label', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      const totalEl = fixture.nativeElement.querySelector('[data-testid="totals-total"]');
      expect(totalEl.textContent).toContain('Total');
    });
  });

  describe('Item Count Display', () => {
    it('should display item count', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      const countEl = fixture.nativeElement.querySelector('[data-testid="totals-item-count"]');
      expect(countEl).toBeTruthy();
      expect(countEl.textContent).toContain('1');
    });

    it('should display correct count with multiple items', () => {
      cartService.addProduct(mockProduct1);
      cartService.addProduct(mockProduct2);
      cartService.increaseQuantity('prod-1');
      fixture.detectChanges();

      const countEl = fixture.nativeElement.querySelector('[data-testid="totals-item-count"]');
      // 2 (prod-1) + 1 (prod-2) = 3
      expect(countEl.textContent).toContain('3');
    });

    it('should display Items in cart label', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      const countEl = fixture.nativeElement.querySelector('[data-testid="totals-item-count"]');
      expect(countEl.textContent).toContain('Items in cart');
    });
  });

  describe('Currency Formatting', () => {
    it('should format currency with dollar sign and two decimals', () => {
      expect(component.formatCurrency(12.99)).toBe('$12.99');
    });

    it('should format zero correctly', () => {
      expect(component.formatCurrency(0)).toBe('$0.00');
    });

    it('should format whole numbers with two decimals', () => {
      expect(component.formatCurrency(10)).toBe('$10.00');
    });

    it('should round to two decimal places', () => {
      expect(component.formatCurrency(1.999)).toBe('$2.00');
    });
  });

  describe('Reactive Updates', () => {
    it('should update display when item is added', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      let subtotalEl = fixture.nativeElement.querySelector('[data-testid="totals-subtotal"]');
      expect(subtotalEl.textContent).toContain('$12.99');

      cartService.addProduct(mockProduct2);
      fixture.detectChanges();

      subtotalEl = fixture.nativeElement.querySelector('[data-testid="totals-subtotal"]');
      expect(subtotalEl.textContent).toContain('$21.48');
    });

    it('should update display when cart is cleared', () => {
      cartService.addProduct(mockProduct1);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="cart-totals"]')).toBeTruthy();

      cartService.clearCart();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="cart-totals"]')).toBeNull();
    });
  });
});
