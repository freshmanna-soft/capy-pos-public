import Dexie, { type Table } from 'dexie';
import { TestBed } from '@angular/core/testing';
import { DexieProductRepository } from './dexie-product.repository';
import { DexieDatabase, IProductDB } from '@core/infrastructure/database/dexie-database.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import { Product } from '@core/domain/entities/product.entity';

/**
 * Unit tests for DexieProductRepository against a real Dexie table backed by
 * fake-indexeddb (wired globally in vitest.setup.ts).
 *
 * The headline case is resilience: a single corrupt record (empty required
 * `name`, as produced by the capy-pos-demo failure-injection mode or a bad
 * sync) must be SKIPPED on list loads, not crash the whole catalog — the
 * regression behind PR #108.
 */

let dbCounter = 0;

/** A Dexie DB exposing only a `products` table with the indexes the repo needs. */
function freshDb(): Dexie & { products: Table<IProductDB, string> } {
  const db = new Dexie(`CapyPOSDB-prodrepo-${Date.now()}-${++dbCounter}`) as Dexie & {
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
    id: overrides.id ?? `p-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Coffee',
    description: undefined,
    sku: overrides.sku ?? `SKU-${Math.random().toString(36).slice(2, 8)}`,
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

describe('DexieProductRepository (real Dexie + fake-indexeddb)', () => {
  let db: Dexie & { products: Table<IProductDB, string> };
  let repo: DexieProductRepository;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = freshDb();
    TestBed.configureTestingModule({
      providers: [
        DexieProductRepository,
        { provide: DexieDatabase, useValue: db as unknown as DexieDatabase },
        // Stub telemetry so the repo's skipped-records counter (#111) has a sink
        // without spinning up the real service's system-monitoring interval.
        {
          provide: TelemetryService,
          useValue: { recordCounter: vi.fn() } as unknown as TelemetryService,
        },
      ],
    });
    repo = TestBed.inject(DexieProductRepository);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await db.delete();
  });

  describe('resilient list mapping (#108)', () => {
    beforeEach(async () => {
      await db.products.bulkAdd([
        record({ id: '1', name: 'Coffee', sku: 'SKU-1' }),
        record({ id: '2', name: '', sku: 'SKU-2' }), // corrupt → must be skipped
        record({ id: '3', name: 'Tea', sku: 'SKU-3' }),
      ]);
    });

    it('findActive skips the corrupt record and returns the valid ones', async () => {
      const result = await repo.findActive();
      expect(result.map((p) => p.id).sort()).toEqual(['1', '3']);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('search skips the corrupt record', async () => {
      // Empty query matches everything; the empty-name record is still skipped.
      const result = await repo.search('');
      expect(result.map((p) => p.id).sort()).toEqual(['1', '3']);
    });

    it('findLowStock skips the corrupt record', async () => {
      await db.products.update('1', { quantity: 2 });
      await db.products.update('2', { quantity: 1 });
      const result = await repo.findLowStock();
      expect(result.map((p) => p.id)).toEqual(['1']);
    });

    it('findAll skips the corrupt record', async () => {
      const result = await repo.findAll();
      expect(result.map((p) => p.id).sort()).toEqual(['1', '3']);
    });
  });

  describe('queries', () => {
    beforeEach(async () => {
      await db.products.bulkAdd([
        record({ id: '1', name: 'Coffee', sku: 'SKU-1', barcode: 'BC-1', category: 'Beverages' }),
        record({ id: '2', name: 'Croissant', sku: 'SKU-2', category: 'Bakery', price: 3 }),
        record({ id: '3', name: 'Tea', sku: 'SKU-3', category: 'Beverages', price: 2 }),
      ]);
    });

    it('findByCategory returns only that category', async () => {
      const result = await repo.findByCategory('Beverages');
      expect(result.map((p) => p.id).sort()).toEqual(['1', '3']);
    });

    it('search matches by name, sku and barcode', async () => {
      expect((await repo.search('coff')).map((p) => p.id)).toEqual(['1']);
      expect((await repo.search('SKU-3')).map((p) => p.id)).toEqual(['3']);
      expect((await repo.search('BC-1')).map((p) => p.id)).toEqual(['1']);
    });

    it('findBySKU and findByBarcode return a single entity or null', async () => {
      expect((await repo.findBySKU('SKU-2'))?.id).toBe('2');
      expect(await repo.findBySKU('nope')).toBeNull();
      expect((await repo.findByBarcode('BC-1'))?.id).toBe('1');
    });

    it('getCategories returns sorted distinct categories', async () => {
      expect(await repo.getCategories()).toEqual(['Bakery', 'Beverages']);
    });

    it('countByCategory counts within a category', async () => {
      expect(await repo.countByCategory('Beverages')).toBe(2);
    });

    it('findSortedByName / findSortedByPrice sort correctly', async () => {
      expect((await repo.findSortedByName('asc')).map((p) => p.name)).toEqual([
        'Coffee',
        'Croissant',
        'Tea',
      ]);
      expect((await repo.findSortedByPrice('desc')).map((p) => p.id)).toEqual(['1', '2', '3']);
    });

    it('getTopSelling returns up to the limit', async () => {
      expect((await repo.getTopSelling(2)).length).toBe(2);
    });

    it('findById returns the entity or null', async () => {
      expect((await repo.findById('1'))?.name).toBe('Coffee');
      expect(await repo.findById('missing')).toBeNull();
    });
  });

  describe('mutations', () => {
    beforeEach(async () => {
      await db.products.add(record({ id: '1', name: 'Coffee', sku: 'SKU-1', quantity: 10 }));
    });

    it('create round-trips a Product entity through mapToDatabase', async () => {
      const product = Product.fromJSON({
        id: '9',
        name: 'Latte',
        price: 5,
        sku: 'SKU-9',
        category: 'Beverages',
        stock: 7,
      });
      await repo.create(product);
      const stored = await db.products.get('9');
      expect(stored?.name).toBe('Latte');
      expect(stored?.quantity).toBe(7); // stock → quantity mapping
    });

    it('updateStock sets the absolute quantity', async () => {
      const updated = await repo.updateStock('1', 30);
      expect(updated.stock).toBe(30);
      expect((await db.products.get('1'))?.quantity).toBe(30);
    });

    it('adjustStock adds/subtracts', async () => {
      const updated = await repo.adjustStock('1', -4);
      expect(updated.stock).toBe(6);
    });

    it('updatePrice updates price (and optional cost)', async () => {
      const updated = await repo.updatePrice('1', 9.99, 4);
      expect(updated.price).toBe(9.99);
      expect((await db.products.get('1'))?.cost).toBe(4);
    });

    it('updateStock/adjustStock/updatePrice throw for a missing product', async () => {
      await expect(repo.updateStock('x', 1)).rejects.toThrow();
      await expect(repo.adjustStock('x', 1)).rejects.toThrow();
      await expect(repo.updatePrice('x', 1)).rejects.toThrow();
    });

    it('exists / count / delete behave', async () => {
      expect(await repo.exists('1')).toBe(true);
      expect(await repo.count()).toBe(1);
      await repo.delete('1');
      expect(await repo.exists('1')).toBe(false); // soft-deleted
    });
  });

  describe('columns that are only sometimes there', () => {
    it('carries every optional column back onto the entity', async () => {
      // Each of these is written by a different path — a sync, an import, an edit —
      // and a mapper that quietly drops one loses it on the next save.
      await db.products.add(
        record({
          id: 'full',
          description: 'Single origin',
          imageUrl: 'https://example.test/coffee.png',
          barcode: '4006381333931',
          createdBy: 'u1',
          updatedBy: 'u2',
        })
      );

      const found = await repo.findById('full');

      expect(found).not.toBeNull();
      expect(found!.description).toBe('Single origin');
      expect(found!.imageUrl).toBe('https://example.test/coffee.png');
      expect(found!.barcode).toBe('4006381333931');
      expect(found!.createdBy).toBe('u1');
      expect(found!.updatedBy).toBe('u2');
    });

    it('maps the deletion columns too, though no query returns a deleted row', async () => {
      // Every read path filters `deletedAt`, so the mapper is exercised directly:
      // the columns still have to survive a round trip, because the day a query
      // stops filtering — an audit view, an undelete — is not the day to find out
      // they were being dropped.
      const stamp = new Date('2026-01-02T03:04:05.000Z');
      const mapped = (repo as unknown as { mapToEntity: (row: IProductDB) => Product }).mapToEntity(
        record({ id: 'gone', deletedAt: stamp, deletedBy: 'u3' })
      );

      expect(mapped.deletedAt).toEqual(stamp);
      expect(mapped.deletedBy).toBe('u3');
    });

    it('treats a legacy numeric isActive as active', async () => {
      // Rows synced from the API arrive with 1 rather than true, and a strict
      // comparison would hide the whole remote catalogue from the till.
      await db.products.bulkAdd([
        record({ id: 'legacy', name: 'Legacy', isActive: 1 as unknown as boolean }),
        record({ id: 'modern', name: 'Modern', isActive: true }),
      ]);

      const active = await repo.findActive();

      expect(active.map((product) => product.id).sort()).toEqual(['legacy', 'modern']);
    });

    it('keeps soft-deleted products out of the low-stock list', async () => {
      // Reordering something that was deleted is how phantom stock gets bought.
      await db.products.bulkAdd([
        record({ id: 'gone', name: 'Gone', quantity: 1, deletedAt: new Date() }),
        record({ id: 'low', name: 'Low', quantity: 2 }),
      ]);

      const low = await repo.findLowStock();

      expect(low.map((product) => product.id)).toEqual(['low']);
    });

    it('searches a product with no barcode without tripping over it', async () => {
      await db.products.add(record({ id: 'nobar', name: 'Nobar', barcode: undefined }));

      await expect(repo.search('nobar')).resolves.toHaveLength(1);
    });

    it('searches past a product with no sku instead of failing the whole search', async () => {
      // The search predicate runs on the RAW record, before mapRecords' per-record
      // try/catch (#110) can contain a bad row — so an unguarded `record.sku`
      // took down the cashier's entire search instead of dropping one product.
      await db.products.bulkAdd([
        record({ id: 'nosku', name: 'Nosku', sku: undefined as unknown as string }),
        record({ id: 'healthy', name: 'Nosku Deluxe' }),
      ]);

      const results = await repo.search('nosku');

      // The malformed row is still skipped at mapping time (SKU is required on the
      // entity), but the healthy match reaches the till.
      expect(results.map((product) => product.id)).toEqual(['healthy']);
    });

    it('matches a null sku against name and barcode without throwing', async () => {
      // A null (not merely absent) sku is what a bad sync payload actually writes.
      await db.products.add(
        record({
          id: 'nullsku',
          name: 'Nullsku',
          sku: null as unknown as string,
          barcode: '555',
        })
      );

      await expect(repo.search('555')).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('leaves cost alone when only the price was changed', async () => {
      await db.products.add(record({ id: 'priced', price: 4.5, cost: 2 }));

      await repo.updatePrice('priced', 6);

      const row = await db.products.get('priced');
      expect(row!.price).toBe(6);
      // Not zeroed, and not overwritten with undefined: the margin report reads this.
      expect(row!.cost).toBe(2);
    });
  });
});
