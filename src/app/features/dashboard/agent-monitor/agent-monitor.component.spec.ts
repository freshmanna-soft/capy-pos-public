import { sumSkippedRecords } from './agent-monitor.component';
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
