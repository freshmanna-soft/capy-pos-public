import { Injectable, inject, signal, computed } from '@angular/core';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { TerminalMode } from '@core/domain/auth/terminal-id.value-object';
import { environment } from '../../../../environments/environment';

// ── Persisted shapes ─────────────────────────────────────────────────────────

/**
 * One organisation row.  Key pattern: `org:<orgId>`.
 */
export interface OrgRecord {
  orgId: string;
  /** Brand / parent company name. */
  name: string;
}

/** A single vertex in a geofence polygon. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * One store row.  Key pattern: `store:<orgId>:<storeSlug>`.
 *
 * A store belongs to exactly one org. Contact details shown to the customer
 * on the kiosk splash screen and shop header are stored here.
 */
export interface StoreRecord {
  orgId: string;
  storeId: string; // canonical "orgId/storeSlug"
  /** Human-readable store name (shown on kiosk). */
  name: string;
  /** Street address shown on the kiosk welcome screen. */
  address: string;
  /** Customer support phone number. */
  phone: string;
  /**
   * Geofence polygon for this store (ordered ring of lat/lng vertices).
   * An empty array means no fence is configured (entry always allowed).
   * At least 3 vertices are required for a valid polygon.
   */
  fencePolygon: LatLng[];
}

/**
 * One terminal row.  Key pattern: `terminal:<orgId>:<storeSlug>:<terminalSlug>`.
 *
 * A terminal belongs to exactly one store. Its `mode` drives which payment
 * methods are offered at checkout; payment overrides allow per-terminal
 * toggling independent of the global build flags.
 */
export interface TerminalRecord {
  orgId: string;
  storeId: string; // "orgId/storeSlug"
  terminalId: string; // "orgId/storeSlug/terminalSlug"
  /** Human-readable label for the terminal (e.g. "Kiosk 1", "POS-3"). */
  label: string;
  mode: TerminalMode;
  /**
   * Per-terminal MercadoPago override.
   * `null`  → follow `environment.mercadopago.enabled`
   * `true`  → force enabled on this terminal
   * `false` → force disabled on this terminal
   */
  mercadopagoEnabled: boolean | null;
  /** Per-terminal PayPal override (same semantics as mercadopagoEnabled). */
  paypalEnabled: boolean | null;
  /** Geofencing — blocks the kiosk route unless the device is within range. */
  fenceEnabled: boolean;
  fenceLat: number | null;
  fenceLng: number | null;
  fenceRadiusMeters: number;
}

// ── Settings-table key helpers ───────────────────────────────────────────────

/** Key for the row that records which terminal this browser instance is running on. */
const ACTIVE_TERMINAL_KEY = 'active-terminal';

