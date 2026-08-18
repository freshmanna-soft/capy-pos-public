import { parseClerkIntent } from './voice-intent.parser';

const CANDIDATES = ['Oat Milk', 'Soy Milk', 'Almond Butter'];

describe('parseClerkIntent', () => {
  describe('confirmation and rejection', () => {
    it.each(['yes', 'Yep', 'yeah', "that's it", "That's right", 'correct', 'ok'])(
      'reads "%s" as confirmation',
      (phrase) => {
        expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'confirm' });
      }
    );

    it.each(['no', 'Nope', 'wrong', 'not that one', 'none of those'])(
      'reads "%s" as rejection',
      (phrase) => {
        expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'reject' });
      }
    );

    it('prefers rejection when a phrase carries both', () => {
      // "no, not that one" contains neither a bare yes nor a name, but ordering
      // matters for anything ambiguous: acting on a mistaken yes costs money.
      expect(parseClerkIntent('no not that one', CANDIDATES)).toEqual({ kind: 'reject' });
    });
  });

  describe('choosing between candidates', () => {
    it.each([
      ['one', 1],
      ['first', 1],
      ['two', 2],
      ['number two', 2],
      ['three', 3],
    ])('reads "%s" as position %i', (phrase, index) => {
      expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'choose', index });
    });

    it('ignores a position that is not on offer', () => {
      expect(parseClerkIntent('three', ['Oat Milk'])).toEqual({ kind: 'unknown' });
    });

    it('ignores positions when nothing is on offer', () => {
      expect(parseClerkIntent('two', [])).toEqual({ kind: 'unknown' });
    });

    it('matches a candidate by name', () => {
      expect(parseClerkIntent('the almond butter', CANDIDATES)).toEqual({
        kind: 'choose',
        index: 3,
      });
    });

    it('prefers the candidate that matches more of what was said', () => {
      // "oat milk" and "soy milk" both contain "milk"; the distinguishing word wins.
      expect(parseClerkIntent('soy milk please', CANDIDATES)).toEqual({
        kind: 'choose',
        index: 2,
      });
    });

    it('matches on the short word that distinguishes two candidates', () => {
      // "oat" and "soy" are the entire difference between these two products, so
      // a length filter would throw away the only useful signal.
      expect(parseClerkIntent('oat milk', CANDIDATES)).toEqual({ kind: 'choose', index: 1 });
    });

    it('will not guess when the words said do not distinguish the candidates', () => {
      // Ambiguous speech must not put an item in the cart. Better to ask again.
      expect(parseClerkIntent('milk', ['Oat Milk', 'Soy Milk'])).toEqual({ kind: 'unknown' });
    });

    it('does match a shared word when only one candidate is on offer', () => {
      expect(parseClerkIntent('milk', ['Oat Milk'])).toEqual({ kind: 'choose', index: 1 });
    });

    it('matches whole words only, so a substring cannot select the wrong product', () => {
      expect(parseClerkIntent('tea', ['Steak Pie'])).toEqual({ kind: 'unknown' });
    });

    it('does not match a product that is not currently on offer', () => {
      expect(parseClerkIntent('almond butter', ['Oat Milk'])).toEqual({ kind: 'unknown' });
    });
  });

  describe('commands', () => {
    it.each([
      ['undo', 'undo'],
      ['remove that', 'undo'],
      ['take it off', 'undo'],
      ['total', 'total'],
      ['how much is it', 'total'],
      ['checkout', 'checkout'],
      ['pay', 'checkout'],
      ["that's everything", 'checkout'],
      ['stop listening', 'mute'],
      ['be quiet', 'mute'],
    ])('reads "%s" as %s', (phrase, kind) => {
      expect(parseClerkIntent(phrase, CANDIDATES).kind).toBe(kind);
    });

    it('lets a command win over a product name in the same phrase', () => {
      // Undo has to be reachable even mid-sentence; a wrongly-added item is
      // exactly when someone talks fast.
      expect(parseClerkIntent('no undo the oat milk', CANDIDATES).kind).toBe('undo');
    });
  });

  describe('robustness', () => {
    it('ignores casing, punctuation and curly apostrophes', () => {
      expect(parseClerkIntent('  THAT’S IT!! ', CANDIDATES)).toEqual({ kind: 'confirm' });
    });

    it('returns unknown for silence or noise', () => {
      expect(parseClerkIntent('', CANDIDATES)).toEqual({ kind: 'unknown' });
      expect(parseClerkIntent('   ', CANDIDATES)).toEqual({ kind: 'unknown' });
      expect(parseClerkIntent('hmm what about the weather', CANDIDATES)).toEqual({
        kind: 'unknown',
      });
    });

    it('does not fire a command on a word that merely contains one', () => {
      // Whole-word matching: "payment terminal" should not read as "pay".
      expect(parseClerkIntent('paying attention', CANDIDATES).kind).not.toBe('checkout');
      expect(parseClerkIntent('nope', CANDIDATES).kind).toBe('reject');
    });

    it('defaults the candidate list so it can be called before anything is offered', () => {
      expect(parseClerkIntent('yes')).toEqual({ kind: 'confirm' });
    });
  });
});
