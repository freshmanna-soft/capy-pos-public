import { buildCircuitBreakerView, sumSkippedRecords } from './agent-monitor.component';
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
