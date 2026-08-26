import { TestBed } from '@angular/core/testing';
import { CLERK_AGENT } from '@core/application/ports/clerk-agent.port';
import { CLERK_AGENT_IS_LIVE, CLERK_AGENT_PROVIDERS } from './clerk-agent.factory';
import { MockClerkAgent } from './mock-clerk-agent.adapter';
import { environment } from '../../../../environments/environment';

describe('CLERK_AGENT_PROVIDERS', () => {
  beforeEach(() => {
    // Nothing here logs, but a factory that grows a warning should not be able to
    // leak it into the next spec's window (#109/#112).
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({ providers: CLERK_AGENT_PROVIDERS });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds CLERK_AGENT to the offline mock', () => {
    const agent = TestBed.inject(CLERK_AGENT);

    expect(agent).toBeInstanceOf(MockClerkAgent);
    expect(agent.kind).toBe('demo');
  });

  it('resolves the token through DI rather than to a second instance', () => {
    // `useExisting`, not `useClass`: the adapter has to be able to take injected
    // dependencies later without the token handing out a different object.
    expect(TestBed.inject(CLERK_AGENT)).toBe(TestBed.inject(MockClerkAgent));
  });

  it('ships with the agent tier off, so no build can think it is live without an adapter', () => {
    // The day this flips without a relay adapter bound above, this fails — which
    // is the point of asserting it here rather than trusting the binding.
    expect(environment.features.clerkAgent).toBe(false);
    expect(CLERK_AGENT_IS_LIVE).toBe(false);
  });
});