function orgKey(orgId: string): string {
  return `org:${orgId}`;
}
function storeKey(storeId: string): string {
  return `store:${storeId}`;
}
function terminalKey(terminalId: string): string {
  return `terminal:${terminalId}`;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_ORG_ID = 'default-org';
const DEFAULT_STORE_ID = `${DEFAULT_ORG_ID}/default-store`;
const DEFAULT_TERMINAL_ID = `${DEFAULT_STORE_ID}/default-terminal`;

function defaultOrg(): OrgRecord {
  return { orgId: DEFAULT_ORG_ID, name: '' };
}
function defaultStore(orgId = DEFAULT_ORG_ID): StoreRecord {
  return {
    orgId,
    storeId: `${orgId}/default-store`,
    name: '',
    address: '',
    phone: '',
    fencePolygon: [],
  };
}
function defaultTerminal(storeId = DEFAULT_STORE_ID): TerminalRecord {
  return {
    orgId: storeId.split('/')[0],
    storeId,
    terminalId: `${storeId}/default-terminal`,
    label: 'Default terminal',
    mode: TerminalMode.OPERATOR,
    mercadopagoEnabled: null,
    paypalEnabled: null,
    fenceEnabled: false,
    fenceLat: null,
    fenceLng: null,
    fenceRadiusMeters: 200,
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * KioskSettingsService (Application layer)
 *
 * Manages the full Org → Store → Terminal configuration hierarchy, persisting
 * each entity as a separate row in the Dexie `settings` table using a
 * namespaced key (`org:<id>`, `store:<id>`, `terminal:<id>`).
 *
 * Multiple stores and multiple terminals per store are supported from the start.
 *
 * Active-terminal resolution:
 *   A browser session is tied to one terminal at a time.  The active terminal
 *   is recorded under the `active-terminal` settings key and can be changed
 *   by an operator via Settings → Kiosk & Terminal.
 *
 * Payment method resolution (per terminal):
 *   `mercadopagoActive` / `paypalActive` follow a two-level override:
 *     1. Per-terminal explicit override (boolean, not null)
 *     2. Build-time environment flag as the fallback
 */
@Injectable({ providedIn: 'root' })
export class KioskSettingsService {
  private readonly db = inject(DexieDatabase);

  private readonly _loading = signal(false);

  // ── Org list ──────────────────────────────────────────────────────────────

  private readonly _orgs = signal<OrgRecord[]>([]);
  readonly orgs = this._orgs.asReadonly();

  // ── Store list (all orgs) ─────────────────────────────────────────────────

  private readonly _stores = signal<StoreRecord[]>([]);
  readonly stores = this._stores.asReadonly();

  // ── Terminal list (all stores) ────────────────────────────────────────────

  private readonly _terminals = signal<TerminalRecord[]>([]);
  readonly terminals = this._terminals.asReadonly();

  // ── Active terminal ───────────────────────────────────────────────────────

  private readonly _activeTerminalId = signal<string>(DEFAULT_TERMINAL_ID);
  readonly activeTerminalId = this._activeTerminalId.asReadonly();

  /** The active terminal record, or a synthetic default when not persisted yet. */
  readonly activeTerminal = computed<TerminalRecord>(() => {
    const id = this._activeTerminalId();
    return this._terminals().find((t) => t.terminalId === id) ?? defaultTerminal();
  });

  /** The store that owns the active terminal. */
  readonly activeStore = computed<StoreRecord>(() => {
    const storeId = this.activeTerminal().storeId;
    return this._stores().find((s) => s.storeId === storeId) ?? defaultStore();
  });

  /** The org that owns the active store. */
  readonly activeOrg = computed<OrgRecord>(() => {
    const orgId = this.activeStore().orgId;
    return this._orgs().find((o) => o.orgId === orgId) ?? defaultOrg();
  });

  // ── Convenience terminal signals ──────────────────────────────────────────

  readonly isKiosk = computed(() => this.activeTerminal().mode === TerminalMode.KIOSK);
  readonly isOperator = computed(() => this.activeTerminal().mode === TerminalMode.OPERATOR);
  readonly mode = computed(() => this.activeTerminal().mode);

  readonly mercadopagoActive = computed(() => {
    const override = this.activeTerminal().mercadopagoEnabled;
    return override !== null ? override : environment.mercadopago.enabled;
  });

  readonly paypalActive = computed(() => {
    const override = this.activeTerminal().paypalEnabled;
    return override !== null ? override : environment.paypal.enabled;
  });

  // ── Convenience store signals ─────────────────────────────────────────────

  readonly storeName = computed(() => this.activeStore().name);
  readonly orgName = computed(() => this.activeOrg().name);
  readonly storeAddress = computed(() => this.activeStore().address);
  readonly storePhone = computed(() => this.activeStore().phone);
  readonly orgId = computed(() => this.activeOrg().orgId);
  readonly storeId = computed(() => this.activeStore().storeId);
  readonly terminalId = computed(() => this.activeTerminal().terminalId);

  // ── Geofencing (active store polygon) ─────────────────────────────────────

  /** The ordered polygon vertices for the active store's geofence. Empty = no fence. */
  readonly storeFencePolygon = computed(() => this.activeStore().fencePolygon ?? []);

  /** True when the active store has a valid (≥ 3 vertex) polygon configured. */
  readonly hasFencePolygon = computed(() => this.storeFencePolygon().length >= 3);

  // ── Geofencing (active terminal — legacy circle, kept for compatibility) ───

  readonly fenceEnabled = computed(() => this.activeTerminal().fenceEnabled);
  readonly fenceLat = computed(() => this.activeTerminal().fenceLat);
  readonly fenceLng = computed(() => this.activeTerminal().fenceLng);
  readonly fenceRadiusMeters = computed(() => this.activeTerminal().fenceRadiusMeters);

  readonly loading = this._loading.asReadonly();

  // ── Load all ──────────────────────────────────────────────────────────────

  /**
   * Load all org / store / terminal rows and the active-terminal pointer from
   * IndexedDB.  Call once on app boot (or settings page `ngOnInit`).
   * Idempotent — safe to call again; re-reads the current DB state.
   */
  async load(): Promise<void> {
    this._loading.set(true);
    try {
      const table = this.db.table('settings');

      // ── Read the active-terminal pointer ───────────────────────────────
      const activeRow = await table.get(ACTIVE_TERMINAL_KEY);
      if (activeRow?.value) {
        this._activeTerminalId.set(activeRow['value'] as string);
      }

      // ── Read all org / store / terminal rows ───────────────────────────
      const allRows = await table.toArray();

      const orgs: OrgRecord[] = [];
      const stores: StoreRecord[] = [];
      const terminals: TerminalRecord[] = [];

      for (const row of allRows as { id: string; value: string }[]) {
        this.parseSettingsRow(row, orgs, stores, terminals);
      }

      // Ensure at least one default org / store / terminal so the UI always
      // has something to render and the kiosk route always has a terminal.
      if (orgs.length === 0) orgs.push(defaultOrg());
      if (stores.length === 0) stores.push(defaultStore());
      if (terminals.length === 0) terminals.push(defaultTerminal());

      this._orgs.set(orgs);
      this._stores.set(stores);
      this._terminals.set(terminals);
    } finally {
      this._loading.set(false);
    }
  }

  // ── Org CRUD ──────────────────────────────────────────────────────────────

  async saveOrg(org: OrgRecord): Promise<void> {
    await this._put(orgKey(org.orgId), org);
    this._orgs.update((list) => upsert(list, org, (o) => o.orgId === org.orgId));
  }

  async deleteOrg(orgId: string): Promise<void> {
    // Cascade: remove all stores and terminals under this org.
    const stores = this._stores().filter((s) => s.orgId === orgId);
    for (const store of stores) {
      await this.deleteStore(store.storeId);
    }
    await this.db.table('settings').delete(orgKey(orgId));
    this._orgs.update((list) => list.filter((o) => o.orgId !== orgId));
  }

  // ── Store CRUD ────────────────────────────────────────────────────────────

  async saveStore(store: StoreRecord): Promise<void> {
    await this._put(storeKey(store.storeId), store);
    this._stores.update((list) => upsert(list, store, (s) => s.storeId === store.storeId));
  }

  async deleteStore(storeId: string): Promise<void> {
    // Cascade: remove all terminals under this store.
    const terminals = this._terminals().filter((t) => t.storeId === storeId);
    for (const terminal of terminals) {
      await this.deleteTerminal(terminal.terminalId);
    }
    await this.db.table('settings').delete(storeKey(storeId));
    this._stores.update((list) => list.filter((s) => s.storeId !== storeId));
  }

  /** Derive a new unique store ID from an org + a desired slug. */
  nextStoreId(orgId: string, slug: string): string {
    const base = `${orgId}/${slug.trim().toLowerCase().replace(/\s+/g, '-')}`;
    const exists = this._stores().some((s) => s.storeId === base);
    return exists ? `${base}-${Date.now()}` : base;
  }

  // ── Terminal CRUD ─────────────────────────────────────────────────────────

  async saveTerminal(terminal: TerminalRecord): Promise<void> {
    await this._put(terminalKey(terminal.terminalId), terminal);
    this._terminals.update((list) =>
      upsert(list, terminal, (t) => t.terminalId === terminal.terminalId)
    );
  }

  async deleteTerminal(terminalId: string): Promise<void> {
    await this.db.table('settings').delete(terminalKey(terminalId));
    this._terminals.update((list) => list.filter((t) => t.terminalId !== terminalId));
    // If the deleted terminal was active, fall back to any remaining terminal.
    if (this._activeTerminalId() === terminalId) {
      const next = this._terminals().find((t) => t.terminalId !== terminalId);
      await this.setActiveTerminal(next?.terminalId ?? DEFAULT_TERMINAL_ID);
    }
  }

  /** Derive a new unique terminal ID from a store + a desired slug. */
  nextTerminalId(storeId: string, slug: string): string {
    const base = `${storeId}/${slug.trim().toLowerCase().replace(/\s+/g, '-')}`;
    const exists = this._terminals().some((t) => t.terminalId === base);
    return exists ? `${base}-${Date.now()}` : base;
  }

  // ── Active terminal ───────────────────────────────────────────────────────

  /**
   * Change which terminal this browser session is running on.
   * Persisted so a page refresh keeps the same terminal selected.
   */
  async setActiveTerminal(terminalId: string): Promise<void> {
    const table = this.db.table('settings');
    await table.put({
      id: ACTIVE_TERMINAL_KEY,
      key: ACTIVE_TERMINAL_KEY,
      value: terminalId,
      updatedAt: new Date(),
    });
    this._activeTerminalId.set(terminalId);
  }

  // ── Patch helpers (terminal fields) ──────────────────────────────────────

  async patchActiveTerminal(patch: Partial<TerminalRecord>): Promise<void> {
    const current = this.activeTerminal();
    const updated = { ...current, ...patch, terminalId: current.terminalId };
    await this.saveTerminal(updated);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Parse one settings-table row into the appropriate typed array. Skips corrupt rows silently. */
  private parseSettingsRow(
    row: { id: string; value: string },
    orgs: OrgRecord[],
    stores: StoreRecord[],
    terminals: TerminalRecord[]
  ): void {
    if (!row.id || !row.value) return;
    try {
      if (row.id.startsWith('org:')) {
        orgs.push(JSON.parse(row.value) as OrgRecord);
      } else if (row.id.startsWith('store:')) {
        const s = JSON.parse(row.value) as StoreRecord;
        // Backward-compat: rows persisted before fencePolygon was added.
        if (!Array.isArray(s.fencePolygon)) s.fencePolygon = [];
        stores.push(s);
      } else if (row.id.startsWith('terminal:')) {
        terminals.push(JSON.parse(row.value) as TerminalRecord);
      }
    } catch {
      // Corrupt row — skip silently.
    }
  }

  private async _put(id: string, value: unknown): Promise<void> {
    await this.db.table('settings').put({
      id,
      key: id,
      value: JSON.stringify(value),
      updatedAt: new Date(),
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return a new array with `item` inserted or replacing the element where `predicate` matches. */
function upsert<T>(list: T[], item: T, predicate: (existing: T) => boolean): T[] {
  const idx = list.findIndex(predicate);
  if (idx === -1) return [...list, item];
  const next = [...list];
  next[idx] = item;
  return next;
}
