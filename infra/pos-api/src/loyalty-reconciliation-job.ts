import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildLoyaltyJobRuntime } from './loyalty-job-runtime.ts';
import type { LoyaltyReconciliationRuntime } from './loyalty-reconciliation-runtime.ts';
import {
  LoyaltyReconciliationWorker,
  type LoyaltyReconciliationFailure,
} from './loyalty-reconciliation-worker.ts';

export interface LoyaltyReconciliationJobDeps {
  readonly buildRuntime: (
    environment: Readonly<Record<string, string | undefined>>,
    nowIso: () => string
  ) => LoyaltyReconciliationRuntime;
  readonly nowIso: () => string;
  readonly monotonicNowMs: () => number;
  readonly newId: () => string;
  readonly log: (message: string, details: unknown) => void;
  readonly reportFailure: (failure: {
    readonly checkoutId: string;
    readonly error: string;
  }) => void;
}

const defaultDeps: LoyaltyReconciliationJobDeps = {
  buildRuntime: buildLoyaltyJobRuntime,
  nowIso: () => new Date().toISOString(),
  monotonicNowMs: () => performance.now(),
  newId: randomUUID,
  log: console.log,
  reportFailure: (failure) => console.error('[pos-api] loyalty reconciliation failed', failure),
};

/** Separate scheduled entrypoint from payment reconciliation. */
export async function runLoyaltyReconciliationJob(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  deps: LoyaltyReconciliationJobDeps = defaultDeps
): Promise<void> {
  const runtime = deps.buildRuntime(environment, deps.nowIso);
  const worker = new LoyaltyReconciliationWorker({
    dueCheckouts: runtime.dueCheckouts,
    reconciler: runtime.reconciler,
    ownerId: `loyalty-worker:${deps.newId()}`,
    nowIso: deps.nowIso,
    monotonicNowMs: deps.monotonicNowMs,
    newId: deps.newId,
    reportFailure: (failure) => deps.reportFailure(safeFailure(failure)),
  });
  const result = await worker.run({
    maxCheckouts: positiveIntegerEnvironment(
      environment,
      'LOYALTY_WORKER_MAX_CHECKOUTS',
      100,
      1_000
    ),
    pageSize: positiveIntegerEnvironment(environment, 'LOYALTY_WORKER_PAGE_SIZE', 50, 100),
    maxDurationMs: positiveIntegerEnvironment(
      environment,
      'LOYALTY_WORKER_MAX_DURATION_MS',
      240_000,
      900_000
    ),
  });
  deps.log('[pos-api] loyalty reconciliation complete', result);
  if (result.failed > 0 || result.failureReportsDropped > 0) {
    throw new Error('Loyalty reconciliation completed with isolated failures.');
  }
}

export const defaultLoyaltyReconciliationClock = Object.freeze({
  nowIso: () => new Date().toISOString(),
  monotonicNowMs: () => performance.now(),
  newId: randomUUID,
});

function safeFailure(failure: LoyaltyReconciliationFailure): {
  readonly checkoutId: string;
  readonly error: string;
} {
  return {
    checkoutId: failure.checkoutId,
    error: failure.error instanceof Error ? failure.error.name : 'UnknownError',
  };
}

function positiveIntegerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum: number
): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

if (process.env['NODE_ENV'] !== 'test') {
  await runLoyaltyReconciliationJob();
}
