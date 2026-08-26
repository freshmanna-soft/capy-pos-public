import { Provider } from '@angular/core';
import { CLERK_AGENT } from '@core/application/ports/clerk-agent.port';
import { MockClerkAgent } from '@core/infrastructure/agent/mock-clerk-agent.adapter';
import { environment } from '../../../../environments/environment';

/**
 * Binds CLERK_AGENT to a concrete adapter for this build target.
 *
 * Mirrors VISION_PROVIDERS: the choice is made once, here, so no component or
 * facade has to know which agent it got. With `features.clerkAgent` off (the
 * default in every environment) the clerk runs on the offline mock, which is why
 * the test suite needs no network stubbing.
 *
 * Lives beside its adapters rather than in `core/infrastructure/factories/`,
 * because that path is coverage-excluded and this file should be measured.
 *
 * `environment` is imported by relative path on purpose. The `@environments`
 * alias resolves to `./src/app/environments/*`, a directory that does not exist.
 *
 * **Deliberate deviation from the design sketch,** which shows a
 * `features.clerkAgent ? ClaudeClerkAgentAdapter : MockClerkAgent` ternary. That
 * adapter does not exist yet, and this story must create neither a phantom import
 * nor an unfinished stub — while `A ? X : X` would trip SonarJS
 * `no-all-duplicated-branches`. So the mock is bound unconditionally and
 * `features.clerkAgent` is the selector that replaces the binding when the relay
 * adapter lands.
 *
 * The adapter is registered as a concrete class so `useExisting` resolves it
 * through DI and it still gets its own injected dependencies later.
 */
export const CLERK_AGENT_PROVIDERS: Provider[] = [
  MockClerkAgent,
  {
    provide: CLERK_AGENT,
    useExisting: MockClerkAgent,
  },
];

/**
 * Whether this build expects a live agent behind the seam.
 *
 * False everywhere today, and the factory spec asserts that. The assertion is the
 * point: the day the flag flips without a relay adapter to bind, the suite fails
 * instead of quietly running the mock in a build that thinks it is live.
 */
export const CLERK_AGENT_IS_LIVE: boolean = environment.features.clerkAgent;
