import { Injectable, inject, signal } from '@angular/core';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';

/**
 * Settings stored in IndexedDB
 */
export interface AppSettings {
  id: string;
  key: string;
  value: string;
  updatedAt: Date;
}

/**
 * LowStockSettingsService
 *
 * Infrastructure service that persists the low-stock threshold
 * configuration to IndexedDB via Dexie.
 *
 * Default threshold: 10 units
 */
@Injectable({
  providedIn: 'root',
})
export class LowStockSettingsService {
  private readonly db = inject(DexieDatabase);
  private readonly SETTINGS_KEY = 'low-stock-threshold';
  private readonly DEFAULT_THRESHOLD = 10;

  private readonly _threshold = signal(this.DEFAULT_THRESHOLD);
  private readonly _loading = signal(false);

  /** Current low stock threshold value */
  readonly threshold = this._threshold.asReadonly();

  /** Whether the service is loading/saving */
  readonly loading = this._loading.asReadonly();

  /**
   * Load the threshold from IndexedDB
   * Falls back to default (10) if not set
   */
  async loadThreshold(): Promise<number> {
    this._loading.set(true);
    try {
      const table = this.db.table('settings');
      const record = await table.get(this.SETTINGS_KEY);
      const value = record ? parseInt(record['value'], 10) : this.DEFAULT_THRESHOLD;
      this._threshold.set(isNaN(value) ? this.DEFAULT_THRESHOLD : value);
      return this._threshold();
    } catch {
      this._threshold.set(this.DEFAULT_THRESHOLD);
      return this.DEFAULT_THRESHOLD;
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Save the threshold to IndexedDB
   * @param value - New threshold value (must be >= 1)
   */
  async saveThreshold(value: number): Promise<void> {
    if (value < 1) {
      throw new Error('Threshold must be at least 1');
    }

    this._loading.set(true);
    try {
      const table = this.db.table('settings');
      await table.put({
        id: this.SETTINGS_KEY,
        key: this.SETTINGS_KEY,
        value: value.toString(),
        updatedAt: new Date(),
      });
      this._threshold.set(value);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Get the current threshold value (synchronous, from signal)
   */
  getThreshold(): number {
    return this._threshold();
  }
}
