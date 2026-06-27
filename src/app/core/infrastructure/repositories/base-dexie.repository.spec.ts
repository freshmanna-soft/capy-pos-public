import Dexie, { type Table, type IndexableType } from 'dexie';
import { BaseDexieRepository } from './base-dexie.repository';

/**
 * Coverage for the resilient list mapping (`mapRecords`) and the base list
 * helpers product repos don't exercise directly (`findWithPagination`,
 * `searchByField`, `findByCompoundIndex`).
 *
 * A single corrupt record (e.g. a missing required field from a bad sync or the
 * capy-pos-demo failure-injection mode) must NOT throw out of a list load and
 * break every view (PR #108). It should be skipped (with a warning) and the
 * rest returned. Single-record getters intentionally keep throwing.
 */
interface FakeRecord {
  id: string;
  name: string;
  group: string;
  rank: string;
  deletedAt?: Date;
}

class FakeEntity {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly group: string,
    public readonly rank: string
  ) {
    // Mirrors the real Product entity: empty name is invalid and throws.
    if (!name || name.trim() === '') {
      throw new Error('name is required');
    }
  }
}

/** Concrete repo over a real Dexie table, exposing the protected helpers. */
class TestRepo extends BaseDexieRepository<FakeEntity, FakeRecord> {
  constructor(table: Table<FakeRecord, string>) {
    super(table);
  }
  protected mapToEntity(r: FakeRecord) {
    return new FakeEntity(r.id, r.name, r.group, r.rank);
  }
  protected mapToDatabase(e: FakeEntity): FakeRecord {
    return { id: e.id, name: e.name, group: e.group, rank: e.rank };
  }
  // Public passthroughs for protected helpers under test.
  mapBatch(records: FakeRecord[]) {
    return this.mapRecords(records);
  }
  page(p: number, size: number) {
    return this.findWithPagination(p, size);
  }
  searchName(query: string) {
    return this.searchByField('name', query);
  }
  byGroupAndRank(group: string, rank: string) {
    return this.findByCompoundIndex(['group', 'rank'], [group, rank] as [
      IndexableType,
      IndexableType,
    ]);
  }
}

let counter = 0;

describe('BaseDexieRepository — resilient + list helpers', () => {
  describe('mapRecords (pure, no table needed)', () => {
    const repo = new TestRepo({} as unknown as Table<FakeRecord, string>);

    it('skips invalid records and returns only the valid ones', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = repo.mapBatch([
        { id: '1', name: 'Coffee', group: 'a', rank: 'x' },
        { id: '2', name: '', group: 'a', rank: 'y' }, // corrupt → skipped, not fatal
        { id: '3', name: 'Tea', group: 'b', rank: 'z' },
      ]);
      expect(result.map((e) => e.id)).toEqual(['1', '3']);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('returns all records and warns for none when every record is valid', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = repo.mapBatch([
        { id: '1', name: 'A', group: 'a', rank: 'x' },
        { id: '2', name: 'B', group: 'a', rank: 'y' },
      ]);
      expect(result).toHaveLength(2);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('returns an empty array (not a throw) when every record is invalid', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(() => repo.mapBatch([{ id: '1', name: '', group: 'a', rank: 'x' }])).not.toThrow();
      expect(repo.mapBatch([{ id: '1', name: '', group: 'a', rank: 'x' }])).toEqual([]);
    });

    it('handles an empty input list', () => {
      expect(repo.mapBatch([])).toEqual([]);
    });
  });

  describe('list helpers over a real Dexie table', () => {
    let db: Dexie & { items: Table<FakeRecord, string> };
    let repo: TestRepo;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      db = new Dexie(`base-dexie-test-${Date.now()}-${++counter}`) as Dexie & {
        items: Table<FakeRecord, string>;
      };
      db.version(1).stores({ items: 'id, name, group, rank, [group+rank], deletedAt' });
      repo = new TestRepo(db.items);
      warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await db.items.bulkAdd([
        { id: '1', name: 'Alpha', group: 'g1', rank: 'r1' },
        { id: '2', name: 'Beta', group: 'g1', rank: 'r2' },
        { id: '3', name: 'Gamma', group: 'g2', rank: 'r1' },
        { id: 'bad', name: '', group: 'g1', rank: 'r1' }, // corrupt
      ]);
    });

    afterEach(async () => {
      warn.mockRestore();
      await db.delete();
    });

    it('findWithPagination maps a page and skips invalid records', async () => {
      const all = await repo.page(1, 10);
      expect(all.map((e) => e.id).sort()).toEqual(['1', '2', '3']);
      expect(warn).toHaveBeenCalled();
    });

    it('searchByField filters by a string field and skips invalid records', async () => {
      const result = await repo.searchName('a'); // Alpha, Beta, Gamma all contain "a"
      expect(result.map((e) => e.id).sort()).toEqual(['1', '2', '3']);
    });

    it('findByCompoundIndex queries a [group+rank] index', async () => {
      const result = await repo.byGroupAndRank('g1', 'r2');
      expect(result.map((e) => e.id)).toEqual(['2']);
    });
  });

  describe('CRUD over a real Dexie table', () => {
    let db: Dexie & { items: Table<FakeRecord, string> };
    let repo: TestRepo;

    beforeEach(async () => {
      db = new Dexie(`base-dexie-crud-${Date.now()}-${++counter}`) as Dexie & {
        items: Table<FakeRecord, string>;
      };
      db.version(1).stores({ items: 'id, name, group, rank, [group+rank], deletedAt' });
      repo = new TestRepo(db.items);
    });

    afterEach(async () => {
      await db.delete();
    });

    it('create + findById round-trip', async () => {
      await repo.create(new FakeEntity('1', 'Alpha', 'g1', 'r1'));
      expect((await repo.findById('1'))?.name).toBe('Alpha');
      expect(await repo.findById('missing')).toBeNull();
    });

    it('update replaces an existing record and throws for a missing one', async () => {
      await repo.create(new FakeEntity('1', 'Alpha', 'g1', 'r1'));
      await repo.update('1', new FakeEntity('1', 'Renamed', 'g1', 'r1'));
      expect((await repo.findById('1'))?.name).toBe('Renamed');
      await expect(repo.update('x', new FakeEntity('x', 'Nope', 'g', 'r'))).rejects.toThrow();
    });

    it('soft delete hides from findById; hardDelete removes entirely', async () => {
      await repo.create(new FakeEntity('1', 'Alpha', 'g1', 'r1'));
      await repo.delete('1');
      expect(await repo.findById('1')).toBeNull();
      expect(await repo.exists('1')).toBe(false);
      await expect(repo.delete('missing')).rejects.toThrow();

      await repo.create(new FakeEntity('2', 'Beta', 'g1', 'r1'));
      await repo.hardDelete('2');
      expect(await db.items.get('2')).toBeUndefined();
    });

    it('count excludes soft-deleted; bulkCreate adds many', async () => {
      await repo.bulkCreate([
        new FakeEntity('1', 'A', 'g', 'r'),
        new FakeEntity('2', 'B', 'g', 'r'),
      ]);
      expect(await repo.count()).toBe(2);
      await repo.delete('1');
      expect(await repo.count()).toBe(1);
    });

    it('bulkUpdate merges partial data and throws for a missing id', async () => {
      await repo.create(new FakeEntity('1', 'Alpha', 'g1', 'r1'));
      const [updated] = await repo.bulkUpdate([{ id: '1', data: { name: 'Merged' } }]);
      expect(updated.name).toBe('Merged');
      await expect(repo.bulkUpdate([{ id: 'x', data: { name: 'Nope' } }])).rejects.toThrow();
    });
  });
});
