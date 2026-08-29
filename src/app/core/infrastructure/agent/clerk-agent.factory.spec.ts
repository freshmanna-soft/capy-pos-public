import { TestBed } from '@angular/core/testing';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { CLERK_AGENT } from '@core/application/ports/clerk-agent.port';
import { ClaudeClerkAgentAdapter } from './claude-clerk-agent.adapter';
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

  it('ships with the agent tier off by default, so no build can think it is live without an adapter', () => {
    // The default environment ships with the flag off; environment.vision.ts
    // (and any future live build target) is the deliberate opt-in.
    expect(environment.features.clerkAgent).toBe(false);
    expect(CLERK_AGENT_IS_LIVE).toBe(false);
  });
});

describe('CLERK_AGENT_PROVIDERS — the live branch', () => {
  // CLERK_AGENT_PROVIDERS' useExisting ternary is evaluated once, at module
  // load, from whichever environment this suite runs under (features.clerkAgent
  // is false here) — there is no way to flip that after the fact via TestBed.
  // This exercises the SAME ternary's other branch directly: the same
  // provider shape the factory produces when the flag is true, proving the
  // live adapter resolves cleanly through DI when it is the one selected.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        MockClerkAgent,
        ClaudeClerkAgentAdapter,
        { provide: CLERK_AGENT, useExisting: ClaudeClerkAgentAdapter },
        { provide: AUTH_GATEWAY, useValue: { getAccessToken: () => null } },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds CLERK_AGENT to the live relay adapter when the flag selects it', () => {
    const agent = TestBed.inject(CLERK_AGENT);

    expect(agent).toBeInstanceOf(ClaudeClerkAgentAdapter);
    expect(agent.kind).toBe('claude');
  });

  it('resolves the token through DI rather than to a second instance', () => {
    expect(TestBed.inject(CLERK_AGENT)).toBe(TestBed.inject(ClaudeClerkAgentAdapter));
  });
});
