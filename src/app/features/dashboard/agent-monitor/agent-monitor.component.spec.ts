import {
  buildCircuitBreakerView,
  buildEventBusView,
  buildMetricsView,
  buildRecentAuditView,
  sumSkippedRecords,
} from './agent-monitor.component';
import {
  CircuitBreakerStats,
  CircuitState,
} from '@core/infrastructure/resilience/circuit-breaker.service';
import { WorkerCircuitState } from '@core/infrastructure/sync/sync.types';
import {
  MetricSummary,
  MetricType,
  REPOSITORY_RECORDS_SKIPPED_METRIC,
} from '@core/infrastructure/telemetry/telemetry.service';
import {
  AuditAction,
  AuditLogEntry,
  AuditStatus,
} from '@core/infrastructure/audit/audit-log.service';

/**
 * Coverage for the dashboard's skipped-records aggregation (#111). The Skipped
 * Records tile sums the `repository.records.skipped` counter across every
 * entity tag; it must read the total records dropped (`sum`), not the number of
 * skip events (`count`), and ignore unrelated metrics.
 */
function summary(name: string, sum: number): MetricSummary {
  return {
    name,
    type: MetricType.COUNTER,
    count: 1,
    sum,
    min: sum,
    max: sum,
    avg: sum,
    lastValue: sum,
    lastUpdated: new Date(),
  };
}

describe('sumSkippedRecords', () => {
  it('returns 0 when there are no metrics', () => {
    expect(sumSkippedRecords({})).toBe(0);
  });

  it('returns 0 when no skipped-records counter is present', () => {
    const metrics = { 'payments.processed': summary('payments.processed', 12) };
    expect(sumSkippedRecords(metrics)).toBe(0);
  });

  it('sums total dropped records across entity tags, ignoring other metrics', () => {
    const metrics = {
      [`${REPOSITORY_RECORDS_SKIPPED_METRIC}{entity:product}`]: summary(
        REPOSITORY_RECORDS_SKIPPED_METRIC,
        3
      ),
      [`${REPOSITORY_RECORDS_SKIPPED_METRIC}{entity:customer}`]: summary(
        REPOSITORY_RECORDS_SKIPPED_METRIC,
        2
      ),
      'payments.processed': summary('payments.processed', 99),
    };
    expect(sumSkippedRecords(metrics)).toBe(5);
  });
});

/**
 * Coverage for the circuit-breaker panel's data assembly (#95). The panel merges
 * main-thread breakers (e.g. the 'payment-gateway' breaker the checkout trips)
 * with a synthetic 'api-sync' breaker derived from SyncService signals, because
 * the real sync breaker lives off the main thread in the sync web worker.
 */
function paymentGatewayStats(state: CircuitState): CircuitBreakerStats {
  return {
    state,
    failures: 5,
    successes: 0,
    consecutiveFailures: 5,
    consecutiveSuccesses: 0,
    totalCalls: 5,
    totalFailures: 5,
    totalSuccesses: 0,
  };
}

const idleSync = {
  isRunning: false,
  circuitState: WorkerCircuitState.CLOSED,
  totalSyncs: 0,
  totalFailures: 0,
};

