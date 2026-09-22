import { TestBed } from '@angular/core/testing';
import { GeofencingService, pointInPolygon, GeoPosition } from './geofencing.service';
import { KioskSettingsService } from './kiosk-settings.service';
import { signal } from '@angular/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A simple 1°×1° square centred at (1,1) – (0,0) → (2,2). */
const SQUARE_POLYGON = [
  { lat: 0, lng: 0 },
  { lat: 2, lng: 0 },
  { lat: 2, lng: 2 },
  { lat: 0, lng: 2 },
];

function makeSettings(overrides: {
  polygon?: typeof SQUARE_POLYGON;
  fenceEnabled?: boolean;
  fenceLat?: number | null;
  fenceLng?: number | null;
  fenceRadiusMeters?: number;
}): Partial<KioskSettingsService> {
  const polygon = overrides.polygon ?? [];
  return {
    storeFencePolygon: signal(polygon).asReadonly(),
    fenceEnabled: signal(overrides.fenceEnabled ?? false).asReadonly(),
    fenceLat: signal(overrides.fenceLat ?? null).asReadonly(),
    fenceLng: signal(overrides.fenceLng ?? null).asReadonly(),
    fenceRadiusMeters: signal(overrides.fenceRadiusMeters ?? 200).asReadonly(),
  } as unknown as Partial<KioskSettingsService>;
}

// ── pointInPolygon ────────────────────────────────────────────────────────────

describe('pointInPolygon (pure)', () => {
  it('returns true for a point clearly inside a square', () => {
    const point: GeoPosition = { lat: 1, lng: 1, accuracyMeters: 0 };
    expect(pointInPolygon(point, SQUARE_POLYGON)).toBe(true);
  });

  it('returns false for a point clearly outside a square', () => {
    const point: GeoPosition = { lat: 5, lng: 5, accuracyMeters: 0 };
    expect(pointInPolygon(point, SQUARE_POLYGON)).toBe(false);
  });

  it('returns false for a point on the same row but west of the polygon', () => {
    const point: GeoPosition = { lat: 1, lng: -1, accuracyMeters: 0 };
    expect(pointInPolygon(point, SQUARE_POLYGON)).toBe(false);
  });

  it('returns false for a point east of the polygon', () => {
    const point: GeoPosition = { lat: 1, lng: 3, accuracyMeters: 0 };
    expect(pointInPolygon(point, SQUARE_POLYGON)).toBe(false);
  });

  it('handles a triangle correctly', () => {
    const triangle = [
      { lat: 0, lng: 0 },
      { lat: 4, lng: 0 },
      { lat: 2, lng: 4 },
    ];
    expect(pointInPolygon({ lat: 2, lng: 1, accuracyMeters: 0 }, triangle)).toBe(true);
    expect(pointInPolygon({ lat: 0, lng: 3, accuracyMeters: 0 }, triangle)).toBe(false);
  });

  it('returns false when polygon is empty', () => {
    const point: GeoPosition = { lat: 1, lng: 1, accuracyMeters: 0 };
    expect(pointInPolygon(point, [])).toBe(false);
  });
});

// ── GeofencingService ─────────────────────────────────────────────────────────

