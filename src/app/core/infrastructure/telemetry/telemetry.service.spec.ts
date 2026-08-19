import { Measure, TelemetryService } from './telemetry.service';

/**
 * Unit tests for TelemetryService. Previously untested (mocked everywhere); now
 * imported by PosFacade, so it needs real coverage. The service is in-memory
 * metric/event aggregation.
 */
describe('TelemetryService', () => {
  let svc: TelemetryService;

  beforeEach(() => {
    svc = new TelemetryService();
    svc.stopMonitoring(); // stop the constructor's 5s interval during tests
  });

  afterEach(() => {
    svc.stopMonitoring();
  });

  describe('recording + summaries', () => {
    it('recordCounter defaults value to 1 and aggregates', () => {
      svc.recordCounter('hits');
      svc.recordCounter('hits', 4);
      const s = svc.getMetricSummary('hits');
      expect(s).not.toBeNull();
      expect(s!.count).toBe(2);
      expect(s!.sum).toBe(5);
      expect(s!.min).toBe(1);
      expect(s!.max).toBe(4);
      expect(s!.avg).toBe(2.5);
      expect(s!.lastValue).toBe(4);
    });

    it('records gauge + histogram and computes percentiles', () => {
      for (const v of [10, 20, 30, 40, 50]) svc.recordHistogram('latency', v);
      const s = svc.getMetricSummary('latency')!;
      expect(s.count).toBe(5);
      expect(s.p50).toBe(30);
      expect(s.p95).toBe(50);
      expect(s.p99).toBe(50);
      svc.recordGauge('temp', 21, undefined, 'C');
      expect(svc.getMetricSummary('temp')!.lastValue).toBe(21);
    });

    it('returns null for an unknown metric', () => {
      expect(svc.getMetricSummary('nope')).toBeNull();
    });

    it('keys metrics by sorted tags (same name, different tags are distinct)', () => {
      svc.recordCounter('req', 1, { method: 'cash' });
      svc.recordCounter('req', 1, { method: 'card' });
      svc.recordCounter('req', 1, { method: 'cash' });
      expect(svc.getMetricSummary('req', { method: 'cash' })!.count).toBe(2);
      expect(svc.getMetricSummary('req', { method: 'card' })!.count).toBe(1);
      // No-tags query is a different key.
      expect(svc.getMetricSummary('req')).toBeNull();
    });

    it('getAllMetricSummaries returns one entry per metric key', () => {
      svc.recordCounter('a');
      svc.recordGauge('b', 2);
      const all = svc.getAllMetricSummaries();
      expect(Object.keys(all).sort()).toEqual(['a', 'b']);
    });

    it('trims data points beyond the max (1000)', () => {
      for (let i = 0; i < 1005; i++) svc.recordCounter('flood');
      expect(svc.getMetricSummary('flood')!.count).toBe(1000);
    });

    it('clearMetrics(name) removes one; clearMetrics() removes all', () => {
      svc.recordCounter('x');
      svc.recordCounter('y');
      svc.clearMetrics('x');
      expect(svc.getMetricSummary('x')).toBeNull();
      expect(svc.getMetricSummary('y')).not.toBeNull();
      svc.clearMetrics();
      expect(svc.getMetricSummary('y')).toBeNull();
    });
  });

  describe('events', () => {
    it('tracks events with and without properties and lists recent', () => {
      svc.trackEvent('login', { user: 'a' }, { ms: 5 });
      svc.trackEvent('logout');
      expect(svc.getRecentEvents()).toHaveLength(2);
      expect(svc.getRecentEvents(1)).toHaveLength(1);
    });

    it('filters events by name (with and without limit)', () => {
      svc.trackEvent('sale');
      svc.trackEvent('sale');
      svc.trackEvent('refund');
      expect(svc.getEventsByName('sale')).toHaveLength(2);
      expect(svc.getEventsByName('sale', 1)).toHaveLength(1);
      expect(svc.getEventsByName('missing')).toHaveLength(0);
    });

    it('trims events beyond the max (500) and clearEvents empties them', () => {
      for (let i = 0; i < 505; i++) svc.trackEvent('e');
      expect(svc.getRecentEvents().length).toBe(500);
      svc.clearEvents();
      expect(svc.getRecentEvents()).toHaveLength(0);
    });
  });

  describe('timers + measureAsync', () => {
    it('startTimer records a timer metric when stopped', () => {
      const stop = svc.startTimer('op');
      stop();
      expect(svc.getMetricSummary('op')!.count).toBe(1);
    });

    it('measureAsync records on success', async () => {
      const out = await svc.measureAsync('work', async () => 42);
      expect(out).toBe(42);
      expect(svc.getMetricSummary('work')!.count).toBe(1);
    });

    it('measureAsync records an error counter and rethrows on failure', async () => {
      await expect(
        svc.measureAsync('work', async () => Promise.reject(new Error('boom')))
      ).rejects.toThrow('boom');
      expect(svc.getMetricSummary('work.error')!.count).toBe(1);
    });
  });

  describe('system metrics', () => {
    it('includes memory when performance.memory is available, omits it otherwise', () => {
      const perf = performance as unknown as { memory?: unknown };
      const original = perf.memory;
      perf.memory = { usedJSHeapSize: 50, totalJSHeapSize: 200 };
      const withMem = svc.getSystemMetrics();
      expect(withMem.memory).toEqual({ used: 50, total: 200, percentage: 25 });

      delete perf.memory;
      expect(svc.getSystemMetrics().memory).toBeUndefined();
      if (original !== undefined) perf.memory = original;
    });

    it('exportMetrics produces JSON with metrics + events', () => {
      svc.recordCounter('a');
      svc.trackEvent('e');
      const parsed = JSON.parse(svc.exportMetrics());
      expect(parsed.metrics.a).toBeDefined();
      expect(parsed.events).toHaveLength(1);
    });
  });

  describe('watching the system', () => {
    it('samples memory on a timer and records it as gauges', () => {
      // The dashboard's memory panel is fed from here; without the timer it would
      // show whatever was true the moment the page opened.
      vi.useFakeTimers();
      const perf = performance as unknown as {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
      };
      const original = perf.memory;
      perf.memory = { usedJSHeapSize: 40, totalJSHeapSize: 100 };
      const monitored = new TelemetryService();

      vi.advanceTimersByTime(5000);

      expect(monitored.getMetricSummary('system.memory.used')?.lastValue).toBe(40);
      expect(monitored.getMetricSummary('system.memory.percentage')?.lastValue).toBe(40);

      monitored.stopMonitoring();
      if (original === undefined) {
        delete perf.memory;
      } else {
        perf.memory = original;
      }
      vi.useRealTimers();
    });

    it('records nothing where the browser reports no memory at all', () => {
      // Firefox and Safari have no `performance.memory`; a gauge of undefined would
      // draw a chart of NaN.
      vi.useFakeTimers();
      const perf = performance as unknown as { memory?: unknown };
      const original = perf.memory;
      delete perf.memory;
      const monitored = new TelemetryService();

      vi.advanceTimersByTime(5000);

      expect(monitored.getMetricSummary('system.memory.used')).toBeNull();

      monitored.stopMonitoring();
      if (original !== undefined) {
        perf.memory = original;
      }
      vi.useRealTimers();
    });

    it('stops sampling when told to, and does not mind being told twice', () => {
      vi.useFakeTimers();
      const monitored = new TelemetryService();

      monitored.stopMonitoring();
      monitored.stopMonitoring();
      vi.advanceTimersByTime(20_000);

      // A service that keeps sampling after shutdown is a leak with a heartbeat.
      expect(monitored.getMetricSummary('system.memory.used')).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('the @Measure decorator', () => {
    /** Applied by hand rather than with `@`, so the test says exactly what it does. */
    function decorate(
      name: string | undefined,
      className: string,
      method: string,
      impl: () => Promise<unknown>
    ) {
      const descriptor: PropertyDescriptor = { value: impl };
      Measure(name)({ constructor: { name: className } }, method, descriptor);
      return descriptor.value as () => Promise<unknown>;
    }

    it('names the metric after the class and method by default', async () => {
      vi.useFakeTimers();
      const measureAsync = vi.spyOn(TelemetryService.prototype, 'measureAsync');

      const find = decorate(undefined, 'ProductRepository', 'findAll', async () => 'rows');

      await expect(find()).resolves.toBe('rows');
      expect(measureAsync).toHaveBeenCalledWith('ProductRepository.findAll', expect.any(Function));
      measureAsync.mockRestore();
      vi.useRealTimers();
    });

    it('uses the name it was given when there is one', async () => {
      vi.useFakeTimers();
      const measureAsync = vi.spyOn(TelemetryService.prototype, 'measureAsync');

      const run = decorate('checkout.total', 'PosFacade', 'total', async () => 12);

      await expect(run()).resolves.toBe(12);
      expect(measureAsync).toHaveBeenCalledWith('checkout.total', expect.any(Function));
      measureAsync.mockRestore();
      vi.useRealTimers();
    });
  });
});
