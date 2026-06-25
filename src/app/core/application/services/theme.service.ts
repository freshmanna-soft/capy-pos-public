import { Injectable, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';

/** Available UI themes */
export type Theme = 'light' | 'dark';

/**
 * ThemeService
 *
 * Application service that owns the UI colour theme (light / dark).
 *
 * - Persists the user's choice to IndexedDB via Dexie (same `settings`
 *   table used by other preferences).
 * - Applies the theme by toggling the `dark` class on the document root,
 *   which drives Tailwind's class-based dark mode and global dark styles.
 * - Exposes the current theme as a readonly signal for OnPush components.
 *
 * Default theme: light
 */
@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly db = inject(DexieDatabase);
  private readonly document = inject(DOCUMENT);

  private readonly SETTINGS_KEY = 'theme';
  private readonly DEFAULT_THEME: Theme = 'light';
  private readonly DARK_CLASS = 'dark';

  private readonly _theme = signal<Theme>(this.DEFAULT_THEME);

  /** Current UI theme */
  readonly theme = this._theme.asReadonly();

  /**
   * Load the persisted theme from IndexedDB and apply it.
   * Falls back to the default theme (light) if none is stored or on error.
   */
  async loadTheme(): Promise<Theme> {
    try {
      const table = this.db.table('settings');
      const record = await table.get(this.SETTINGS_KEY);
      const value = record?.['value'] === 'dark' ? 'dark' : this.DEFAULT_THEME;
      this.applyTheme(value);
      return value;
    } catch {
      this.applyTheme(this.DEFAULT_THEME);
      return this.DEFAULT_THEME;
    }
  }

  /**
   * Persist and apply a specific theme.
   * @param theme - The theme to activate
   */
  async setTheme(theme: Theme): Promise<void> {
    this.applyTheme(theme);
    const table = this.db.table('settings');
    await table.put({
      id: this.SETTINGS_KEY,
      key: this.SETTINGS_KEY,
      value: theme,
      updatedAt: new Date(),
    });
  }

  /**
   * Toggle between light and dark, persisting the new value.
   */
  async toggleTheme(): Promise<void> {
    await this.setTheme(this._theme() === 'dark' ? 'light' : 'dark');
  }

  /**
   * Get the current theme value (synchronous, from signal).
   */
  getTheme(): Theme {
    return this._theme();
  }

  /** Update the signal and reflect the theme on the document root. */
  private applyTheme(theme: Theme): void {
    this._theme.set(theme);
    const root = this.document.documentElement;
    if (theme === 'dark') {
      root.classList.add(this.DARK_CLASS);
    } else {
      root.classList.remove(this.DARK_CLASS);
    }
  }
}
