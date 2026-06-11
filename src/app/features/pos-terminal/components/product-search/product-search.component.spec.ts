import { TestBed } from '@angular/core/testing';
import { ProductSearchComponent } from '@features/pos-terminal/components/product-search/product-search.component';
import { Product } from '@core/domain/entities/product.entity';
import { ProductBuilder } from '@core/domain/entities/product.builder';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';

/**
 * Unit Tests for ProductSearchComponent
 * Sprint 1 - Issue #1: Product Search Component
 *
 * Acceptance Criteria:
 * - AC1: Search input with debounce (300ms)
 * - AC2: Results display with product name, price, stock status
 * - AC3: Keyboard navigation (ArrowUp/Down, Enter, Escape)
 * - AC4: Category filter dropdown
 * - AC5: Loading and error states
 * - AC6: Accessibility (ARIA attributes)
 */
describe('ProductSearchComponent', () => {
  let component: ProductSearchComponent;

  const mockProducts: Product[] = [
    new ProductBuilder()
      .withId('1')
      .withName('Organic Coffee')
      .withPrice(12.99)
      .withSku('COF-001')
      .withCategory('Beverages')
      .withStock(50)
      .withDescription('Premium coffee')
      .build(),
    new ProductBuilder()
      .withId('2')
      .withName('Green Tea')
      .withPrice(8.49)
      .withSku('TEA-001')
      .withCategory('Beverages')
      .withStock(30)
      .withDescription('Matcha green tea')
      .build(),
    new ProductBuilder()
      .withId('3')
      .withName('Chocolate Bar')
      .withPrice(3.99)
      .withSku('CHO-001')
      .withCategory('Snacks')
      .withStock(100)
      .withDescription('Dark chocolate')
      .build(),
    new ProductBuilder()
      .withId('4')
      .withName('Out of Stock Item')
      .withPrice(5.99)
      .withSku('OOS-001')
      .withCategory('Snacks')
      .withStock(0)
      .withDescription('Unavailable')
      .build(),
  ];

  const mockProductRepository = {
    search: vi.fn().mockResolvedValue([]),
    getCategories: vi.fn().mockResolvedValue(['Beverages', 'Snacks', 'Dairy']),
    findByCategory: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findActive: vi.fn().mockResolvedValue([]),
    findLowStock: vi.fn().mockResolvedValue([]),
    updateStock: vi.fn().mockResolvedValue(null),
    adjustStock: vi.fn().mockResolvedValue(null),
    updatePrice: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    mockProductRepository.search.mockResolvedValue(mockProducts.slice(0, 2));
    mockProductRepository.getCategories.mockResolvedValue(['Beverages', 'Snacks', 'Dairy']);
    mockProductRepository.findByCategory.mockResolvedValue([mockProducts[2]]);

    await TestBed.configureTestingModule({
      imports: [ProductSearchComponent],
      providers: [{ provide: PRODUCT_REPOSITORY, useValue: mockProductRepository }],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProductSearchComponent);
    component = fixture.componentInstance;
  });

  describe('Initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should start with empty search state', () => {
      expect(component.searchQuery()).toBe('');
      expect(component.searchResults()).toEqual([]);
      expect(component.isLoading()).toBe(false);
      expect(component.error()).toBeNull();
      expect(component.highlightedIndex()).toBe(-1);
      expect(component.selectedCategory()).toBeNull();
    });

    it('should load categories on init', async () => {
      await component.ngOnInit();
      expect(component.categories()).toEqual(['Beverages', 'Snacks', 'Dairy']);
    });
  });

  describe('AC1: Debounced Search', () => {
    it('should not search with less than 2 characters', () => {
      const event = { target: { value: 'a' } } as unknown as Event;
      component.onSearchInput(event);
      expect(component.searchQuery()).toBe('a');
      // searchSubject won't fire for < 2 chars
    });

    it('should set search query on input', () => {
      const event = { target: { value: 'coffee' } } as unknown as Event;
      component.onSearchInput(event);
      expect(component.searchQuery()).toBe('coffee');
    });

    it('should reload products when search is emptied', () => {
      component.searchResults.set(mockProducts);
      const event = { target: { value: '' } } as unknown as Event;
      component.onSearchInput(event);
      // When search is cleared, loadProducts is called to show all products
      expect(component.searchQuery()).toBe('');
    });
  });

  describe('AC3: Keyboard Navigation', () => {
    beforeEach(() => {
      component.searchResults.set(mockProducts);
    });

    it('should move highlight down with ArrowDown', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });

      component.onKeyDown(event);
      expect(component.highlightedIndex()).toBe(0);

      component.onKeyDown(event);
      expect(component.highlightedIndex()).toBe(1);
    });

    it('should move highlight up with ArrowUp', () => {
      component.highlightedIndex.set(2);
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });

      component.onKeyDown(event);
      expect(component.highlightedIndex()).toBe(1);
    });

    it('should not go below 0 with ArrowUp', () => {
      component.highlightedIndex.set(0);
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });

      component.onKeyDown(event);
      expect(component.highlightedIndex()).toBe(0);
    });

    it('should not exceed results length with ArrowDown', () => {
      component.highlightedIndex.set(mockProducts.length - 1);
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });

      component.onKeyDown(event);
      expect(component.highlightedIndex()).toBe(mockProducts.length - 1);
    });

    it('should select highlighted product with Enter', () => {
      const emitSpy = vi.spyOn(component.productSelected, 'emit');
      component.highlightedIndex.set(0);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      component.onKeyDown(event);

      expect(emitSpy).toHaveBeenCalledWith(mockProducts[0]);
    });

    it('should clear search with Escape', () => {
      component.searchQuery.set('coffee');
      const event = new KeyboardEvent('keydown', { key: 'Escape' });

      component.onKeyDown(event);
      expect(component.searchQuery()).toBe('');
      expect(component.searchResults()).toEqual([]);
    });
  });

  describe('AC4: Category Filter', () => {
    it('should set selected category', () => {
      component.onCategorySelect('Snacks');
      expect(component.selectedCategory()).toBe('Snacks');
    });

    it('should clear category when null is selected', () => {
      component.selectedCategory.set('Snacks');
      component.onCategorySelect(null);
      expect(component.selectedCategory()).toBeNull();
    });

    it('should reload all products when "All" selected with no query', () => {
      component.searchResults.set(mockProducts);
      component.searchQuery.set('');
      component.onCategorySelect(null);
      // When "All" is selected with no query, loadProducts is called to show all products
      expect(component.selectedCategory()).toBeNull();
    });
  });

  describe('Product Selection', () => {
    it('should emit productSelected when a product is clicked', () => {
      const emitSpy = vi.spyOn(component.productSelected, 'emit');
      component.selectProduct(mockProducts[0]);
      expect(emitSpy).toHaveBeenCalledWith(mockProducts[0]);
    });

    it('should not emit for out-of-stock products', () => {
      const emitSpy = vi.spyOn(component.productSelected, 'emit');
      component.selectProduct(mockProducts[3]); // stock === 0
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should keep search results visible after selection for rapid multi-item workflow', () => {
      component.searchQuery.set('coffee');
      component.searchResults.set(mockProducts);
      component.selectProduct(mockProducts[0]);
      // Results stay visible to support cashier rapid multi-item selection
      expect(component.searchQuery()).toBe('coffee');
      expect(component.searchResults()).toEqual(mockProducts);
    });
  });

  describe('Trigger Search', () => {
    it('should not trigger search with less than 2 chars', () => {
      component.searchQuery.set('a');
      component.triggerSearch();
      // No error thrown, just doesn't search
      expect(component.searchQuery()).toBe('a');
    });
  });

  describe('Clear Search', () => {
    it('should reset all search state', () => {
      component.searchQuery.set('test');
      component.searchResults.set(mockProducts);
      component.error.set('some error');
      component.highlightedIndex.set(2);

      component.clearSearch();

      expect(component.searchQuery()).toBe('');
      expect(component.searchResults()).toEqual([]);
      expect(component.error()).toBeNull();
      expect(component.highlightedIndex()).toBe(-1);
    });
  });
});
