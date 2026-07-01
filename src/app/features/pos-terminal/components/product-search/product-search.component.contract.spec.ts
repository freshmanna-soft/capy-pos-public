import Dexie, { type Table } from 'dexie';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductSearchComponent } from '@features/pos-terminal/components/product-search/product-search.component';
import { DexieProductRepository } from '@core/infrastructure/repositories/dexie-product.repository';
import { DexieDatabase, IProductDB } from '@core/infrastructure/database/dexie-database.service';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';

/**
 * Chaos / contract test gate (#109, postmortem 2026-06-26 — PR #108).
 *
 * The product-load crash happened because every gate only exercised the
 * happy path: components mock the repository with clean data, and e2e runs
 * against clean seed data. A single malformed record (empty `name`, as the
 * capy-pos-demo failure-injection mode returns, or a bad sync writes to
 * IndexedDB) therefore slipped through and took down the *whole* catalog.
 *
 * This test closes that gap at the VIEW seam: it wires the REAL chain
 * (ProductSearchComponent -> ProductService -> DexieProductRepository ->
 * fake-indexeddb) — no repository mock — seeds a collection containing one
 * corrupt record among valid ones, and asserts the view still renders the
 * valid products and does NOT error. It locks in the resilient
 * `BaseDexieRepository.mapRecords` behaviour against regression.
 *
 * Ref: docs/postmortems/2026-06-26-product-load-crash.md
 */

let dbCounter = 0;

/** A Dexie DB exposing only a `products` table with the indexes the repo needs. */
function freshDb(): Dexie & { products: Table<IProductDB, string> } {
  const db = new Dexie(`CapyPOSDB-chaos-${Date.now()}-${++dbCounter}`) as Dexie & {
    products: Table<IProductDB, string>;
  };
  db.version(1).stores({
    products: 'id, sku, barcode, category, isActive, [category+isActive], name, price, deletedAt',
  });
  return db;
}

function record(overrides: Partial<IProductDB> = {}): IProductDB {
  const now = new Date();
  return {
    id: overrides.id ?? `p-${++dbCounter}`,
    name: 'Coffee',
    description: undefined,
    sku: overrides.sku ?? `SKU-${++dbCounter}`,
    barcode: undefined,
    category: 'Beverages',
    price: 4.5,
    cost: 0,
    quantity: 25,
    minStockLevel: 10,
    maxStockLevel: undefined,
    unit: 'unit',
    taxRate: 0.08,
    isActive: true,
    imageUrl: undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: undefined,
    updatedBy: undefined,
    deletedAt: undefined,
    deletedBy: undefined,
    ...overrides,
  };
}

/**
 * Poll until `predicate` is true (or a bounded timeout), yielding to the macrotask
 * queue between checks so the async ngOnInit chain (getCategories -> loadProducts,
 * incl. the fake-indexeddb query) can settle. Condition-based rather than a fixed
 * tick count, so it is deterministic under slow CI timing.
 */
async function waitUntil(
  predicate: () => boolean,
  { tries = 100, stepMs = 5 } = {}
): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

describe('ProductSearchComponent — malformed-record contract gate (#109)', () => {
  let db: Dexie & { products: Table<IProductDB, string> };
  let fixture: ComponentFixture<ProductSearchComponent>;
  let component: ProductSearchComponent;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    db = freshDb();
    // One corrupt record (empty required `name`) between two valid ones.
    await db.products.bulkAdd([
      record({ id: '1', name: 'Coffee', sku: 'SKU-1' }),
      record({ id: '2', name: '', sku: 'SKU-2' }), // corrupt → must be skipped, not crash the view
      record({ id: '3', name: 'Tea', sku: 'SKU-3' }),
    ]);

    // Silence (and observe) the resilience warnings; also keeps the worker
    // teardown clean (see #112).
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [ProductSearchComponent],
      providers: [
        { provide: DexieDatabase, useValue: db as unknown as DexieDatabase },
        DexieProductRepository,
        { provide: PRODUCT_REPOSITORY, useExisting: DexieProductRepository },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductSearchComponent);
    component = fixture.componentInstance;
  });

  afterEach(async () => {
    fixture.destroy();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    await db.delete();
  });

  it('renders the valid products and skips the corrupt one without erroring', async () => {
    // Only errors from THIS component's own load path should count. Clearing here
    // discards any console.error incidentally captured before the action (defence
    // in depth alongside the global afterEach async drain in vitest.setup.ts).
    errorSpy.mockClear();
    // detectChanges triggers ngOnInit, which loads categories then products.
    expect(() => fixture.detectChanges()).not.toThrow();
    // Wait for the async load to actually SETTLE rather than a fixed number of
    // ticks — the fixed-tick flush was itself flaky under CI's slower IndexedDB
    // timing (searchResults still empty when asserted). Poll, bounded, until the
    // load finishes (results in, or an error surfaced), re-running CD each tick.
    await waitUntil(() => {
      fixture.detectChanges();
      return (
        !component.isLoading() && (component.searchResults().length > 0 || !!component.error())
      );
    });

    // The valid records render; the corrupt one is dropped — not the whole list.
    expect(
      component
        .searchResults()
        .map((p) => p.id)
        .sort()
    ).toEqual(['1', '3']);
    // The view did not fall into an error state.
    expect(component.error()).toBeNull();
    expect(component.isLoading()).toBe(false);
    // The skip was observable (warning emitted), proving the data really was corrupt.
    expect(warnSpy).toHaveBeenCalled();
    // loadProducts swallows nothing into console.error on this resilient path.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('paints the valid products into the DOM and shows no error message', async () => {
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    // Wait until the DOM actually paints the loaded rows (or an error banner),
    // rather than a fixed tick count — deterministic under slow CI timing.
    await waitUntil(() => {
      fixture.detectChanges();
      return (
        host.querySelectorAll('[data-testid="product-result"]').length >= 2 ||
        !!host.querySelector('[data-testid="error-message"]')
      );
    });

    const results = host.querySelectorAll('[data-testid="product-result"]');
    expect(results.length).toBe(2);

    const text = host.textContent ?? '';
    expect(text).toContain('Coffee');
    expect(text).toContain('Tea');

    // No error banner — a single bad row must not surface as a view-level failure.
    expect(host.querySelector('[data-testid="error-message"]')).toBeNull();
  });
});

// Made with Bob
