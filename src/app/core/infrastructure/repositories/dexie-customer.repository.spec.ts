import Dexie, { type Table } from 'dexie';
import { TestBed } from '@angular/core/testing';
import { DexieCustomerRepository } from './dexie-customer.repository';
import { DexieDatabase, ICustomerDB } from '@core/infrastructure/database/dexie-database.service';
import { CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';

/**
 * Unit tests for DexieCustomerRepository against a real Dexie table backed by
 * fake-indexeddb (wired globally in vitest.setup.ts).
 *
 * The headline case is resilience: a single corrupt record (empty required
 * `name`, as produced by the capy-pos-demo failure-injection mode or a bad
 * sync) must be SKIPPED on list loads, not crash the whole customer list.
 * This mirrors the product-repository regression fixed in PR #108 and closes
 * the negative-path coverage floor tracked by #110 for the customer repo —
 * `search`, `findByMinLoyaltyPoints` and `getTopCustomers` previously mapped
 * records raw and would throw on the first bad record.
 */

let dbCounter = 0;

/** A Dexie DB exposing only a `customers` table with the indexes the repo needs. */
function freshDb(): Dexie & { customers: Table<ICustomerDB, string> } {
  const db = new Dexie(`CapyPOSDB-custrepo-${Date.now()}-${++dbCounter}`) as Dexie & {
    customers: Table<ICustomerDB, string>;
  };
  db.version(1).stores({
    customers: 'id, email, phone, status, tier, [status+tier], deletedAt',
  });
  return db;
}

function record(overrides: Partial<ICustomerDB> = {}): ICustomerDB {
  const now = new Date();
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: overrides.id ?? `c-${suffix}`,
    name: 'Ada Lovelace',
    email: overrides.email ?? `ada-${suffix}@example.com`,
    phone: overrides.phone ?? '+1-555-0100',
    status: CustomerStatus.ACTIVE,
    loyaltyPoints: 100,
    tier: CustomerTier.BRONZE,
    country: 'USA',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('DexieCustomerRepository (real Dexie + fake-indexeddb)', () => {
  let db: Dexie & { customers: Table<ICustomerDB, string> };
  let repo: DexieCustomerRepository;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = freshDb();
    TestBed.configureTestingModule({
      providers: [
        DexieCustomerRepository,
        { provide: DexieDatabase, useValue: db as unknown as DexieDatabase },
      ],
    });
    repo = TestBed.inject(DexieCustomerRepository);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await db.delete();
  });

  describe('resilient list mapping (#110)', () => {
    beforeEach(async () => {
      await db.customers.bulkAdd([
        record({ id: '1', name: 'Coffee Lover', loyaltyPoints: 300 }),
        record({ id: '2', name: '', loyaltyPoints: 200 }), // corrupt → must be skipped
        record({ id: '3', name: 'Tea Fan', loyaltyPoints: 100 }),
      ]);
    });

    it('search skips the corrupt record and returns the valid ones', async () => {
      // Empty query matches everything; the empty-name record is still skipped.
      const result = await repo.search('');
      expect(result.map((c) => c.id).sort()).toEqual(['1', '3']);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('findByMinLoyaltyPoints skips the corrupt record', async () => {
      const result = await repo.findByMinLoyaltyPoints(150);
      // Only records 1 (300) and 2 (200) clear the threshold; 2 is corrupt → skipped.
      expect(result.map((c) => c.id)).toEqual(['1']);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('getTopCustomers skips the corrupt record', async () => {
      const result = await repo.getTopCustomers(10);
      expect(result.map((c) => c.id).sort()).toEqual(['1', '3']);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('findAll (inherited) skips the corrupt record', async () => {
      const result = await repo.findAll();
      expect(result.map((c) => c.id).sort()).toEqual(['1', '3']);
    });
  });

  describe('queries', () => {
    beforeEach(async () => {
      await db.customers.bulkAdd([
        record({
          id: '1',
          name: 'Coffee Lover',
          email: 'coffee@example.com',
          phone: '+1-555-0001',
          status: CustomerStatus.VIP,
          tier: CustomerTier.GOLD,
          loyaltyPoints: 500,
        }),
        record({
          id: '2',
          name: 'Croissant Fan',
          email: 'croissant@example.com',
          phone: '+1-555-0002',
          status: CustomerStatus.ACTIVE,
          tier: CustomerTier.SILVER,
          loyaltyPoints: 250,
        }),
        record({
          id: '3',
          name: 'Tea Enjoyer',
          email: 'tea@example.com',
          phone: '+1-555-0003',
          status: CustomerStatus.ACTIVE,
          tier: CustomerTier.BRONZE,
          loyaltyPoints: 50,
        }),
      ]);
    });

    it('search matches by name, email and phone', async () => {
      expect((await repo.search('coffee')).map((c) => c.id)).toEqual(['1']);
      expect((await repo.search('croissant@example.com')).map((c) => c.id)).toEqual(['2']);
      expect((await repo.search('555-0003')).map((c) => c.id)).toEqual(['3']);
    });

    it('findByEmail and findByPhone return a single entity or null', async () => {
      expect((await repo.findByEmail('croissant@example.com'))?.id).toBe('2');
      expect(await repo.findByEmail('nope@example.com')).toBeNull();
      expect((await repo.findByPhone('+1-555-0001'))?.id).toBe('1');
    });

    it('findByStatus / findByTier filter correctly', async () => {
      expect((await repo.findByStatus(CustomerStatus.ACTIVE)).map((c) => c.id).sort()).toEqual([
        '2',
        '3',
      ]);
      expect((await repo.findByTier(CustomerTier.GOLD)).map((c) => c.id)).toEqual(['1']);
    });

    it('findByMinLoyaltyPoints returns customers at or above the threshold', async () => {
      expect((await repo.findByMinLoyaltyPoints(250)).map((c) => c.id).sort()).toEqual(['1', '2']);
    });

    it('getTopCustomers returns customers ordered by loyalty points, respecting the limit', async () => {
      expect((await repo.getTopCustomers(2)).map((c) => c.id)).toEqual(['1', '2']);
    });

    it('getStatistics aggregates counts by status and tier', async () => {
      const stats = await repo.getStatistics();
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(2);
      expect(stats.vip).toBe(1);
      expect(stats.byTier[CustomerTier.GOLD]).toBe(1);
      expect(stats.byTier[CustomerTier.SILVER]).toBe(1);
      expect(stats.byTier[CustomerTier.BRONZE]).toBe(1);
    });

    it('countByStatus / countByTier count correctly', async () => {
      expect(await repo.countByStatus(CustomerStatus.ACTIVE)).toBe(2);
      expect(await repo.countByTier(CustomerTier.GOLD)).toBe(1);
    });

    it('excludes soft-deleted customers from list queries', async () => {
      await db.customers.update('2', { deletedAt: new Date() });
      expect((await repo.search('')).map((c) => c.id).sort()).toEqual(['1', '3']);
      expect((await repo.findByMinLoyaltyPoints(0)).map((c) => c.id).sort()).toEqual(['1', '3']);
    });
  });

  describe('mutations', () => {
    beforeEach(async () => {
      await db.customers.add(
        record({
          id: '1',
          name: 'Coffee Lover',
          status: CustomerStatus.ACTIVE,
          tier: CustomerTier.BRONZE,
          loyaltyPoints: 100,
        })
      );
    });

    it('updateLoyaltyPoints adds and persists the new balance', async () => {
      const updated = await repo.updateLoyaltyPoints('1', 50);
      expect(updated.loyaltyPoints).toBe(150);
      expect((await db.customers.get('1'))?.loyaltyPoints).toBe(150);
    });

    it('updateStatus transitions and persists the new status', async () => {
      const updated = await repo.updateStatus('1', CustomerStatus.VIP);
      expect(updated.status).toBe(CustomerStatus.VIP);
      expect((await db.customers.get('1'))?.status).toBe(CustomerStatus.VIP);
    });

    it('updateLoyaltyPoints / updateStatus throw for a missing customer', async () => {
      await expect(repo.updateLoyaltyPoints('x', 10)).rejects.toThrow();
      await expect(repo.updateStatus('x', CustomerStatus.VIP)).rejects.toThrow();
    });
  });
});