describe('buildCircuitBreakerView', () => {
  it('returns an empty view when there are no breakers and sync is idle', () => {
    expect(buildCircuitBreakerView({}, idleSync)).toEqual({});
  });

  it('passes main-thread breakers through unchanged (e.g. payment-gateway OPEN)', () => {
    const view = buildCircuitBreakerView(
      { 'payment-gateway': paymentGatewayStats(CircuitState.OPEN) },
      idleSync
    );
    expect(Object.keys(view)).toEqual(['payment-gateway']);
    expect(view['payment-gateway'].state).toBe(CircuitState.OPEN);
    expect(view['api-sync']).toBeUndefined();
  });

  it('does not mutate the supplied main-thread stats', () => {
    const mainThread = { 'payment-gateway': paymentGatewayStats(CircuitState.CLOSED) };
    buildCircuitBreakerView(mainThread, {
      ...idleSync,
      isRunning: true,
      totalSyncs: 3,
    });
    expect(Object.keys(mainThread)).toEqual(['payment-gateway']);
  });

  it('appends the api-sync breaker when the sync worker is running', () => {
    const view = buildCircuitBreakerView(
      {},
      {
        isRunning: true,
        circuitState: WorkerCircuitState.HALF_OPEN,
        totalSyncs: 7,
        totalFailures: 2,
      }
    );
    const apiSync = view['api-sync'];
    expect(apiSync).toBeDefined();
    // Worker enum is mapped onto the main-thread CircuitState enum.
    expect(apiSync.state).toBe(CircuitState.HALF_OPEN);
    // Counts reflect completed sync cycles: successes + failures.
    expect(apiSync.totalSuccesses).toBe(7);
    expect(apiSync.totalFailures).toBe(2);
    expect(apiSync.totalCalls).toBe(9);
  });

  it('omits the api-sync breaker when the sync worker is not running', () => {
    const view = buildCircuitBreakerView(
      { 'payment-gateway': paymentGatewayStats(CircuitState.CLOSED) },
      { ...idleSync, totalSyncs: 4, totalFailures: 1 }
    );
    expect(view['api-sync']).toBeUndefined();
  });

  it('surfaces both the payment-gateway and api-sync breakers together', () => {
    const view = buildCircuitBreakerView(
      { 'payment-gateway': paymentGatewayStats(CircuitState.OPEN) },
      {
        isRunning: true,
        circuitState: WorkerCircuitState.OPEN,
        totalSyncs: 0,
        totalFailures: 3,
      }
    );
    expect(Object.keys(view).sort()).toEqual(['api-sync', 'payment-gateway']);
    expect(view['api-sync'].state).toBe(CircuitState.OPEN);
    expect(view['api-sync'].totalCalls).toBe(3);
  });
});

/**
 * Coverage for the Metrics panel's data assembly (#96). TelemetryService keys
 * metrics by name plus sorted tags (e.g. 'payments.processed{method:cash}');
 * the panel splits that opaque key into a readable name + tag chip and renders a
 * stable, name-sorted list. This is the presentation-side counterpart to the
 * `payments.processed` metric-card the agent-integration e2e asserts.
 */
describe('buildMetricsView', () => {
  it('returns an empty list when there are no metrics', () => {
    expect(buildMetricsView({})).toEqual([]);
  });

  it('splits a tagged metric key into a name and a human tag string', () => {
    const [row] = buildMetricsView({
      'payments.processed{method:cash}': summary('payments.processed', 3),
    });
    expect(row.key).toBe('payments.processed{method:cash}');
    expect(row.name).toBe('payments.processed');
    expect(row.tags).toBe('method:cash');
    expect(row.summary.count).toBe(1);
  });

  it('leaves an untagged metric key as its name with empty tags', () => {
    const [row] = buildMetricsView({
      'system.memory.used': summary('system.memory.used', 1024),
    });
    expect(row.name).toBe('system.memory.used');
    expect(row.tags).toBe('');
  });

  it('renders multiple tags as a comma-separated list', () => {
    const [row] = buildMetricsView({
      'orders.placed{channel:web,method:card}': summary('orders.placed', 5),
    });
    expect(row.name).toBe('orders.placed');
    expect(row.tags).toBe('channel:web, method:card');
  });

  it('sorts rows by name, then by tags, regardless of insertion order', () => {
    const view = buildMetricsView({
      'payments.processed{method:card}': summary('payments.processed', 1),
      'orders.placed': summary('orders.placed', 1),
      'payments.processed{method:cash}': summary('payments.processed', 1),
    });
    expect(view.map((r) => r.key)).toEqual([
      'orders.placed',
      'payments.processed{method:card}',
      'payments.processed{method:cash}',
    ]);
  });
});

/**
 * Coverage for the Event Bus Activity panel's data assembly (#98).
 * EventBusService.getStatistics() returns count maps with undefined key order;
 * the panel turns each into rows sorted by count descending (label ascending as
 * a tie-breaker) so the busiest types/sources/priorities surface first. This is
 * the presentation-side counterpart to the event-bus-stats panel the
 * agent-integration e2e asserts after a sale.
 */
