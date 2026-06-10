import { TestBed } from '@angular/core/testing';
import { LowStockSettingsService } from './low-stock-settings.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';

describe('LowStockSettingsService', () => {
  let service: LowStockSettingsService;
  let mockDb: { table: ReturnType<typeof vi.fn> };
  let mockTable: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockTable = {
      get: vi.fn(),
      put: vi.fn(),
    };
    mockDb = {
      table: vi.fn().mockReturnValue(mockTable),
    };

    TestBed.configureTestingModule({
      providers: [LowStockSettingsService, { provide: DexieDatabase, useValue: mockDb }],
    });

    service = TestBed.inject(LowStockSettingsService);
  });

  describe('loadThreshold', () => {
    it('should return default threshold (10) when no setting exists', async () => {
      mockTable.get.mockResolvedValue(null);

      const result = await service.loadThreshold();

      expect(result).toBe(10);
      expect(service.threshold()).toBe(10);
    });

    it('should return stored threshold from IndexedDB', async () => {
      mockTable.get.mockResolvedValue({ value: '15' });

      const result = await service.loadThreshold();

      expect(result).toBe(15);
      expect(service.threshold()).toBe(15);
    });

    it('should query the settings table with correct key', async () => {
      mockTable.get.mockResolvedValue(null);

      await service.loadThreshold();

      expect(mockDb.table).toHaveBeenCalledWith('settings');
      expect(mockTable.get).toHaveBeenCalledWith('low-stock-threshold');
    });

    it('should return default on database error', async () => {
      mockTable.get.mockRejectedValue(new Error('DB error'));

      const result = await service.loadThreshold();

      expect(result).toBe(10);
    });

    it('should return default when stored value is NaN', async () => {
      mockTable.get.mockResolvedValue({ value: 'invalid' });

      const result = await service.loadThreshold();

      expect(result).toBe(10);
    });

    it('should set loading state during operation', async () => {
      mockTable.get.mockResolvedValue(null);

      expect(service.loading()).toBe(false);
      const promise = service.loadThreshold();
      expect(service.loading()).toBe(true);
      await promise;
      expect(service.loading()).toBe(false);
    });
  });

  describe('saveThreshold', () => {
    it('should persist threshold to IndexedDB', async () => {
      mockTable.put.mockResolvedValue(undefined);

      await service.saveThreshold(20);

      expect(mockDb.table).toHaveBeenCalledWith('settings');
      expect(mockTable.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'low-stock-threshold',
          key: 'low-stock-threshold',
          value: '20',
        }),
      );
    });

    it('should update the threshold signal after saving', async () => {
      mockTable.put.mockResolvedValue(undefined);

      await service.saveThreshold(25);

      expect(service.threshold()).toBe(25);
    });

    it('should throw error when threshold is less than 1', async () => {
      await expect(service.saveThreshold(0)).rejects.toThrow('Threshold must be at least 1');
      await expect(service.saveThreshold(-5)).rejects.toThrow('Threshold must be at least 1');
    });

    it('should set loading state during save', async () => {
      mockTable.put.mockResolvedValue(undefined);

      expect(service.loading()).toBe(false);
      const promise = service.saveThreshold(15);
      expect(service.loading()).toBe(true);
      await promise;
      expect(service.loading()).toBe(false);
    });
  });

  describe('getThreshold', () => {
    it('should return current threshold value', () => {
      expect(service.getThreshold()).toBe(10);
    });

    it('should return updated value after load', async () => {
      mockTable.get.mockResolvedValue({ value: '30' });
      await service.loadThreshold();

      expect(service.getThreshold()).toBe(30);
    });
  });
});
