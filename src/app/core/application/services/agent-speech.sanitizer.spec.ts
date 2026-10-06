import {
  MAX_SPEECH_WORDS,
  joinWithinSpeechBudget,
  sanitizeAgentSpeech,
} from './agent-speech.sanitizer';

/** A phrase of exactly `words` words, so a budget boundary can be hit on purpose. */
function words(count: number, word = 'coffee'): string {
  return Array.from({ length: count }, () => word).join(' ');
}

describe('sanitizeAgentSpeech', () => {
  const context = {
    namesByCode: new Map<string, string>([['sku-8891', 'coffee beans']]),
    offerOnScreen: false,
  };

  it('names a hyphenated SKU without consuming ordinary hyphenated words', () => {
    expect(sanitizeAgentSpeech('Use SKU-8891, not a sugar-free syrup.', context)).toBe(
      'Use coffee beans, not a sugar-free syrup.'
    );
  });

  it('collapses long whitespace and removes spaces before punctuation', () => {
    const hostileWhitespace = `${' '.repeat(20_000)}, ready`;

    expect(sanitizeAgentSpeech(`Coffee${hostileWhitespace}!`, context)).toBe('Coffee, ready!');
  });
});

describe('joinWithinSpeechBudget', () => {
  it('puts the till`s report in front of the model`s answer', () => {
    expect(joinWithinSpeechBudget('One avocado, added.', 'That comes to seven fifty.')).toBe(
      'One avocado, added. That comes to seven fifty.'
    );
  });

  it('spends the budget on the summary first and trims the answer to what is left', () => {
    const summary = `${words(MAX_SPEECH_WORDS - 3)}.`;

    const spoken = joinWithinSpeechBudget(summary, words(20, 'chatter'));

    // The summary is the clerk's account of what she did to the sale, so the cut
    // lands on the prose: three words of answer survive, and the whole utterance
    // still fits the window the microphone is deaf for.
    expect(spoken).toBe(`${summary} chatter chatter chatter`);
    expect(spoken.split(' ')).toHaveLength(MAX_SPEECH_WORDS);
  });

  it('speaks an over-budget summary alone rather than shortening it', () => {
    const summary = words(MAX_SPEECH_WORDS + 5);

    // Nothing in a short count is optional — better a long report than a wrong one.
    expect(joinWithinSpeechBudget(summary, 'And here is some more.')).toBe(summary);
  });

  it('falls back to the answer, trimmed on its own, when there is no summary', () => {
    expect(joinWithinSpeechBudget('  ', 'Just the answer, then.')).toBe('Just the answer, then.');
    expect(joinWithinSpeechBudget('', words(MAX_SPEECH_WORDS + 2)).split(' ')).toHaveLength(
      MAX_SPEECH_WORDS
    );
  });

  it('says only the summary when the turn had nothing to answer', () => {
    expect(joinWithinSpeechBudget('One avocado, added.', '')).toBe('One avocado, added.');
  });
});
