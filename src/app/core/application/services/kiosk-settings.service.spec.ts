import { TestBed } from '@angular/core/testing';
import {
  KioskSettingsService,
  OrgRecord,
  StoreRecord,
  TerminalRecord,
} from './kiosk-settings.service';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { TerminalMode } from '@core/domain/auth/terminal-id.value-object';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG: OrgRecord = { orgId: 'org1', name: 'Test Org' };

const STORE: StoreRecord = {
  orgId: 'org1',
  storeId: 'org1/store1',
  name: 'Test Store',
  address: '1 Test St',
  phone: '555-0100',
  fencePolygon: [],
};

const TERMINAL: TerminalRecord = {
  orgId: 'org1',
  storeId: 'org1/store1',
  terminalId: 'org1/store1/t1',
  label: 'Kiosk 1',
  mode: TerminalMode.KIOSK,
  mercadopagoEnabled: null,
  paypalEnabled: null,
  fenceEnabled: false,
  fenceLat: null,
  fenceLng: null,
  fenceRadiusMeters: 200,
};

function buildMockDb() {
  const mockTable = {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    toArray: vi.fn().mockResolvedValue([]),
  };
  const mockDb = {
    table: vi.fn().mockReturnValue(mockTable),
  };
  return { mockDb, mockTable };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('KioskSettingsService', () => {
  let service: KioskSettingsService;
  let mockDb: ReturnType<typeof buildMockDb>['mockDb'];
  let mockTable: ReturnType<typeof buildMockDb>['mockTable'];

  beforeEach(() => {
    ({ mockDb, mockTable } = buildMockDb());

    TestBed.configureTestingModule({
      providers: [KioskSettingsService, { provide: DexieDatabase, useValue: mockDb }],
    });
    service = TestBed.inject(KioskSettingsService);
  });

  afterEach(() => TestBed.resetTestingModule());

  // ── defaults (before load) ────────────────────────────────────────────────

  describe('defaults before load', () => {
    it('returns default terminal id', () => {
      expect(service.activeTerminalId()).toBe('default-org/default-store/default-terminal');
    });

    it('activeTerminal is the synthetic default', () => {
      expect(service.activeTerminal().label).toBe('Default terminal');
    });

    it('activeStore returns default store', () => {
      expect(service.activeStore().storeId).toBe('default-org/default-store');
    });

    it('loading starts false', () => {
      expect(service.loading()).toBe(false);
    });
  });

  // ── load ─────────────────────────────────────────────────────────────────

  describe('load', () => {
    it('pushes defaults when DB is empty', async () => {
      mockTable.toArray.mockResolvedValue([]);
      await service.load();

      expect(service.orgs().length).toBeGreaterThanOrEqual(1);
      expect(service.stores().length).toBeGreaterThanOrEqual(1);
      expect(service.terminals().length).toBeGreaterThanOrEqual(1);
    });

    it('reads the active-terminal pointer from DB', async () => {
      mockTable.get.mockResolvedValue({ value: 'org1/store1/t1' });
      mockTable.toArray.mockResolvedValue([]);
      await service.load();

      expect(service.activeTerminalId()).toBe('org1/store1/t1');
    });

    it('parses org / store / terminal rows', async () => {
      mockTable.get.mockResolvedValue(null);
      mockTable.toArray.mockResolvedValue([
        { id: `org:${ORG.orgId}`, value: JSON.stringify(ORG) },
        { id: `store:${STORE.storeId}`, value: JSON.stringify(STORE) },
        { id: `terminal:${TERMINAL.terminalId}`, value: JSON.stringify(TERMINAL) },
      ]);

      await service.load();

      expect(service.orgs()).toContainEqual(expect.objectContaining({ orgId: 'org1' }));
      expect(service.stores()).toContainEqual(expect.objectContaining({ storeId: 'org1/store1' }));
      expect(service.terminals()).toContainEqual(
        expect.objectContaining({ terminalId: 'org1/store1/t1' })
      );
    });

    it('sets loading flag during operation', async () => {
      mockTable.toArray.mockResolvedValue([]);
      expect(service.loading()).toBe(false);
      const p = service.load();
      expect(service.loading()).toBe(true);
      await p;
      expect(service.loading()).toBe(false);
    });

    it('backfills missing fencePolygon on old store records', async () => {
      const legacyStore = { ...STORE } as Record<string, unknown>;
      delete legacyStore['fencePolygon'];

      mockTable.toArray.mockResolvedValue([
        { id: `store:${STORE.storeId}`, value: JSON.stringify(legacyStore) },
      ]);

      await service.load();

      const loaded = service.stores().find((s) => s.storeId === STORE.storeId);
      expect(loaded?.fencePolygon).toEqual([]);
    });

    it('silently skips corrupt rows', async () => {
      mockTable.toArray.mockResolvedValue([
        { id: 'store:bad', value: '{not valid json' },
        { id: `store:${STORE.storeId}`, value: JSON.stringify(STORE) },
      ]);

      await expect(service.load()).resolves.not.toThrow();
    });
  });

  // ── saveOrg / deleteOrg ───────────────────────────────────────────────────

  describe('saveOrg', () => {
    it('persists the org and updates the signal', async () => {
      await service.saveOrg(ORG);

      expect(mockTable.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: `org:${ORG.orgId}` })
      );
      expect(service.orgs()).toContainEqual(expect.objectContaining({ orgId: 'org1' }));
    });

    it('updates an existing org in-place', async () => {
      await service.saveOrg(ORG);
      await service.saveOrg({ ...ORG, name: 'Renamed Org' });

      const names = service
        .orgs()
        .filter((o) => o.orgId === 'org1')
        .map((o) => o.name);
      expect(names).toEqual(['Renamed Org']);
    });
  });

  describe('deleteOrg', () => {
    it('removes the org and cascades to stores and terminals', async () => {
      await service.saveOrg(ORG);
      await service.saveStore(STORE);
      await service.saveTerminal(TERMINAL);

      await service.deleteOrg('org1');

      expect(service.orgs().find((o) => o.orgId === 'org1')).toBeUndefined();
      expect(service.stores().find((s) => s.storeId === STORE.storeId)).toBeUndefined();
      expect(service.terminals().find((t) => t.terminalId === TERMINAL.terminalId)).toBeUndefined();
    });
  });

  // ── saveStore / deleteStore ───────────────────────────────────────────────

  describe('saveStore', () => {
    it('persists the store and updates the signal', async () => {
      await service.saveStore(STORE);

      expect(mockTable.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: `store:${STORE.storeId}` })
      );
      expect(service.stores()).toContainEqual(expect.objectContaining({ storeId: STORE.storeId }));
    });
  });

  describe('deleteStore', () => {
    it('cascades to terminals under the store', async () => {
      await service.saveStore(STORE);
      await service.saveTerminal(TERMINAL);

      await service.deleteStore(STORE.storeId);

      expect(service.stores().find((s) => s.storeId === STORE.storeId)).toBeUndefined();
      expect(service.terminals().find((t) => t.terminalId === TERMINAL.terminalId)).toBeUndefined();
    });
  });

  // ── saveTerminal / deleteTerminal ─────────────────────────────────────────

  describe('saveTerminal', () => {
    it('persists the terminal and updates the signal', async () => {
      await service.saveTerminal(TERMINAL);

      expect(mockTable.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: `terminal:${TERMINAL.terminalId}` })
      );
      expect(service.terminals()).toContainEqual(
        expect.objectContaining({ terminalId: TERMINAL.terminalId })
      );
    });
  });

  describe('deleteTerminal', () => {
    it('removes the terminal from the signal', async () => {
      await service.saveTerminal(TERMINAL);
      await service.deleteTerminal(TERMINAL.terminalId);

      expect(service.terminals().find((t) => t.terminalId === TERMINAL.terminalId)).toBeUndefined();
    });

    it('falls back to default terminal id when active terminal is deleted', async () => {
      await service.saveTerminal(TERMINAL);
      await service.setActiveTerminal(TERMINAL.terminalId);
      await service.deleteTerminal(TERMINAL.terminalId);

      // No other terminal in the list → falls back to DEFAULT_TERMINAL_ID.
      expect(service.activeTerminalId()).toBe('default-org/default-store/default-terminal');
    });
  });

  // ── nextStoreId / nextTerminalId ──────────────────────────────────────────

  describe('nextStoreId', () => {
    it('generates a slug-based id', () => {
      expect(service.nextStoreId('org1', 'My Store')).toBe('org1/my-store');
    });

    it('appends timestamp when slug already exists', async () => {
      await service.saveStore(STORE); // storeId: 'org1/store1'
      const id = service.nextStoreId('org1', 'store1');
      expect(id).toMatch(/^org1\/store1-\d+$/);
    });
  });

  describe('nextTerminalId', () => {
    it('generates a slug-based id', () => {
      expect(service.nextTerminalId('org1/store1', 'Kiosk 2')).toBe('org1/store1/kiosk-2');
    });

    it('appends timestamp when slug already exists', async () => {
      await service.saveTerminal(TERMINAL); // terminalId: 'org1/store1/t1'
      const id = service.nextTerminalId('org1/store1', 't1');
      expect(id).toMatch(/^org1\/store1\/t1-\d+$/);
    });
  });

  // ── setActiveTerminal ─────────────────────────────────────────────────────

  describe('setActiveTerminal', () => {
    it('persists and updates the active terminal id signal', async () => {
      await service.setActiveTerminal('org1/store1/t1');

      expect(service.activeTerminalId()).toBe('org1/store1/t1');
      expect(mockTable.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'active-terminal', value: 'org1/store1/t1' })
      );
    });
  });

  // ── patchActiveTerminal ───────────────────────────────────────────────────

  describe('patchActiveTerminal', () => {
    it('merges patch fields onto the active terminal', async () => {
      await service.saveTerminal(TERMINAL);
      await service.setActiveTerminal(TERMINAL.terminalId);

      await service.patchActiveTerminal({ fenceEnabled: true, fenceRadiusMeters: 500 });

      const updated = service.terminals().find((t) => t.terminalId === TERMINAL.terminalId);
      expect(updated?.fenceEnabled).toBe(true);
      expect(updated?.fenceRadiusMeters).toBe(500);
      // Untouched fields survive.
      expect(updated?.label).toBe('Kiosk 1');
    });
  });

  // ── computed signals ──────────────────────────────────────────────────────

  describe('computed signals', () => {
    it('isKiosk is true for KIOSK mode terminal', async () => {
      await service.saveTerminal(TERMINAL);
      await service.setActiveTerminal(TERMINAL.terminalId);
      expect(service.isKiosk()).toBe(true);
      expect(service.isOperator()).toBe(false);
    });

    it('storeName reflects the active store', async () => {
      await service.saveStore(STORE);
      await service.saveTerminal(TERMINAL);
      await service.setActiveTerminal(TERMINAL.terminalId);
      expect(service.storeName()).toBe('Test Store');
    });

    it('storeAddress reflects the active store', async () => {
      await service.saveStore(STORE);
      await service.saveTerminal(TERMINAL);
      await service.setActiveTerminal(TERMINAL.terminalId);
      expect(service.storeAddress()).toBe('1 Test St');
    });

    it('hasFencePolygon is false when polygon has < 3 vertices', async () => {
      const storeWithPoly = {
        ...STORE,
        fencePolygon: [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
        ],
      };
      await service.saveStore(storeWithPoly);
      await service.saveTerminal(TERMINAL);
      await service.setActiveTerminal(TERMINAL.terminalId);
      expect(service.hasFencePolygon()).toBe(false);
    });

    it('hasFencePolygon is true when polygon has ≥ 3 vertices', async () => {
      const storeWithPoly = {
        ...STORE,
        fencePolygon: [
          { lat: 0, lng: 0 },
          { lat: 2, lng: 0 },
          { lat: 1, lng: 2 },
        ],
      };
      await service.saveStore(storeWithPoly);
      await service.saveTerminal(TERMINAL);
      await service.setActiveTerminal(TERMINAL.terminalId);
      expect(service.hasFencePolygon()).toBe(true);
    });

    it('mercadopagoActive uses terminal override when set', async () => {
      const mpTerminal = { ...TERMINAL, mercadopagoEnabled: false };
      await service.saveTerminal(mpTerminal);
      await service.setActiveTerminal(mpTerminal.terminalId);
      expect(service.mercadopagoActive()).toBe(false);
    });

    it('paypalActive uses terminal override when set', async () => {
      const ppTerminal = { ...TERMINAL, terminalId: 'org1/store1/pp', paypalEnabled: true };
      await service.saveTerminal(ppTerminal);
      await service.setActiveTerminal(ppTerminal.terminalId);
      expect(service.paypalActive()).toBe(true);
    });
  });
});

describe('KioskSettingsService — activeOrg computed', () => {
  let service: KioskSettingsService;

  beforeEach(() => {
    const { mockDb } = buildMockDb();
    TestBed.configureTestingModule({
      providers: [KioskSettingsService, { provide: DexieDatabase, useValue: mockDb }],
    });
    service = TestBed.inject(KioskSettingsService);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('returns defaultOrg when no orgs are loaded (no-match fallback)', () => {
    // No data loaded — _orgs is empty, so the ?? defaultOrg() branch fires.
    expect(service.activeOrg().orgId).toBe('default-org');
  });

  it('still returns a valid org after load (exercises the find() branch)', async () => {
    await service.load();
    expect(service.activeOrg()).toBeDefined();
    expect(typeof service.activeOrg().orgId).toBe('string');
  });
});
