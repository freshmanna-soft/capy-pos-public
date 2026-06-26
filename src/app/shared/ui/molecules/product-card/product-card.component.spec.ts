import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductCardComponent } from '@shared/ui/molecules/product-card/product-card.component';
import { Product } from '@core/domain/entities/product.entity';

describe('ProductCardComponent (molecule)', () => {
  let component: ProductCardComponent;
  let fixture: ComponentFixture<ProductCardComponent>;
  let el: HTMLElement;

  const makeProduct = (overrides: Record<string, unknown> = {}): Product =>
    Product.fromJSON({
      id: '1',
      name: 'Organic Coffee',
      price: 12.99,
      sku: 'COF-001',
      category: 'Beverages',
      stock: 25,
      emoji: '☕',
      lowStockThreshold: 10,
      ...overrides,
    });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductCardComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
  });

  it('should create the component', () => {
    fixture.componentRef.setInput('product', makeProduct());
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('renders the product name, price, stock, category and emoji', () => {
    fixture.componentRef.setInput('product', makeProduct());
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="product-name"]')!.textContent!.trim()).toBe(
      'Organic Coffee'
    );
    expect(el.querySelector('[data-testid="product-price"]')!.textContent!).toContain('12.99');
    expect(el.querySelector('[data-testid="product-stock"]')!.textContent!).toContain('25');
    expect(el.querySelector('[data-testid="product-category"]')!.textContent!.trim()).toBe(
      'Beverages'
    );
    expect(el.querySelector('[data-testid="product-emoji"]')!.textContent!.trim()).toBe('☕');
  });

  it('omits the emoji element when the product has none', () => {
    fixture.componentRef.setInput('product', makeProduct({ emoji: undefined }));
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="product-emoji"]')).toBeFalsy();
  });

  it('shows the low-stock badge and class when stock is at/below threshold', () => {
    fixture.componentRef.setInput('product', makeProduct({ stock: 3, lowStockThreshold: 5 }));
    fixture.detectChanges();

    const card = el.querySelector('[data-testid="product-card"]')!;
    expect(card.querySelector('[data-testid="low-stock-badge"]')).toBeTruthy();
    expect(card.classList.contains('low-stock')).toBe(true);
    expect(card.classList.contains('out-of-stock')).toBe(false);
  });

  it('shows the out-of-stock badge, dims the card and is not clickable when stock is 0', () => {
    fixture.componentRef.setInput('product', makeProduct({ stock: 0 }));
    fixture.detectChanges();

    const card = el.querySelector('[data-testid="product-card"]')!;
    expect(card.querySelector('[data-testid="out-of-stock-badge"]')).toBeTruthy();
    expect(card.classList.contains('out-of-stock')).toBe(true);
    expect(card.classList.contains('clickable')).toBe(false);
    expect(card.getAttribute('aria-disabled')).toBe('true');
  });

  it('emits selected with the product when an in-stock card is clicked', () => {
    const product = makeProduct();
    fixture.componentRef.setInput('product', product);
    fixture.detectChanges();

    const spy = vi.spyOn(component.selected, 'emit');
    (el.querySelector('[data-testid="product-card"]') as HTMLElement).click();

    expect(spy).toHaveBeenCalledWith(product);
  });

  it('does NOT emit selected when an out-of-stock card is clicked', () => {
    fixture.componentRef.setInput('product', makeProduct({ stock: 0 }));
    fixture.detectChanges();

    const spy = vi.spyOn(component.selected, 'emit');
    (el.querySelector('[data-testid="product-card"]') as HTMLElement).click();

    expect(spy).not.toHaveBeenCalled();
  });

  it('applies the list-view modifier only in list mode', () => {
    fixture.componentRef.setInput('product', makeProduct());
    fixture.componentRef.setInput('view', 'list');
    fixture.detectChanges();

    const card = el.querySelector('[data-testid="product-card"]')!;
    expect(card.classList.contains('list-view')).toBe(true);

    fixture.componentRef.setInput('view', 'grid');
    fixture.detectChanges();
    expect(card.classList.contains('list-view')).toBe(false);
  });
});
