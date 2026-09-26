import { Injectable, inject, signal, computed } from '@angular/core';
import { KioskSettingsService, LatLng } from './kiosk-settings.service';
import { environment } from '../../../../environments/environment';

/** Current geolocation state of the device. */
export type GeoStatus =
  | 'idle'
  | 'locating'
  | 'inside'
  | 'outside'
  | 'disabled' // no fence configured for this store
  | 'error';

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracyMeters: number;
}

/**
 * GeofencingService  (Application layer)
 *
 * Wraps the browser Geolocation API and checks whether the device is inside
 * the active store's geofence polygon.
 *
 * Fence priority:
 *   1. `StoreRecord.fencePolygon` — polygon drawn in the settings map (≥ 3 vertices)
 *   2. `TerminalRecord` circle (legacy — kept for terminals configured before the
 *      polygon editor existed, used only when the store has no polygon)
 *
 * Design decisions:
 *   - A disabled / unconfigured fence always resolves to `'disabled'` which
 *     callers treat as allowed, so stores that have not set up a fence are
 *     never blocked.
 *   - Errors are non-blocking: callers receive `'error'` and can choose to
 *     warn or degrade gracefully.
 *   - Only one `getCurrentPosition` call runs at a time (guarded by `'locating'`).
 */
@Injectable({ providedIn: 'root' })
export class GeofencingService {
  private readonly settings = inject(KioskSettingsService);

  private readonly _status = signal<GeoStatus>('idle');
  private readonly _position = signal<GeoPosition | null>(null);
  private readonly _errorMessage = signal<string>('');

  readonly status = this._status.asReadonly();
  readonly position = this._position.asReadonly();
  readonly errorMessage = this._errorMessage.asReadonly();

  /** True when the device is inside the fence (or no fence is configured). */
  readonly isInsideFence = computed(() => {
    const s = this._status();
    return s === 'inside' || s === 'disabled';
  });

  /** True when the fence is active and the device is outside. */
  readonly isOutsideFence = computed(() => this._status() === 'outside');

  /**
   * Request a fresh position fix and compare it to the active store's fence.
   * Returns the resulting `GeoStatus` so callers can await the decision.
   */
  async checkFence(): Promise<GeoStatus> {
    const polygon = this.settings.storeFencePolygon();
    const hasPoly = polygon.length >= 3;
    const legacyEnabled = !hasPoly && this.settings.fenceEnabled();

    if (!hasPoly && !legacyEnabled) {
      this._status.set('disabled');
      return 'disabled';
    }

    if (this._status() === 'locating') {
      return this._status();
    }

    this._status.set('locating');
    this._errorMessage.set('');

    try {
      const position = await this.getCurrentPosition();
      this._position.set(position);
      const next = hasPoly
        ? pointInPolygon(position, polygon)
          ? 'inside'
          : 'outside'
        : this.checkLegacyCircle(position);
      this._status.set(next);
      return next;
    } catch (err) {
      // Location permission denied or browser geolocation unavailable.
      // We treat this as 'disabled' — never hard-block a customer because
      // their browser won't share location. The store picker (if ≥2 stores)
      // or the absence of a fence check (single store) handles the UX.
      const msg = err instanceof Error ? err.message : 'Location unavailable';
      this._errorMessage.set(msg);
      this._status.set('disabled');
      return 'disabled';
    }
  }

  /** Haversine circle check for terminals configured before the polygon editor. */
  private checkLegacyCircle(position: GeoPosition): GeoStatus {
    const fenceLat = this.settings.fenceLat();
    const fenceLng = this.settings.fenceLng();
    if (fenceLat === null || fenceLng === null) return 'disabled';
    const dist = haversineDistance(position.lat, position.lng, fenceLat, fenceLng);
    return dist <= this.settings.fenceRadiusMeters() ? 'inside' : 'outside';
  }

  /** Reset to idle (e.g. before navigating away). */
  reset(): void {
    this._status.set('idle');
    this._position.set(null);
    this._errorMessage.set('');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private getCurrentPosition(): Promise<GeoPosition> {
    // Dev / test override — skips the real browser prompt entirely.
    if (environment.geofencing.mockPosition !== null) {
      const { lat, lng } = environment.geofencing.mockPosition;
      return Promise.resolve({ lat, lng, accuracyMeters: 0 });
    }

    return new Promise<GeoPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy,
          });
        },
        (err) => reject(new Error(err.message)),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
      );
    });
  }
}

// ── Pure geometry utilities ───────────────────────────────────────────────────

/**
 * Ray-casting point-in-polygon test (Jordan curve theorem).
 *
 * Casts a horizontal ray eastward from `point` and counts how many edges
 * of the polygon it crosses.  An odd count means the point is inside.
 *
 * Works reliably for any simple (non-self-intersecting) polygon.
 * Not suitable for polygons that span the anti-meridian (±180°) or poles —
 * store geofences are always small enough to be safe.
 */
export function pointInPolygon(point: GeoPosition, polygon: LatLng[]): boolean {
  const { lat: py, lng: px } = point;
  const n = polygon.length;
  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const { lat: iy, lng: ix } = polygon[i];
    const { lat: jy, lng: jx } = polygon[j];

    // Edge crosses the horizontal ray at py?
    const intersects = iy > py !== jy > py && px < ((jx - ix) * (py - iy)) / (jy - iy) + ix;

    if (intersects) inside = !inside;
  }

  return inside;
}

/**
 * Haversine great-circle distance between two lat/lng points, in metres.
 * Retained for the legacy terminal-circle fallback.
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
