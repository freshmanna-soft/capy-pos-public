import type { Table } from 'dexie';
import { BaseDexieRepository } from './base-dexie.repository';

/**
 * Regression coverage for the resilient list mapping (`mapRecords`).
 *
 * A single corrupt record (e.g. a missing required field from a bad sync or the
 * capy-pos-demo failure-injection mode) must NOT throw out of a list load and
 * break every view. It should be skipped (with a warning) and the rest returned.
 */
interface FakeRecord {
  id: string;
  name: string;
}

class FakeEntity {
  constructor(
    public readonly id: string,
    public readonly name: string
  ) {
    // Mirrors the real Product entity: empty name is invalid and throws.
    if (!name || name.trim() === '') {
      throw new Error('name is required');
    }
  }
}

/** Minimal concrete repo exposing the protected mapper for direct testing. */
class TestRepo extends BaseDexieRepository<
  FakeEntity & { createdAt: Date; updatedAt: Date },
  FakeRecord
> {
  constructor() {
    super({} as unknown as Table<FakeRecord, string>);
  }
  protected mapToEntity(record: FakeRecord) {
    return new FakeEntity(record.id, record.name) as FakeEntity & {
      createdAt: Date;
      updatedAt: Date;
    };
  }
  protected mapToDatabase(entity: FakeEntity): FakeRecord {
    return { id: entity.id, name: entity.name };
  }
  public mapBatch(records: FakeRecord[]) {
    return this.mapRecords(records);
  }
}

describe('BaseDexieRepository — resilient list mapping (mapRecords)', () => {
  let repo: TestRepo;

  beforeEach(() => {
    repo = new TestRepo();
  });

  it('skips invalid records and returns only the valid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = repo.mapBatch([
      { id: '1', name: 'Coffee' },
      { id: '2', name: '' }, // corrupt → must be skipped, not fatal
      { id: '3', name: 'Tea' },
    ]);

    expect(result.map((e) => e.id)).toEqual(['1', '3']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns all records and warns for none when every record is valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = repo.mapBatch([
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ]);

    expect(result).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns an empty array (not a throw) when every record is invalid', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => repo.mapBatch([{ id: '1', name: '' }])).not.toThrow();
    expect(repo.mapBatch([{ id: '1', name: '' }])).toEqual([]);
  });

  it('handles an empty input list', () => {
    expect(repo.mapBatch([])).toEqual([]);
  });
});
