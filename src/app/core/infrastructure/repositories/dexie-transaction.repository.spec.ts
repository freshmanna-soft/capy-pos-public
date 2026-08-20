import Dexie, { type Table } from 'dexie';
import { TestBed } from '@angular/core/testing';
import { DexieTransactionRepository } from './dexie-transaction.repository';
import {
  DexieDatabase,
  ITransactionDB,
} from '@core/infrastructure/database/dexie-database.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import {
  ITransactionItem,
  TransactionStatus,
  TransactionType,
} from '@core/domain/entities/transaction.entity';

/**
 * Unit tests for DexieTransactionRepository against a real Dexie table backed
 * by fake-indexeddb (wired globally in vitest.setup.ts).
 *
 * The headline case is resilience. Transaction was the last repository still
 * mapping list results raw (`records.map((r) => this.mapToEntity(r))`) instead
 * of going through the resilient `BaseDexieRepository.mapRecords`, so a single
 * corrupt row would throw and take down transaction history, the receipt
 * lookup and every sales report at once — the same all-or-nothing seam that
 * caused the product-load outage (postmortem 2026-06-26 / PR #108) and that
 * product, customer and payment were already hardened against.
 *
 * Two distinct corruption modes are covered, because they fail in different
 * places:
 *   1. `items` is not valid JSON  → `JSON.parse` throws inside `mapToEntity`,
 *      and ALSO inside `getTopProducts` and the `findByProduct` filter
 *      predicate, which read the column outside any mapping.
 *   2. `items` is valid JSON but the entity rejects it (`[]` → "Transaction
 *      must have at least one item") → the builder throws inside `mapToEntity`.
 *
 * This closes the negative-path coverage floor tracked by #110 for the
 * transaction repo, the last of the four Dexie repositories.
 *
 * Ref: docs/postmortems/2026-06-26-product-load-crash.md
 */

let dbCounter = 0;

/** A Dexie DB exposing only a `transactions` table with the repo's indexes. */
function freshDb(): Dexie & { transactions: Table<ITransactionDB, string> } {
  const db = new Dexie(`CapyPOSDB-txrepo-${Date.now()}-${++dbCounter}`) as Dexie & {
    transactions: Table<ITransactionDB, string>;
  };
  db.version(1).stores({
    transactions: 'id, customerId, status, type, createdAt, completedAt, cancelledAt, deletedAt',
  });
  return db;
}

function item(overrides: Partial<ITransactionItem> = {}): ITransactionItem {
  return {
    productId: 'prod-1',
    productName: 'Coffee',
    quantity: 1,
    unitPrice: 10,
    subtotal: 10,
    ...overrides,
  };
}

const DEFAULT_DATE = new Date('2026-06-15T12:00:00Z');

function record(overrides: Partial<ITransactionDB> = {}): ITransactionDB {
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: overrides.id ?? `tx-${suffix}`,
    customerId: 'cust-A',
    items: JSON.stringify([item()]),
    subtotal: 10,
    taxRate: 0.1,
    taxAmount: 1,
    discountAmount: 0,
    total: 11,
    status: TransactionStatus.COMPLETED,
    type: TransactionType.SALE,
    refundedAmount: 0,
    paymentIds: JSON.stringify([]),
    createdAt: DEFAULT_DATE,
    updatedAt: DEFAULT_DATE,
    ...overrides,
  };
}

const RANGE_START = new Date('2026-06-01T00:00:00Z');
const RANGE_END = new Date('2026-06-30T00:00:00Z');

