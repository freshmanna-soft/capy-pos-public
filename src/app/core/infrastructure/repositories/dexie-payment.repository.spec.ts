import Dexie, { type Table } from 'dexie';
import { TestBed } from '@angular/core/testing';
import { DexiePaymentRepository } from './dexie-payment.repository';
import { DexieDatabase, IPaymentDB } from '@core/infrastructure/database/dexie-database.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import { PaymentMethod, PaymentStatus } from '@core/domain/entities/payment.entity';

/**
 * Unit tests for DexiePaymentRepository against a real Dexie table backed by
 * fake-indexeddb (wired globally in vitest.setup.ts).
 *
 * The headline case is resilience: a single corrupt record (e.g. an amount of
 * 0, which the Payment entity rejects — as a bad sync or the capy-pos-demo
 * failure-injection mode could produce) must be SKIPPED on list loads, not
 * crash the whole payment list. Before #110 the payment list methods mapped
 * records raw (`records.map((r) => this.mapToDomain(r))`) and would throw on
 * the first bad record — the exact all-or-nothing seam that caused the
 * product-load outage (postmortem 2026-06-26 / PR #108). This closes the
 * negative-path coverage floor tracked by #110 for the payment repo.
 *
 * Ref: docs/postmortems/2026-06-26-product-load-crash.md
 */

let dbCounter = 0;

/** A Dexie DB exposing only a `payments` table with the indexes the repo needs. */
function freshDb(): Dexie & { payments: Table<IPaymentDB, string> } {
  const db = new Dexie(`CapyPOSDB-payrepo-${Date.now()}-${++dbCounter}`) as Dexie & {
    payments: Table<IPaymentDB, string>;
  };
  db.version(1).stores({
    payments: 'id, orderId, method, status, createdAt, completedAt',
  });
  return db;
}

