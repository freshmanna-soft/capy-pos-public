import {
  AGENT_PREF_KEY,
  readAgentPreference,
  writeAgentPreference,
} from './clerk-agent-preference';

/**
 * Four branches across two functions, and all four matter: the two stored values
 * are what a returning till reads on Monday morning, and the two throwing paths
 * are the private-window case where the alternative to a default is a crash on
 * facade construction.
 *
 * Every test restores real storage afterwards, because a persisted `commands`
 * value leaking out of here would silently construct an unrelated spec's facade
 * with the kill switch already thrown.
 */
describe('clerk agent preference', () => {
  afterEach(() => {
    localStorage.removeItem(AGENT_PREF_KEY);
    vi.restoreAllMocks();
  });

  it('treats an absent answer as conversational', () => {
    expect(readAgentPreference()).toBe(true);
  });

  it('reads back the answer it wrote, both ways', () => {
    writeAgentPreference(false);
    expect(localStorage.getItem(AGENT_PREF_KEY)).toBe('commands');
    expect(readAgentPreference()).toBe(false);

    writeAgentPreference(true);
    expect(localStorage.getItem(AGENT_PREF_KEY)).toBe('conversational');
    expect(readAgentPreference()).toBe(true);
  });

  it('is conversational when storage cannot be read at all', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(readAgentPreference()).toBe(true);
  });

  it('survives storage it cannot write to', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => writeAgentPreference(false)).not.toThrow();
  });
});