describe('DexieTransactionRepository (real Dexie + fake-indexeddb)', () => {
  let db: Dexie & { transactions: Table<ITransactionDB, string> };
  let repo: DexieTransactionRepository;
  let telemetry: { recordCounter: ReturnType<typeof vi.fn> };
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = freshDb();
    telemetry = { recordCounter: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        DexieTransactionRepository,
        { provide: DexieDatabase, useValue: db as unknown as DexieDatabase },
        // Stub telemetry so the repo's skipped-records counter (#111) has a sink
        // without spinning up the real service's system-monitoring interval.
        { provide: TelemetryService, useValue: telemetry as unknown as TelemetryService },
      ],
    });
    repo = TestBed.inject(DexieTransactionRepository);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await db.delete();
  });

  describe('resilient list mapping (#110)', () => {
    // Two corrupt records — one unparseable, one entity-invalid — sitting
    // between two valid ones. All four share the queryable fields (customerId,
    // status, type, createdAt) so every list query returns them and therefore
    // exercises the resilient skip on each.
    beforeEach(async () => {
      await db.transactions.bulkAdd([
        record({ id: '1' }),
        record({ id: 'bad-json', items: 'not-json-at-all', receiptNumber: 'R-BAD' }),
        record({ id: 'bad-entity', items: JSON.stringify([]) }),
        record({ id: '2' }),
      ]);
    });

    it('findByCustomerId skips both corrupt records and returns the valid ones', async () => {
      const result = await repo.findByCustomerId('cust-A');
      expect(result.map((t) => t.id).sort()).toEqual(['1', '2']);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('findByStatus skips both corrupt records', async () => {
      const result = await repo.findByStatus(TransactionStatus.COMPLETED);
      expect(result.map((t) => t.id).sort()).toEqual(['1', '2']);
    });

    it('findByType skips both corrupt records', async () => {
      const result = await repo.findByType(TransactionType.SALE);
      expect(result.map((t) => t.id).sort()).toEqual(['1', '2']);
    });

    it('findByDateRange skips both corrupt records', async () => {
      const result = await repo.findByDateRange(RANGE_START, RANGE_END);
      expect(result.map((t) => t.id).sort()).toEqual(['1', '2']);
    });

    it('findCompleted skips both corrupt records', async () => {
      const result = await repo.findCompleted();
      expect(result.map((t) => t.id).sort()).toEqual(['1', '2']);
    });

    it('findByProduct skips both corrupt records without throwing in the filter', async () => {
      // The unparseable row would previously throw inside the Dexie filter
      // predicate itself, before any mapping ran.
      const result = await repo.findByProduct('prod-1');
      expect(result.map((t) => t.id).sort()).toEqual(['1', '2']);
    });

    it('does not throw and returns only valid transactions (no total-list outage)', async () => {
      await expect(repo.findByStatus(TransactionStatus.COMPLETED)).resolves.toHaveLength(2);
    });

    it('emits the skipped-records telemetry counter tagged as "transaction" (#111)', async () => {
      await repo.findByStatus(TransactionStatus.COMPLETED);
      expect(telemetry.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        2,
        expect.objectContaining({ entity: 'transaction' })
      );
    });

    it('getTopProducts ignores the unparseable record instead of aborting the report', async () => {
      const top = await repo.getTopProducts(RANGE_START, RANGE_END, 10);
      // Only the two valid rows contribute; 'bad-entity' still has parseable
      // (empty) items so it adds nothing, and 'bad-json' is skipped.
      expect(top).toHaveLength(1);
      expect(top[0]).toMatchObject({ productId: 'prod-1', quantitySold: 2, revenue: 20 });
    });

    it('getTotalSales still sums every stored row (it never maps entities)', async () => {
      // Aggregates read raw columns, so corrupt rows are counted here by design;
      // the point of this test is that they do not throw.
      await expect(repo.getTotalSales(RANGE_START, RANGE_END)).resolves.toBe(44);
    });

    it('findByReceiptNumber keeps throwing on a directly requested bad record', async () => {
      // Documented convention in BaseDexieRepository.mapRecords: single-record
      // getters surface the error rather than silently returning null.
      await expect(repo.findByReceiptNumber('R-BAD')).rejects.toThrow();
    });
  });

  describe('queries', () => {
    beforeEach(async () => {
      await db.transactions.bulkAdd([
        record({
          id: 't-sale',
          customerId: 'cust-1',
          status: TransactionStatus.COMPLETED,
          type: TransactionType.SALE,
          total: 100,
          receiptNumber: 'R-001',
          items: JSON.stringify([item({ productId: 'p-a', productName: 'Latte', subtotal: 100 })]),
        }),
        record({
          id: 't-pending',
          customerId: 'cust-1',
          status: TransactionStatus.PENDING,
          type: TransactionType.SALE,
          total: 50,
        }),
        record({
          id: 't-return',
          customerId: 'cust-2',
          status: TransactionStatus.COMPLETED,
          type: TransactionType.RETURN,
          total: 20,
        }),
        record({
          id: 't-deleted',
          customerId: 'cust-1',
          status: TransactionStatus.COMPLETED,
          type: TransactionType.SALE,
          total: 999,
          deletedAt: DEFAULT_DATE,
        }),
      ]);
    });

    it('excludes soft-deleted rows from every list query', async () => {
      expect((await repo.findByCustomerId('cust-1')).map((t) => t.id).sort()).toEqual([
        't-pending',
        't-sale',
      ]);
      expect(
        (await repo.findByStatus(TransactionStatus.COMPLETED)).map((t) => t.id).sort()
      ).toEqual(['t-return', 't-sale']);
      expect((await repo.findByType(TransactionType.SALE)).map((t) => t.id).sort()).toEqual([
        't-pending',
        't-sale',
      ]);
    });

    it('findPending returns only pending transactions', async () => {
      expect((await repo.findPending()).map((t) => t.id)).toEqual(['t-pending']);
    });

    it('findCompleted honours the limit argument', async () => {
      expect(await repo.findCompleted(1)).toHaveLength(1);
      expect(await repo.findCompleted()).toHaveLength(2);
    });

    it('findByReceiptNumber returns the match, and null when absent', async () => {
      expect((await repo.findByReceiptNumber('R-001'))?.id).toBe('t-sale');
      expect(await repo.findByReceiptNumber('R-nope')).toBeNull();
    });

    it('findByProduct matches on line items and honours the date range', async () => {
      expect((await repo.findByProduct('p-a')).map((t) => t.id)).toEqual(['t-sale']);
      expect(await repo.findByProduct('p-missing')).toEqual([]);
      expect(await repo.findByProduct('p-a', RANGE_START, RANGE_END)).toHaveLength(1);
      expect(
        await repo.findByProduct(
          'p-a',
          new Date('2020-01-01T00:00:00Z'),
          new Date('2020-12-31T00:00:00Z')
        )
      ).toHaveLength(0);
    });

    it('mapToEntity round-trips the optional columns it is given', async () => {
      await db.transactions.add(
        record({
          id: 't-full',
          customerId: 'cust-9',
          createdBy: 'alice',
          updatedBy: 'bob',
          completedAt: DEFAULT_DATE,
          cancelledAt: DEFAULT_DATE,
          cancellationReason: 'changed mind',
          receiptNumber: 'R-FULL',
          notes: 'gift wrapped',
          paymentIds: JSON.stringify(['pay-1', 'pay-2']),
          status: TransactionStatus.CANCELLED,
        })
      );
      const found = await repo.findByReceiptNumber('R-FULL');
      expect(found).toMatchObject({
        id: 't-full',
        customerId: 'cust-9',
        createdBy: 'alice',
        updatedBy: 'bob',
        cancellationReason: 'changed mind',
        receiptNumber: 'R-FULL',
        notes: 'gift wrapped',
      });
      expect(found?.paymentIds).toEqual(['pay-1', 'pay-2']);
    });
  });

  describe('analytics', () => {
    beforeEach(async () => {
      await db.transactions.bulkAdd([
        record({
          id: 'a-1',
          total: 100,
          // Local-time fixtures: getSalesByHour brackets the day with
          // setHours(0,0,0,0) and buckets by getHours(), both local, so UTC
          // literals here would fall outside the window in any non-UTC zone.
          createdAt: new Date(2026, 5, 10, 9, 30),
          items: JSON.stringify([
            item({ productId: 'p-a', productName: 'Latte', quantity: 2, subtotal: 60 }),
            item({ productId: 'p-b', productName: 'Bagel', quantity: 1, subtotal: 40 }),
          ]),
        }),
        record({
          id: 'a-2',
          total: 200,
          createdAt: new Date(2026, 5, 10, 14, 0),
          items: JSON.stringify([
            item({ productId: 'p-a', productName: 'Latte', quantity: 3, subtotal: 200 }),
          ]),
        }),
        // Not a completed SALE: must be excluded from sales aggregates.
        record({ id: 'a-pending', total: 500, status: TransactionStatus.PENDING }),
      ]);
    });

    it('getTotalSales sums only completed sales', async () => {
      expect(await repo.getTotalSales(RANGE_START, RANGE_END)).toBe(300);
    });

    it('getTransactionCount counts every non-deleted row in range', async () => {
      expect(await repo.getTransactionCount(RANGE_START, RANGE_END)).toBe(3);
    });

    it('getAverageTransactionValue averages completed sales, and is 0 when there are none', async () => {
      expect(await repo.getAverageTransactionValue(RANGE_START, RANGE_END)).toBe(150);
      expect(
        await repo.getAverageTransactionValue(
          new Date('2020-01-01T00:00:00Z'),
          new Date('2020-12-31T00:00:00Z')
        )
      ).toBe(0);
    });

    it('getTopProducts aggregates by revenue and honours the limit', async () => {
      const top = await repo.getTopProducts(RANGE_START, RANGE_END, 10);
      expect(top).toEqual([
        {
          productId: 'p-a',
          productName: 'Latte',
          quantitySold: 5,
          revenue: 260,
          transactionCount: 2,
        },
        {
          productId: 'p-b',
          productName: 'Bagel',
          quantitySold: 1,
          revenue: 40,
          transactionCount: 1,
        },
      ]);
      expect(await repo.getTopProducts(RANGE_START, RANGE_END, 1)).toHaveLength(1);
    });

    it('getSalesByHour returns all 24 hours with sales bucketed by local hour', async () => {
      const hours = await repo.getSalesByHour(new Date(2026, 5, 10));
      expect(hours).toHaveLength(24);
      expect(hours.reduce((sum, h) => sum + h.sales, 0)).toBe(300);
      expect(hours.reduce((sum, h) => sum + h.transactions, 0)).toBe(2);
      const busiest = hours.filter((h) => h.transactions > 0).map((h) => h.hour);
      expect(busiest).toEqual([9, 14]);
    });

    it('getRefundStats reports totals, count and rate against completed sales', async () => {
      await db.transactions.bulkAdd([
        record({
          id: 'r-1',
          status: TransactionStatus.REFUNDED,
          total: 100,
          refundedAmount: 100,
        }),
        record({
          id: 'r-2',
          status: TransactionStatus.PARTIALLY_REFUNDED,
          total: 100,
          refundedAmount: 25,
        }),
      ]);
      const stats = await repo.getRefundStats(RANGE_START, RANGE_END);
      expect(stats.totalRefunds).toBe(125);
      expect(stats.refundCount).toBe(2);
      // 2 refunds over the 2 completed sales (a-1, a-2).
      expect(stats.refundRate).toBe(1);
    });

    it('getRefundStats reports a 0 rate when there are no completed sales', async () => {
      const stats = await repo.getRefundStats(
        new Date('2020-01-01T00:00:00Z'),
        new Date('2020-12-31T00:00:00Z')
      );
      expect(stats).toEqual({ totalRefunds: 0, refundCount: 0, refundRate: 0 });
    });
  });

  describe('mutations', () => {
    beforeEach(async () => {
      await db.transactions.add(record({ id: 'm-1', status: TransactionStatus.PENDING }));
    });

    it('updateStatus persists the new status and stamps updatedBy', async () => {
      const updated = await repo.updateStatus('m-1', TransactionStatus.PROCESSING, 'alice');
      expect(updated.status).toBe(TransactionStatus.PROCESSING);
      expect(updated.updatedBy).toBe('alice');

      const reloaded = await repo.findById('m-1');
      expect(reloaded?.status).toBe(TransactionStatus.PROCESSING);
    });

    it('updateStatus carries the optional fields across the rebuild', async () => {
      // Seeded in one `add`: Dexie's partial `Table.update()` degrades Date
      // columns to plain objects under fake-indexeddb, which would make
      // `createdAt` an Invalid Date here for reasons unrelated to the repo.
      // Production never takes that path — BaseDexieRepository.update() puts a
      // whole mapped record.
      await db.transactions.add(
        record({
          id: 'm-2',
          status: TransactionStatus.PENDING,
          customerId: 'cust-7',
          createdBy: 'alice',
          completedAt: DEFAULT_DATE,
          cancelledAt: DEFAULT_DATE,
          cancellationReason: 'oops',
          receiptNumber: 'R-M1',
          notes: 'keep me',
        })
      );
      const updated = await repo.updateStatus('m-2', TransactionStatus.CANCELLED);
      expect(updated).toMatchObject({
        customerId: 'cust-7',
        createdBy: 'alice',
        cancellationReason: 'oops',
        receiptNumber: 'R-M1',
        notes: 'keep me',
      });
    });

    it('updateStatus throws when the transaction does not exist', async () => {
      await expect(repo.updateStatus('nope', TransactionStatus.COMPLETED)).rejects.toThrow(
        'Transaction with id nope not found'
      );
    });

    it('addPayment appends the payment id', async () => {
      const updated = await repo.addPayment('m-1', 'pay-99', 'alice');
      expect(updated.paymentIds).toContain('pay-99');

      const reloaded = await repo.findById('m-1');
      expect(reloaded?.paymentIds).toContain('pay-99');
    });

    it('addPayment throws when the transaction does not exist', async () => {
      await expect(repo.addPayment('nope', 'pay-1')).rejects.toThrow(
        'Transaction with id nope not found'
      );
    });
  });
});

// Made with Bob
