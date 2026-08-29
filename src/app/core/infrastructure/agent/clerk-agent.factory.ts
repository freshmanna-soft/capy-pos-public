import { Provider } from '@angular/core';
import { CLERK_AGENT } from '@core/application/ports/clerk-agent.port';
import { ClaudeClerkAgentAdapter } from '@core/infrastructure/agent/claude-clerk-agent.adapter';
import { MockClerkAgent } from '@core/infrastructure/agent/mock-clerk-agent.adapter';
import { environment } from '../../../../environments/environment';

/**
 * Binds CLERK_AGENT to a concrete adapter for this build target.
 *
 * Mirrors VISION_PROVIDERS: the choice is made once, here, from a feature
 * flag, so no component or facade has to know which agent it got. With
 * `features.clerkAgent` off (the default in every environment) the clerk runs
 * on the offline mock, which is why the test suite needs no network stubbing.
 *
 * Lives beside its adapters rather than in `core/infrastructure/factories/`,
 * because that path is coverage-excluded and this file should be measured.
 *
 * `environment` is imported by relative path on purpose. The `@environments`
 * alias resolves to `./src/app/environments/*`, a directory that does not exist.
 *
 * Both adapters are registered as concrete classes so `useExisting` resolves
 * them through DI and each still gets its own injected dependencies.
 */
export const CLERK_AGENT_PROVIDERS: Provider[] = [
  MockClerkAgent,
  ClaudeClerkAgentAdapter,
  {
    provide: CLERK_AGENT,
    useExisting: environment.features.clerkAgent ? ClaudeClerkAgentAdapter : MockClerkAgent,
  },
];

/**
 * Whether this build expects a live agent behind the seam.
 *
 * Mirrors `features.clerkAgent` directly now that the relay adapter exists —
 * kept as its own export (rather than every call site reading the flag
 * itself) so the factory spec has one clear thing to assert against.
 */
export const CLERK_AGENT_IS_LIVE: boolean = environment.features.clerkAgent;