function record(overrides: Partial<IPaymentDB> = {}): IPaymentDB {
  const now = new Date('2026-06-15T12:00:00Z');
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: overrides.id ?? `pay-${suffix}`,
    orderId: overrides.orderId ?? `order-${suffix}`,
    amount: 50,
    method: PaymentMethod.CASH,
    status: PaymentStatus.COMPLETED,
    currency: 'USD',
    refundedAmount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('DexiePaymentRepository (real Dexie + fake-indexeddb)', () => {
  let db: Dexie & { payments: Table<IPaymentDB, string> };
  let repo: DexiePaymentRepository;
  let telemetry: { recordCounter: ReturnType<typeof vi.fn> };
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = freshDb();
    telemetry = { recordCounter: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        DexiePaymentRepository,
        { provide: DexieDatabase, useValue: db as unknown as DexieDatabase },
        // Stub telemetry so the repo's skipped-records counter (#111) has a sink
        // without spinning up the real service's system-monitoring interval.
        { provide: TelemetryService, useValue: telemetry as unknown as TelemetryService },
      ],
    });
    repo = TestBed.inject(DexiePaymentRepository);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await db.delete();
  });

  describe('resilient list mapping (#110)', () => {
    // One corrupt record (amount 0 — the Payment entity requires amount > 0)
    // sitting between two valid ones. It shares the queryable fields (status,
    // method, orderId, createdAt) so it is returned by every list query and
    // therefore exercises the resilient skip on each of them.
    beforeEach(async () => {
      await db.payments.bulkAdd([
        record({ id: '1', orderId: 'order-A', amount: 50 }),
        record({ id: '2', orderId: 'order-A', amount: 0 }), // corrupt → must be skipped
        record({ id: '3', orderId: 'order-A', amount: 30 }),
      ]);
    });

    it('findByStatus skips the corrupt record and returns the valid ones', async () => {
      const result = await repo.findByStatus(PaymentStatus.COMPLETED);
      expect(result.map((p) => p.id).sort()).toEqual(['1', '3']);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('findByMethod skips the corrupt record', async () => {
      const result = await repo.findByMethod(PaymentMethod.CASH);
      expect(result.map((p) => p.id).sort()).toEqual(['1', '3']);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('findByTransactionId skips the corrupt record', async () => {
      const result = await repo.findByTransactionId('order-A');
      expect(result.map((p) => p.id).sort()).toEqual(['1', '3']);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('findByDateRange skips the corrupt record', async () => {
      const result = await repo.findByDateRange(
        new Date('2026-06-01T00:00:00Z'),
        new Date('2026-06-30T00:00:00Z')
      );
      expect(result.map((p) => p.id).sort()).toEqual(['1', '3']);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('does not throw and returns only valid payments (no total-list outage)', async () => {
      await expect(repo.findByStatus(PaymentStatus.COMPLETED)).resolves.toHaveLength(2);
    });

    it('emits the skipped-records telemetry counter tagged as "payment" (#111)', async () => {
      await repo.findByStatus(PaymentStatus.COMPLETED);
      expect(telemetry.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.objectContaining({ entity: 'payment' })
      );
    });

    it('getTotalByTransaction ignores the corrupt record when summing completed payments', async () => {
      const total = await repo.getTotalByTransaction('order-A');
      // 50 + 30 from the two valid COMPLETED payments; the corrupt one is skipped.
      expect(total).toBe(80);
    });
  });

  describe('queries', () => {
    beforeEach(async () => {
      await db.payments.bulkAdd([
        record({
          id: 'p-cash',
          orderId: 'order-1',
          method: PaymentMethod.CASH,
          status: PaymentStatus.COMPLETED,
          amount: 40,
        }),
        record({
          id: 'p-card',
          orderId: 'order-1',
          method: PaymentMethod.CREDIT_CARD,
          status: PaymentStatus.COMPLETED,
          amount: 60,
        }),
        record({
          id: 'p-refunded',
          orderId: 'order-2',
          method: PaymentMethod.CASH,
          status: PaymentStatus.REFUNDED,
          amount: 20,
          refundedAmount: 20,
        }),
        record({
          id: 'p-failed',
          orderId: 'order-3',
          method: PaymentMethod.DEBIT_CARD,
          status: PaymentStatus.FAILED,
          amount: 15,
        }),
      ]);
    });

    it('findByStatus / findByMethod filter correctly', async () => {
      expect((await repo.findByStatus(PaymentStatus.COMPLETED)).map((p) => p.id).sort()).toEqual([
        'p-card',
        'p-cash',
      ]);
      expect((await repo.findByMethod(PaymentMethod.CASH)).map((p) => p.id).sort()).toEqual([
        'p-cash',
        'p-refunded',
      ]);
    });

    it('findByTransactionId returns all payments for an order', async () => {
      const result = await repo.findByTransactionId('order-1');
      expect(result.map((p) => p.id).sort()).toEqual(['p-card', 'p-cash']);
    });

    it('findByDateRange returns payments within the range (inclusive)', async () => {
      const result = await repo.findByDateRange(
        new Date('2026-06-01T00:00:00Z'),
        new Date('2026-06-30T00:00:00Z')
      );
      expect(result).toHaveLength(4);
    });

    it('findByCustomerId returns an empty array (not yet joined) and getTotalByCustomer is 0', async () => {
      expect(await repo.findByCustomerId('cust-1')).toEqual([]);
      expect(await repo.getTotalByCustomer('cust-1')).toBe(0);
    });

    it('getTotalByTransaction sums only COMPLETED payments for the order', async () => {
      expect(await repo.getTotalByTransaction('order-1')).toBe(100);
    });

    it('getRefundedPayments returns refunded/partially-refunded payments, optionally by date', async () => {
      expect((await repo.getRefundedPayments()).map((p) => p.id)).toEqual(['p-refunded']);
      const inRange = await repo.getRefundedPayments(
        new Date('2026-06-01T00:00:00Z'),
        new Date('2026-06-30T00:00:00Z')
      );
      expect(inRange.map((p) => p.id)).toEqual(['p-refunded']);
      const outOfRange = await repo.getRefundedPayments(
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-07-31T00:00:00Z')
      );
      expect(outOfRange).toEqual([]);
    });

    it('getFailedPayments returns failed payments, optionally by date', async () => {
      expect((await repo.getFailedPayments()).map((p) => p.id)).toEqual(['p-failed']);
      const outOfRange = await repo.getFailedPayments(
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-07-31T00:00:00Z')
      );
      expect(outOfRange).toEqual([]);
    });

    it('getStatsByDateRange aggregates totals by method and status', async () => {
      const stats = await repo.getStatsByDateRange(
        new Date('2026-06-01T00:00:00Z'),
        new Date('2026-06-30T00:00:00Z')
      );
      expect(stats.totalCount).toBe(4);
      expect(stats.totalAmount).toBe(135);
      expect(stats.byMethod[PaymentMethod.CASH]).toEqual({ count: 2, amount: 60 });
      expect(stats.byMethod[PaymentMethod.CREDIT_CARD]).toEqual({ count: 1, amount: 60 });
      expect(stats.byStatus[PaymentStatus.COMPLETED]).toEqual({ count: 2, amount: 100 });
      expect(stats.byStatus[PaymentStatus.FAILED]).toEqual({ count: 1, amount: 15 });
    });
  });

  describe('entity <-> record mapping', () => {
    it('maps every optional field back onto the domain entity', async () => {
      await db.payments.bulkAdd([
        record({
          id: 'full',
          orderId: 'order-full',
          method: PaymentMethod.CREDIT_CARD,
          status: PaymentStatus.COMPLETED,
          amount: 120,
          refundedAmount: 10,
          completedAt: new Date('2026-06-15T13:00:00Z'),
          transactionId: 'txn-999',
          cardLast4: '4242',
          cardBrand: 'Visa',
          receiptNumber: 'R-1001',
          createdBy: 'user-1',
          updatedBy: 'user-2',
        }),
      ]);

      const [payment] = await repo.findByStatus(PaymentStatus.COMPLETED);
      expect(payment.orderId).toBe('order-full');
      expect(payment.amount).toBe(120);
      expect(payment.method).toBe(PaymentMethod.CREDIT_CARD);
      expect(payment.refundedAmount).toBe(10);
      expect(payment.transactionId).toBe('txn-999');
      expect(payment.cardLast4).toBe('4242');
      expect(payment.cardBrand).toBe('Visa');
      expect(payment.receiptNumber).toBe('R-1001');
      expect(payment.createdBy).toBe('user-1');
      expect(payment.updatedBy).toBe('user-2');
    });

    it('create maps a domain entity to the DB and reads it back intact', async () => {
      const [seed] = await (async () => {
        await db.payments.add(record({ id: 'seed', orderId: 'order-seed', amount: 25 }));
        return repo.findByTransactionId('order-seed');
      })();

      // Re-persist through the entity path to exercise mapToDatabase.
      await db.payments.clear();
      const created = await repo.create(seed);
      expect(created.id).toBe('seed');

      const [readBack] = await repo.findByTransactionId('order-seed');
      expect(readBack.id).toBe('seed');
      expect(readBack.amount).toBe(25);
    });
  });
});

// Made with Bob
