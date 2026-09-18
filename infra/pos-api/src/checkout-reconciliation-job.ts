import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { CheckoutService } from './checkout-service.ts';
import type { DueCheckoutReader } from './checkout-store.ts';
import { buildCheckoutJobRuntime, positiveIntegerEnvironment } from './checkout-job-runtime.ts';
import {
  CheckoutReconciliationWorker,
  type CheckoutReconciliationFailure,
} from './checkout-reconciliation-worker.ts';

interface CheckoutReconciliationJobDeps {
  readonly buildRuntime: (environment: Readonly<Record<string, string | undefined>>) => {
    readonly dueCheckouts: DueCheckoutReader;
    readonly service: CheckoutService;
  };
  readonly nowIso: () => string;
  readonly monotonicNowMs: () => number;
  readonly newId: () => string;
  readonly log: (message: string, details: unknown) => void;
  readonly reportFailure: (failure: {
    readonly checkoutId: string;
    readonly error: string;
  }) => void;
}

const defaultDeps: CheckoutReconciliationJobDeps = {
  buildRuntime: buildCheckoutJobRuntime,
  nowIso: () => new Date().toISOString(),
  monotonicNowMs: () => performance.now(),
  newId: randomUUID,
  log: console.log,
  reportFailure: (failure) => console.error('[pos-api] checkout reconciliation failed', failure),
};

export async function runCheckoutReconciliationJob(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  deps: CheckoutReconciliationJobDeps = defaultDeps
): Promise<void> {
  const runtime = deps.buildRuntime(environment);
  const worker = new CheckoutReconciliationWorker({
    dueCheckouts: runtime.dueCheckouts,
    reconciler: runtime.service,
    ownerId: `checkout-worker:${deps.newId()}`,
    nowIso: deps.nowIso,
    monotonicNowMs: deps.monotonicNowMs,
    newId: deps.newId,
    reportFailure: (failure) => deps.reportFailure(safeFailure(failure)),
  });
  const result = await worker.run({
    maxCheckouts: positiveIntegerEnvironment(
      environment,
      'CHECKOUT_WORKER_MAX_CHECKOUTS',
      100,
      1000
    ),
    pageSize: positiveIntegerEnvironment(environment, 'CHECKOUT_WORKER_PAGE_SIZE', 50, 100),
    maxDurationMs: positiveIntegerEnvironment(
      environment,
      'CHECKOUT_WORKER_MAX_DURATION_MS',
      240_000,
      900_000
    ),
  });
  deps.log('[pos-api] checkout reconciliation complete', result);
  if (result.failed > 0 || result.failureReportsDropped > 0) {
    throw new Error('Checkout reconciliation completed with isolated failures.');
  }
}

function safeFailure(failure: CheckoutReconciliationFailure): {
  readonly checkoutId: string;
  readonly error: string;
} {
  return {
    checkoutId: failure.checkoutId,
    error: failure.error instanceof Error ? failure.error.name : 'UnknownError',
  };
}

if (process.env['NODE_ENV'] !== 'test') {
  await runCheckoutReconciliationJob();
}
