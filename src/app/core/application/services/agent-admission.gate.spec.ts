import {
  AgentAdmissionState,
  MAX_TURNS_PER_MINUTE,
  MAX_TURNS_PER_SESSION,
  MIN_CHARS,
  MIN_WORDS,
  RATE_WINDOW_MS,
  REPEAT_WINDOW_MS,
  admitAgentTurn,
  emptyAdmissionState,
  normalizeUtterance,
  recordAdmittedTurn,
} from './agent-admission.gate';

/** A phrase that is unmistakably a question for the till, for the state tests. */
const QUESTION = 'how much are the avocados';
const OTHER_QUESTION = 'what is the total for this sale';

/** The clock value every test counts from, so no test depends on the real one. */
const T0 = 1_000_000;

/** A session that has already spent `turns` of its budget, most recent last. */
function spent(turns: number, at: number = T0): AgentAdmissionState {
  const state = emptyAdmissionState();
  for (let index = 0; index < turns; index += 1) {
    recordAdmittedTurn(state, `phrase number ${index} for the till`, at);
  }
  return state;
}

describe('normalizeUtterance', () => {
  it.each([
    ['How much?', 'how much'],
    ['  two   avocados  ', 'two avocados'],
    ["That's it, thanks!", 'thats it thanks'],
    ['ADD AN AVOCADO', 'add an avocado'],
  ])('reads %p as %p', (utterance, normalized) => {
    // Case, punctuation and runs of whitespace are all things a recognizer varies
    // between two deliveries of the same fragment.
    expect(normalizeUtterance(utterance)).toBe(normalized);
  });

  it('flattens an utterance that is only punctuation to nothing', () => {
    expect(normalizeUtterance('?!...')).toBe('');
  });
});

describe('emptyAdmissionState', () => {
  it('starts a session owing nothing', () => {
    expect(emptyAdmissionState()).toEqual({
      admittedAt: [],
      sessionTurns: 0,
      lastUtterance: null,
      lastUtteranceAt: 0,
    });
  });

  it('hands back a fresh record each time, so two sessions cannot share a budget', () => {
    const first = emptyAdmissionState();
    recordAdmittedTurn(first, QUESTION, T0);

    expect(emptyAdmissionState().sessionTurns).toBe(0);
  });
});