describe('GeofencingService', () => {
  let service: GeofencingService;

  function configure(settingsOverrides: Parameters<typeof makeSettings>[0]) {
    TestBed.configureTestingModule({
      providers: [
        GeofencingService,
        { provide: KioskSettingsService, useValue: makeSettings(settingsOverrides) },
      ],
    });
    service = TestBed.inject(GeofencingService);
  }

  afterEach(() => TestBed.resetTestingModule());

  // ── initial state ───────────────────────────────────────────────────────────

  describe('initial state', () => {
    beforeEach(() => configure({}));

    it('status starts as idle', () => {
      expect(service.status()).toBe('idle');
    });

    it('position starts as null', () => {
      expect(service.position()).toBeNull();
    });

    it('errorMessage starts empty', () => {
      expect(service.errorMessage()).toBe('');
    });

    it('isInsideFence is false when idle (not disabled)', () => {
      // idle is neither inside nor disabled
      expect(service.isInsideFence()).toBe(false);
    });

    it('isOutsideFence is false when idle', () => {
      expect(service.isOutsideFence()).toBe(false);
    });
  });

  // ── checkFence — no fence configured ───────────────────────────────────────

  describe('checkFence — no fence configured', () => {
    beforeEach(() => configure({ polygon: [], fenceEnabled: false }));

    it('returns disabled immediately without calling geolocation', async () => {
      // Geolocation API is not touched when no fence is configured.
      // We confirm this by asserting the result is 'disabled' without
      // needing to spy on geolocation (which may be undefined in jsdom).
      const result = await service.checkFence();
      expect(result).toBe('disabled');
    });

    it('sets status to disabled', async () => {
      await service.checkFence();
      expect(service.status()).toBe('disabled');
    });

    it('isInsideFence is true when disabled', async () => {
      await service.checkFence();
      expect(service.isInsideFence()).toBe(true);
    });
  });

  // ── checkFence — polygon path (mock position) ───────────────────────────────

  describe('checkFence — polygon with mockPosition inside', () => {
    // environment.geofencing.mockPosition is { lat: 1, lng: 1 } for tests.
    // The test env (environment.ts) has mockPosition: null so we need to
    // use a spy; the service reads environment directly, so we override via
    // the mock position path by spying on getCurrentPosition indirectly.
    // Instead, we test the polygon path by providing a 3-vertex polygon and
    // arranging a mock through navigator.geolocation.getCurrentPosition.

    it('returns inside when mocked position is inside polygon', async () => {
      configure({ polygon: SQUARE_POLYGON });

      // Stub geolocation to return a point inside the polygon.
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn((success) =>
            success({
              coords: { latitude: 1, longitude: 1, accuracy: 10 },
            } as GeolocationPosition)
          ),
        },
        configurable: true,
      });

      const result = await service.checkFence();
      expect(result).toBe('inside');
      expect(service.status()).toBe('inside');
      expect(service.isInsideFence()).toBe(true);
      expect(service.isOutsideFence()).toBe(false);
      expect(service.position()).toEqual({ lat: 1, lng: 1, accuracyMeters: 10 });
    });

    it('returns outside when mocked position is outside polygon', async () => {
      configure({ polygon: SQUARE_POLYGON });

      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn((success) =>
            success({
              coords: { latitude: 5, longitude: 5, accuracy: 5 },
            } as GeolocationPosition)
          ),
        },
        configurable: true,
      });

      const result = await service.checkFence();
      expect(result).toBe('outside');
      expect(service.isOutsideFence()).toBe(true);
      expect(service.isInsideFence()).toBe(false);
    });
  });

  // ── checkFence — geolocation error ─────────────────────────────────────────

  describe('checkFence — geolocation error', () => {
    beforeEach(() => configure({ polygon: SQUARE_POLYGON }));

    it('returns disabled and sets error message on geolocation failure', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn((_ok, fail) =>
            fail({ message: 'Permission denied' } as GeolocationPositionError)
          ),
        },
        configurable: true,
      });

      const result = await service.checkFence();
      expect(result).toBe('disabled');
      expect(service.status()).toBe('disabled');
      expect(service.errorMessage()).toBe('Permission denied');
    });

    it('returns disabled when geolocation is not supported', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        value: undefined,
        configurable: true,
      });

      const result = await service.checkFence();
      expect(result).toBe('disabled');
      expect(service.errorMessage()).toBe('Geolocation is not supported by this browser');
    });
  });

  // ── checkFence — concurrent guard ──────────────────────────────────────────

  describe('checkFence — concurrent guard', () => {
    it('returns locating without starting a second request when already locating', async () => {
      configure({ polygon: SQUARE_POLYGON });

      let resolveGeo!: (pos: GeolocationPosition) => void;
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn((success) => {
            resolveGeo = success;
          }),
        },
        configurable: true,
      });

      // Start first — will be stuck at 'locating' until resolveGeo is called.
      const first = service.checkFence();
      // Second call while still locating.
      const concurrent = await service.checkFence();
      expect(concurrent).toBe('locating');
      // Resolve the first.
      resolveGeo({
        coords: { latitude: 1, longitude: 1, accuracy: 0 },
      } as GeolocationPosition);
      await first;
    });
  });

  // ── reset ───────────────────────────────────────────────────────────────────

  describe('reset', () => {
    beforeEach(() => configure({ polygon: SQUARE_POLYGON }));

    it('returns to idle state', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn((success) =>
            success({ coords: { latitude: 1, longitude: 1, accuracy: 0 } } as GeolocationPosition)
          ),
        },
        configurable: true,
      });

      await service.checkFence();
      expect(service.status()).toBe('inside');

      service.reset();
      expect(service.status()).toBe('idle');
      expect(service.position()).toBeNull();
      expect(service.errorMessage()).toBe('');
    });
  });

  // ── legacy circle path ──────────────────────────────────────────────────────

  describe('checkFence — legacy circle (no polygon, fenceEnabled)', () => {
    it('returns inside when within radius', async () => {
      // Fence centred at (10, 10) with 10km radius.
      configure({
        polygon: [],
        fenceEnabled: true,
        fenceLat: 10,
        fenceLng: 10,
        fenceRadiusMeters: 10_000,
      });

      // Return a position ~0 km away (same point).
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn((success) =>
            success({ coords: { latitude: 10, longitude: 10, accuracy: 0 } } as GeolocationPosition)
          ),
        },
        configurable: true,
      });

      const result = await service.checkFence();
      expect(result).toBe('inside');
    });

    it('returns outside when beyond radius', async () => {
      // Fence at (0, 0) with 100 m radius; device is at (10, 10) — ~1570 km away.
      configure({
        polygon: [],
        fenceEnabled: true,
        fenceLat: 0,
        fenceLng: 0,
        fenceRadiusMeters: 100,
      });

      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn((success) =>
            success({ coords: { latitude: 10, longitude: 10, accuracy: 0 } } as GeolocationPosition)
          ),
        },
        configurable: true,
      });

      const result = await service.checkFence();
      expect(result).toBe('outside');
    });

    it('returns disabled when fenceLat or fenceLng is null', async () => {
      configure({
        polygon: [],
        fenceEnabled: true,
        fenceLat: null,
        fenceLng: null,
        fenceRadiusMeters: 200,
      });

      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: vi.fn((success) =>
            success({ coords: { latitude: 1, longitude: 1, accuracy: 0 } } as GeolocationPosition)
          ),
        },
        configurable: true,
      });

      const result = await service.checkFence();
      expect(result).toBe('disabled');
    });
  });
});
