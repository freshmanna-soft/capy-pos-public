import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors, HTTP_INTERCEPTORS } from '@angular/common/http';

import { routes } from '@app/app.routes';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import {
  REPOSITORY_PROVIDERS,
  TRANSACTION_REPOSITORY,
} from '@core/infrastructure/factories/repository.factory';
import { VISION_PROVIDERS } from '@core/infrastructure/vision/vision.factory';
import { CLERK_AGENT_PROVIDERS } from '@core/infrastructure/agent/clerk-agent.factory';
import { INVENTORY_AGENT_PROVIDERS } from '@app/agents/inventory/infrastructure';
import { SALES_AGENT_PROVIDERS } from '@app/agents/sales/infrastructure';
import { PAYMENT_AGENT_PROVIDER } from '@app/agents/payment/infrastructure/payment-agent.provider';
import { AgentRegistry } from '@app/agents/agent.registry';
import { SyncService, SyncSessionCredentialService } from '@core/infrastructure/sync';
import { AUTH_PROVIDERS } from '@core/infrastructure/auth/auth.providers';
import { SessionExpiryNavigatorService } from '@core/infrastructure/auth/session-expiry-navigator.service';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { ThemeService } from '@core/application/services/theme.service';
import { OtlpExporterService } from '@core/infrastructure/telemetry/otlp-exporter.service';
import { TraceContextInterceptor } from '@core/infrastructure/telemetry/trace-context.interceptor';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([])),
    {
      provide: HTTP_INTERCEPTORS,
      useClass: TraceContextInterceptor,
      multi: true,
    },
    // Initialize OpenTelemetry OTLP exporter (before DB init so traces are captured early)
    provideAppInitializer(() => {
      inject(OtlpExporterService);
    }),
    provideAppInitializer(async () => {
      const db = inject(DexieDatabase);
      try {
        await db.open();
        console.log('Dexie database opened successfully');

        await db.initializeWithSeedData();
        console.log('Database initialized with seed data');

        const stats = await db.getStats();
        console.log('Database statistics:', stats);
      } catch (error) {
        console.error('Failed to initialize Dexie database:', error);
        throw error;
      }
    }),
    // Apply the persisted UI theme AFTER the DB is open so the correct
    // light/dark mode is active before the first render (avoids a flash).
    provideAppInitializer(async () => {
      const theme = inject(ThemeService);
      try {
        await theme.loadTheme();
      } catch (error) {
        // Non-fatal — falls back to the default light theme.
        console.warn('Theme load failed (using default):', error);
      }
    }),
    // Registers the effect that redirects to /login the moment a session's
    // expiry timer fires — without it, an already-open tab keeps showing a
    // protected route until the next navigation happens to re-run authGuard.
    // Its own initializer, and `inject()` called before any `await`: crossing
    // an await inside an async initializer drops the injection context
    // (NG0203), which is exactly what broke here the first time — injecting
    // it at the tail of the hydrate initializer below, after its own
    // `await currentUser.hydrate()`, failed on every route in a real browser
    // while every unit test (a synchronous TestBed injection) stayed green.
    provideAppInitializer(() => {
      inject(SessionExpiryNavigatorService);
    }),
    // Rehydrate existing session AFTER the DB is open so the JWT gateway
    // can resolve the operator record if needed. Runs before routing resolves.
    provideAppInitializer(async () => {
      const currentUser = inject(CurrentUserService);
      try {
        await currentUser.hydrate();
        console.log('Session hydrated:', currentUser.isAuthenticated());
      } catch (error) {
        // Non-fatal — user will be redirected to /login by authGuard
        console.warn('Session hydration failed (will require login):', error);
      }
    }),
    provideAppInitializer(async () => {
      const registry = inject(AgentRegistry);
      try {
        console.log('Initializing agents via AgentRegistry...');

        await registry.initializeAll();
        await registry.startAll();

        const stats = registry.getStatistics();
        console.log('Agent statistics:', stats);

        const allHealthy = await registry.areAllHealthy();
        console.log('All agents healthy:', allHealthy);
      } catch (error) {
        console.error('Failed to initialize agents:', error);
        throw error;
      }
    }),
    // Repository providers with dependency injection
    ...REPOSITORY_PROVIDERS,
    // String-based token alias for PersistTransactionUseCase compatibility
    {
      provide: 'ITransactionRepository',
      useExisting: TRANSACTION_REPOSITORY,
    },
    // AI clerk recognizer — mock or Claude, chosen by environment.features.aiVision
    ...VISION_PROVIDERS,
    // AI clerk agent — the mock today; environment.features.clerkAgent selects the relay
    ...CLERK_AGENT_PROVIDERS,
    // Agent providers
    ...INVENTORY_AGENT_PROVIDERS,
    ...SALES_AGENT_PROVIDERS,
    PAYMENT_AGENT_PROVIDER,
    // Auth providers (local credential adapter — swap for Cognito in Story #42)
    ...AUTH_PROVIDERS,
    // Background sync worker (syncs local Dexie ↔ the pos-api sync backend).
    // Runs after session hydration above so a returning operator's token is already
    // resolved and the first pull goes out authorized.
    provideAppInitializer(() => {
      const syncService = inject(SyncService);
      // Injecting this registers the effect that pushes the session token to the
      // worker on every sign-in, sign-out and re-issue (#224).
      const credential = inject(SyncSessionCredentialService);
      syncService.start({
        apiBaseUrl: environment.apiUrl.replace('/api', ''),
        // Every backend route except the health probe requires the operator's session
        // JWT (#224) — `infra/pos-api/src/session-auth.ts` verifies it. Blank until
        // someone signs in, and the worker defers its pulls while it is.
        sessionToken: credential.token(),
        syncIntervalMs: 30000,
        circuitBreaker: environment.circuitBreaker,
        retry: environment.retry,
      });
    }),
  ],
};