describe('buildEventBusView', () => {
  const emptyStats = {
    totalMessages: 0,
    byType: {},
    bySource: {},
    byPriority: {},
  };

  it('returns empty breakdown lists when there are no messages', () => {
    expect(buildEventBusView(emptyStats)).toEqual({
      totalMessages: 0,
      byType: [],
      bySource: [],
      byPriority: [],
    });
  });

  it('passes the total message count through unchanged', () => {
    const view = buildEventBusView({ ...emptyStats, totalMessages: 42 });
    expect(view.totalMessages).toBe(42);
  });

  it('sorts each breakdown by count descending so the busiest channel is first', () => {
    const view = buildEventBusView({
      totalMessages: 6,
      byType: { 'inventory.updated': 1, 'sale.completed': 4, 'cart.item.added': 1 },
      bySource: {},
      byPriority: {},
    });
    expect(view.byType.map((r) => r.label)).toEqual([
      'sale.completed',
      // Ties (count 1) fall back to alphabetical label order.
      'cart.item.added',
      'inventory.updated',
    ]);
    expect(view.byType[0]).toEqual({ label: 'sale.completed', count: 4 });
  });

  it('breaks count ties alphabetically by label, regardless of insertion order', () => {
    const view = buildEventBusView({
      ...emptyStats,
      bySource: { PosFacade: 2, InventoryService: 2, SyncService: 2 },
    });
    expect(view.bySource.map((r) => r.label)).toEqual([
      'InventoryService',
      'PosFacade',
      'SyncService',
    ]);
  });

  it('builds priority rows the same way as the other breakdowns', () => {
    const view = buildEventBusView({
      ...emptyStats,
      byPriority: { low: 1, high: 3, normal: 2 },
    });
    expect(view.byPriority.map((r) => r.label)).toEqual(['high', 'normal', 'low']);
  });
});

/**
 * Coverage for the Recent Audit Logs panel's data assembly (#97).
 * AuditLogService.getRecentLogs() returns its cache oldest-first; the panel
 * flips that to newest-first (id as a stable tie-breaker) and caps the list, so
 * the just-written entry — e.g. the processPayment entry the agent-integration
 * e2e asserts after a sale — sits at the top rather than the bottom.
 */
describe('buildRecentAuditView', () => {
  function entry(id: string, operation: string, timestamp: Date): AuditLogEntry {
    return {
      id,
      timestamp,
      agentName: 'PaymentAgent',
      operation,
      entityType: 'Transaction',
      entityId: id,
      action: AuditAction.EXECUTE,
      status: AuditStatus.SUCCESS,
    };
  }

  it('returns an empty list when there are no entries', () => {
    expect(buildRecentAuditView([])).toEqual([]);
  });

  it('orders entries newest first regardless of cache order', () => {
    const oldest = entry('audit-1', 'openCart', new Date('2026-07-26T10:00:00Z'));
    const newest = entry('audit-3', 'processPayment', new Date('2026-07-26T10:00:02Z'));
    const middle = entry('audit-2', 'addItem', new Date('2026-07-26T10:00:01Z'));

    // Supplied oldest-first, as AuditLogService.getRecentLogs() returns them.
    const view = buildRecentAuditView([oldest, middle, newest]);

    expect(view.map((e) => e.operation)).toEqual(['processPayment', 'addItem', 'openCart']);
  });

  it('breaks timestamp ties by id descending (monotonic sequence order)', () => {
    const sameTime = new Date('2026-07-26T10:00:00Z');
    const first = entry('audit-000001', 'first', sameTime);
    const second = entry('audit-000002', 'second', sameTime);

    const view = buildRecentAuditView([first, second]);

    expect(view.map((e) => e.operation)).toEqual(['second', 'first']);
  });

  it('keeps only the newest `limit` entries', () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      entry(`audit-${i}`, `op${i}`, new Date(2026, 6, 26, 10, 0, i))
    );

    const view = buildRecentAuditView(entries, 10);

    expect(view).toHaveLength(10);
    // Newest (op14) first; the oldest five (op0–op4) are dropped.
    expect(view[0].operation).toBe('op14');
    expect(view.at(-1)?.operation).toBe('op5');
  });

  it('defaults to the newest 10 entries when no limit is given', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      entry(`audit-${i}`, `op${i}`, new Date(2026, 6, 26, 10, 0, i))
    );

    expect(buildRecentAuditView(entries)).toHaveLength(10);
  });

  it('does not mutate the supplied array', () => {
    const entries = [
      entry('audit-1', 'first', new Date('2026-07-26T10:00:00Z')),
      entry('audit-2', 'second', new Date('2026-07-26T10:00:01Z')),
    ];
    const originalOrder = entries.map((e) => e.id);

    buildRecentAuditView(entries);

    expect(entries.map((e) => e.id)).toEqual(originalOrder);
  });
});
