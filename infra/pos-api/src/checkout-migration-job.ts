import { buildCheckoutMigrationRuntime } from './checkout-job-runtime.ts';
import { migrateCheckoutDatabase } from './checkout-migration.ts';

export async function runCheckoutMigrationJob(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  log: (message: string, details: unknown) => void = console.log
): Promise<void> {
  const runtime = buildCheckoutMigrationRuntime(environment);
  const result = await migrateCheckoutDatabase(runtime.checkoutStore, runtime.checkoutDatabase);
  log('[pos-api] checkout migration complete', result);
}

if (process.env['NODE_ENV'] !== 'test') {
  await runCheckoutMigrationJob();
}