describe('admitAgentTurn', () => {
  it('admits a question addressed to the till', () => {
    expect(admitAgentTurn(QUESTION, emptyAdmissionState(), T0)).toEqual({ admit: true });
  });

  describe('too short to be a request', () => {
    it.each(['', '   ', 'yeah okay', 'one second', 'thats fine'])(
      'refuses %p as counter noise',
      (utterance) => {
        expect(admitAgentTurn(utterance, emptyAdmissionState(), T0)).toEqual({
          admit: false,
          reason: 'too_short',
        });
      }
    );

    it('refuses three very short words, which are agreement rather than a question', () => {
      // "yes ok fine" clears the word floor and not the character floor, which is
      // exactly why both are checked.
      const utterance = 'yes ok fine';

      expect(normalizeUtterance(utterance).split(' ')).toHaveLength(MIN_WORDS);
      expect(normalizeUtterance(utterance).length).toBeLessThan(MIN_CHARS);
      expect(admitAgentTurn(utterance, emptyAdmissionState(), T0)).toEqual({
        admit: false,
        reason: 'too_short',
      });
    });

    it('admits a phrase that clears both floors together', () => {
      const utterance = 'add two avocados';

      expect(normalizeUtterance(utterance).split(' ').length).toBeGreaterThanOrEqual(MIN_WORDS);
      expect(normalizeUtterance(utterance).length).toBeGreaterThanOrEqual(MIN_CHARS);
      expect(admitAgentTurn(utterance, emptyAdmissionState(), T0)).toEqual({ admit: true });
    });

    it('refuses on length before it looks at any state', () => {
      // The overwhelming majority of arrivals, and the one refusal that needs no
      // counters at all.
      const exhausted = spent(MAX_TURNS_PER_SESSION);

      expect(admitAgentTurn('yeah', exhausted, T0)).toEqual({
        admit: false,
        reason: 'too_short',
      });
    });
  });

  describe('the session ceiling', () => {
    it('refuses once a shift has spent its whole budget', () => {
      const state = spent(MAX_TURNS_PER_SESSION);

      expect(admitAgentTurn(QUESTION, state, T0 + RATE_WINDOW_MS)).toEqual({
        admit: false,
        reason: 'session_cap',
      });
    });

    it('still admits the last turn of the budget', () => {
      const state = spent(MAX_TURNS_PER_SESSION - 1);

      expect(admitAgentTurn(QUESTION, state, T0 + RATE_WINDOW_MS)).toEqual({ admit: true });
    });

    it('names the ceiling that really stopped it, not the one it also hit', () => {
      // A session at its cap is trivially at its per-minute cap too, and the useful
      // reason is the one that will not clear on its own.
      const state = spent(MAX_TURNS_PER_SESSION);

      expect(admitAgentTurn(QUESTION, state, T0)).toEqual({
        admit: false,
        reason: 'session_cap',
      });
    });

    it('counts turns the rolling window has already forgotten', () => {
      const state = spent(MAX_TURNS_PER_SESSION);
      state.admittedAt = [];

      expect(admitAgentTurn(QUESTION, state, T0)).toEqual({
        admit: false,
        reason: 'session_cap',
      });
    });
  });

  describe('the rolling minute', () => {
    it('refuses the turn past the per-minute cap', () => {
      const state = spent(MAX_TURNS_PER_MINUTE);

      expect(admitAgentTurn(QUESTION, state, T0 + 1)).toEqual({
        admit: false,
        reason: 'rate_limited',
      });
    });

    it('admits again once the window has slid past those turns', () => {
      const state = spent(MAX_TURNS_PER_MINUTE);

      expect(admitAgentTurn(QUESTION, state, T0 + RATE_WINDOW_MS)).toEqual({ admit: true });
    });

    it('still counts a turn that is a millisecond inside the window', () => {
      const state = spent(MAX_TURNS_PER_MINUTE);

      expect(admitAgentTurn(QUESTION, state, T0 + RATE_WINDOW_MS - 1)).toEqual({
        admit: false,
        reason: 'rate_limited',
      });
    });
  });

  describe('the same words twice', () => {
    it('refuses a recognizer re-delivering an identical final result', () => {
      const state = emptyAdmissionState();
      recordAdmittedTurn(state, QUESTION, T0);

      expect(admitAgentTurn(QUESTION, state, T0 + 1000)).toEqual({
        admit: false,
        reason: 'repeat',
      });
    });

    it('sees through the punctuation and case a second delivery varies', () => {
      const state = emptyAdmissionState();
      recordAdmittedTurn(state, QUESTION, T0);

      expect(admitAgentTurn(`  How much ARE the Avocados?  `, state, T0 + 500)).toEqual({
        admit: false,
        reason: 'repeat',
      });
    });

    it('admits the same question once the window has passed', () => {
      // The cashier asking again after eight seconds is asking again, not echoing.
      const state = emptyAdmissionState();
      recordAdmittedTurn(state, QUESTION, T0);

      expect(admitAgentTurn(QUESTION, state, T0 + REPEAT_WINDOW_MS)).toEqual({ admit: true });
    });

    it('admits a different question inside the window', () => {
      const state = emptyAdmissionState();
      recordAdmittedTurn(state, QUESTION, T0);

      expect(admitAgentTurn(OTHER_QUESTION, state, T0 + 100)).toEqual({ admit: true });
    });

    it('reports a duplicate arriving at a cap as the cap it hit', () => {
      const state = spent(MAX_TURNS_PER_SESSION);
      recordAdmittedTurn(state, QUESTION, T0);

      expect(admitAgentTurn(QUESTION, state, T0 + 100)).toEqual({
        admit: false,
        reason: 'session_cap',
      });
    });
  });

  it('charges nothing for its own refusals', () => {
    // A gate that billed for refusals would ratchet itself shut on a shop that was
    // never listened to.
    const state = spent(1);
    const before = structuredClone(state);

    admitAgentTurn('yeah', state, T0 + 1);
    admitAgentTurn(QUESTION, state, T0 + 2);

    expect(state).toEqual(before);
  });
});

describe('recordAdmittedTurn', () => {
  it('spends one turn of both budgets', () => {
    const state = emptyAdmissionState();

    recordAdmittedTurn(state, QUESTION, T0);

    expect(state.sessionTurns).toBe(1);
    expect(state.admittedAt).toEqual([T0]);
  });

  it('remembers the words it admitted, normalized', () => {
    const state = emptyAdmissionState();

    recordAdmittedTurn(state, '  How much ARE the Avocados?  ', T0);

    expect(state.lastUtterance).toBe(QUESTION);
    expect(state.lastUtteranceAt).toBe(T0);
  });

  it('prunes the rolling window as it writes, so the array cannot grow all shift', () => {
    const state = spent(MAX_TURNS_PER_MINUTE);

    recordAdmittedTurn(state, QUESTION, T0 + RATE_WINDOW_MS);

    expect(state.admittedAt).toEqual([T0 + RATE_WINDOW_MS]);
    // The session count is the ceiling the window is not allowed to forgive.
    expect(state.sessionTurns).toBe(MAX_TURNS_PER_MINUTE + 1);
  });

  it('keeps the turns the window still covers', () => {
    const state = spent(2);

    recordAdmittedTurn(state, QUESTION, T0 + 1000);

    expect(state.admittedAt).toEqual([T0, T0, T0 + 1000]);
  });
});
