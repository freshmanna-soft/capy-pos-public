import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ThemeService } from './theme.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';

describe('ThemeService', () => {
  let service: ThemeService;
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

    // Start from a known DOM state for each test
    document.documentElement.classList.remove('dark');

    TestBed.configureTestingModule({
      providers: [
        ThemeService,
        { provide: DexieDatabase, useValue: mockDb },
        { provide: DOCUMENT, useValue: document },
      ],
    });

    service = TestBed.inject(ThemeService);
  });

  it('should default to the light theme', () => {
    expect(service.getTheme()).toBe('light');
    expect(service.theme()).toBe('light');
  });

  describe('loadTheme', () => {
    it('should return light when no setting exists', async () => {
      mockTable.get.mockResolvedValue(null);

      const result = await service.loadTheme();

      expect(result).toBe('light');
      expect(service.theme()).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('should load and apply the stored dark theme', async () => {
      mockTable.get.mockResolvedValue({ value: 'dark' });

      const result = await service.loadTheme();

      expect(result).toBe('dark');
      expect(service.theme()).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should query the settings table with the theme key', async () => {
      mockTable.get.mockResolvedValue(null);

      await service.loadTheme();

      expect(mockDb.table).toHaveBeenCalledWith('settings');
      expect(mockTable.get).toHaveBeenCalledWith('theme');
    });

    it('should fall back to light on database error', async () => {
      mockTable.get.mockRejectedValue(new Error('DB error'));

      const result = await service.loadTheme();

      expect(result).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('should treat an unexpected stored value as light', async () => {
      mockTable.get.mockResolvedValue({ value: 'banana' });

      const result = await service.loadTheme();

      expect(result).toBe('light');
    });
  });

  describe('setTheme', () => {
    it('should persist the theme to IndexedDB', async () => {
      mockTable.put.mockResolvedValue(undefined);

      await service.setTheme('dark');

      expect(mockDb.table).toHaveBeenCalledWith('settings');
      expect(mockTable.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'theme',
          key: 'theme',
          value: 'dark',
        })
      );
    });

    it('should apply the dark class to the document root', async () => {
      mockTable.put.mockResolvedValue(undefined);

      await service.setTheme('dark');

      expect(service.theme()).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should remove the dark class when switching back to light', async () => {
      mockTable.put.mockResolvedValue(undefined);

      await service.setTheme('dark');
      await service.setTheme('light');

      expect(service.theme()).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('toggleTheme', () => {
    it('should switch from light to dark', async () => {
      mockTable.put.mockResolvedValue(undefined);

      await service.toggleTheme();

      expect(service.theme()).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should switch from dark back to light', async () => {
      mockTable.put.mockResolvedValue(undefined);

      await service.toggleTheme();
      await service.toggleTheme();

      expect(service.theme()).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });
});
