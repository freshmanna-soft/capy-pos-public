import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductGridComponent } from '@shared/ui/organisms/product-grid/product-grid.component';
import { Product } from '@core/domain/entities/product.entity';

describe('ProductGridComponent (S1-2: Search Results Display)', () => {
  let component: ProductGridComponent;
  let fixture: ComponentFixture<ProductGridComponent>;
  let el: HTMLElement;

  const mockProducts: Product[] = [
    Product.fromJSON({
      id: '1',
      name: 'Organic Coffee',
      price: 12.99,
      sku: 'COF-001',
      category: 'Beverages',
      stock: 25,
      emoji: '☕',
      lowStockThreshold: 10,
    }),
    Product.fromJSON({
      id: '2',
      name: 'Green Tea',
      price: 8.49,
      sku: 'TEA-001',
      category: 'Beverages',
      stock: 3,
      emoji: '🍵',
      lowStockThreshold: 5,
    }),
    Product.fromJSON({
      id: '3',
      name: 'Chocolate Bar',
      price: 4.99,
      sku: 'CHO-001',
      category: 'Snacks',
      stock: 0,
      emoji: '🍫',
      lowStockThreshold: 10,
    }),
    Product.fromJSON({
      id: '4',
      name: 'Sparkling Water',
      price: 2.49,
      sku: 'WAT-001',
      category: 'Beverages',
      stock: 50,
      emoji: '💧',
      lowStockThreshold: 10,
    }),
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductGridComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductGridComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
  });

  describe('Grid View Display', () => {
    it('should create the component', () => {
      fixture.detectChanges();
      expect(component).toBeTruthy();
    });

    it('should display products in grid view by default', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const cards = el.querySelectorAll('[data-testid="product-card"]');
      expect(cards.length).toBe(4);
    });

    it('should show product name on each card', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const names = el.querySelectorAll('[data-testid="product-name"]');
      expect(names[0].textContent!.trim()).toBe('Organic Coffee');
      expect(names[1].textContent!.trim()).toBe('Green Tea');
    });

    it('should show product price formatted as currency', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const prices = el.querySelectorAll('[data-testid="product-price"]');
      expect(prices[0].textContent!.trim()).toContain('12.99');
    });

    it('should show stock level on each card', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const stocks = el.querySelectorAll('[data-testid="product-stock"]');
      expect(stocks[0].textContent!.trim()).toContain('25');
    });

    it('should show category badge on each card', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const badges = el.querySelectorAll('[data-testid="product-category"]');
      expect(badges[0].textContent!.trim()).toBe('Beverages');
      expect(badges[2].textContent!.trim()).toBe('Snacks');
    });

    it('should display product emoji when available', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const emojis = el.querySelectorAll('[data-testid="product-emoji"]');
      expect(emojis[0].textContent!.trim()).toBe('☕');
    });
  });

  describe('List View Display', () => {
    it('should toggle to list view when view mode is changed', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const listToggle = el.querySelector('[data-testid="view-list"]') as HTMLButtonElement;
      listToggle.click();
      fixture.detectChanges();

      const container = el.querySelector('[data-testid="product-container"]');
      expect(container!.classList.contains('list-view')).toBe(true);
    });

    it('should display products in list format', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const listToggle = el.querySelector('[data-testid="view-list"]') as HTMLButtonElement;
      listToggle.click();
      fixture.detectChanges();

      const container = el.querySelector('[data-testid="product-container"]');
      expect(container!.classList.contains('grid-view')).toBe(false);
      expect(container!.classList.contains('list-view')).toBe(true);
    });

    it('should toggle back to grid view', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      // Switch to list first
      component.setViewMode('list');
      fixture.detectChanges();

      // Switch back to grid
      const gridToggle = el.querySelector('[data-testid="view-grid"]') as HTMLButtonElement;
      gridToggle.click();
      fixture.detectChanges();

      const container = el.querySelector('[data-testid="product-container"]');
      expect(container!.classList.contains('grid-view')).toBe(true);
    });
  });

  describe('Low Stock Indicator', () => {
    it('should show low stock indicator when stock is below threshold', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const cards = el.querySelectorAll('[data-testid="product-card"]');
      // Green Tea has stock 3, threshold 5 → low stock
      expect(cards[1].querySelector('[data-testid="low-stock-badge"]')).toBeTruthy();
    });

    it('should NOT show low stock indicator when stock is above threshold', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const cards = el.querySelectorAll('[data-testid="product-card"]');
      // Organic Coffee has stock 25, threshold 10 → NOT low stock
      expect(cards[0].querySelector('[data-testid="low-stock-badge"]')).toBeFalsy();
    });

    it('should show out-of-stock indicator when stock is 0', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const cards = el.querySelectorAll('[data-testid="product-card"]');
      // Chocolate Bar has stock 0
      expect(cards[2].querySelector('[data-testid="out-of-stock-badge"]')).toBeTruthy();
    });

    it('should visually dim out-of-stock products', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const cards = el.querySelectorAll('[data-testid="product-card"]');
      expect(cards[2].classList.contains('out-of-stock')).toBe(true);
    });
  });

  describe('Product Selection', () => {
    it('should emit productSelected event when a product card is clicked', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const spy = vi.spyOn(component.productSelected, 'emit');
      const cards = el.querySelectorAll('[data-testid="product-card"]');
      (cards[0] as HTMLElement).click();

      expect(spy).toHaveBeenCalledWith(mockProducts[0]);
    });

    it('should NOT emit productSelected for out-of-stock products', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const spy = vi.spyOn(component.productSelected, 'emit');
      const cards = el.querySelectorAll('[data-testid="product-card"]');
      (cards[2] as HTMLElement).click(); // Chocolate Bar is out of stock

      expect(spy).not.toHaveBeenCalled();
    });

    it('should show clickable class on available products', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.detectChanges();

      const cards = el.querySelectorAll('[data-testid="product-card"]');
      expect(cards[0].classList.contains('clickable')).toBe(true);
      expect(cards[2].classList.contains('clickable')).toBe(false); // out of stock
    });
  });

  describe('Empty State', () => {
    it('should show empty state when products array is empty', () => {
      fixture.componentRef.setInput('products', []);
      fixture.detectChanges();

      const emptyState = el.querySelector('[data-testid="empty-results"]');
      expect(emptyState).toBeTruthy();
      expect(emptyState!.textContent).toContain('No products found');
    });

    it('should NOT show product container when products array is empty', () => {
      fixture.componentRef.setInput('products', []);
      fixture.detectChanges();

      const container = el.querySelector('[data-testid="product-container"]');
      expect(container).toBeFalsy();
    });
  });

  describe('Loading State', () => {
    it('should show loading state when isLoading is true', () => {
      fixture.componentRef.setInput('isLoading', true);
      fixture.detectChanges();

      const loading = el.querySelector('[data-testid="loading-results"]');
      expect(loading).toBeTruthy();
    });

    it('should hide loading state when isLoading is false', () => {
      fixture.componentRef.setInput('products', mockProducts);
      fixture.componentRef.setInput('isLoading', false);
      fixture.detectChanges();

      const loading = el.querySelector('[data-testid="loading-results"]');
      expect(loading).toBeFalsy();
    });
  });

  describe('Signal inputs', () => {
    it('reflects the products input', () => {
      fixture.componentRef.setInput('products', mockProducts);
      expect(component.products()).toEqual(mockProducts);
    });

    it('reflects the isLoading input', () => {
      fixture.componentRef.setInput('isLoading', true);
      expect(component.isLoading()).toBe(true);

      fixture.componentRef.setInput('isLoading', false);
      expect(component.isLoading()).toBe(false);
    });
  });
});
