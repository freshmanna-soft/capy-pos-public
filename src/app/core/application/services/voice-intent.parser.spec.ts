import {
  MAX_SPOKEN_QUANTITY,
  clampSpokenQuantity,
  parseClerkIntent,
  rankLabelsBySpokenWords,
} from './voice-intent.parser';

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
      ['stop listening', 'mic'],
      ['mute', 'voice'],
      ['be quiet', 'voice'],
      ['stop talking', 'voice'],
      ['unmute', 'voice'],
      ['speak up', 'voice'],
    ])('reads "%s" as %s', (phrase, kind) => {
      expect(parseClerkIntent(phrase, CANDIDATES).kind).toBe(kind);
    });

    it('tells silencing her voice from closing the microphone', () => {
      // One phrase stops her talking over a customer, the other stops her hearing
      // the counter. They were a single intent once, which meant "be quiet" turned
      // the microphone off and left the voice running — the opposite of the ask.
      expect(parseClerkIntent('be quiet', CANDIDATES)).toEqual({ kind: 'voice', on: false });
      expect(parseClerkIntent('stop listening', CANDIDATES)).toEqual({ kind: 'mic', on: false });
    });

    it('reads asking for the voice back as unmuting, not as muting again', () => {
      // Whole-word matching is what keeps "unmute" out of "mute".
      expect(parseClerkIntent('unmute', CANDIDATES)).toEqual({ kind: 'voice', on: true });
      expect(parseClerkIntent('you can talk now', CANDIDATES)).toEqual({
        kind: 'voice',
        on: true,
      });
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

  describe('adding by name', () => {
    it.each([
      ['add a sandwich', ['sandwich'], 1],
      ['ring up a coffee', ['coffee'], 1],
      ['another coffee', ['coffee'], 1],
      ['one more coffee', ['coffee'], 1],
      ['put in a water bottle', ['water', 'bottle'], 1],
    ])('reads "%s" as adding %j', (phrase, query, quantity) => {
      expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'add', query, quantity });
    });

    it.each([
      ['add two sandwiches', 2],
      ['add three coffees', 3],
      ['add five coffees', 5],
    ])('reads the count in "%s" as %i', (phrase, quantity) => {
      expect(parseClerkIntent(phrase, CANDIDATES)).toMatchObject({ kind: 'add', quantity });
    });

    it('does not let an uncounted number word inflate the order', () => {
      // "twenty" is not in the counting vocabulary, so it stays part of the name
      // and fails to resolve — she says she cannot find it. That is deliberate:
      // ringing up one coffee when twenty were asked for is a quiet wrong answer,
      // and twenty when one was meant empties the shelf.
      expect(parseClerkIntent('add twenty coffees', CANDIDATES)).toEqual({
        kind: 'add',
        query: ['twenty', 'coffees'],
        quantity: 1,
      });
    });

    it('reads an instruction that opens with a refusal as the instruction', () => {
      // "no, add a coffee" is a correction, not a rejection — the same reasoning
      // that puts undo above reject.
      expect(parseClerkIntent('no add a coffee', CANDIDATES)).toEqual({
        kind: 'add',
        query: ['coffee'],
        quantity: 1,
      });
    });

    it('leaves an add with nothing nameable to the candidate list', () => {
      // "add two" while three products are on offer is a choice, not an add.
      expect(parseClerkIntent('add two', CANDIDATES)).toEqual({ kind: 'choose', index: 2 });
    });
  });

  describe('removing by name', () => {
    it.each([
      ['remove the water bottle', ['water', 'bottle'], 1],
      ['take off the coffee', ['coffee'], 1],
      ['take off two coffees', ['coffees'], 2],
      ['drop the oat milk', ['oat', 'milk'], 1],
    ])('reads "%s" as removing %j', (phrase, query, quantity) => {
      expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'remove', query, quantity });
    });

    it('reads a removal whose particle trails the name', () => {
      // "take the coffee off" is as natural as "take off the coffee", and a
      // contiguous "take off" match only ever catches one of them.
      expect(parseClerkIntent('take the coffee off', CANDIDATES)).toEqual({
        kind: 'remove',
        query: ['coffee'],
        quantity: 1,
      });
    });

    it.each(['remove everything', 'clear the cart', 'start over'])(
      'answers "%s" instead of hunting for a product called everything',
      (phrase) => {
        expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'clearRequested' });
      }
    );

    it('still reads "that\u2019s everything" as checkout', () => {
      // The bulk-clear branch sits behind a removal verb for exactly this reason.
      expect(parseClerkIntent("that's everything", CANDIDATES).kind).toBe('checkout');
    });

    it.each(['remove that', 'remove it', 'remove the last one', 'take it off'])(
      'still reads "%s" as undo, because it names nothing',
      (phrase) => {
        expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'undo' });
      }
    );
  });

  describe('the camera switch', () => {
    it.each(['camera off', 'turn the camera off', 'turn off the camera', 'no camera'])(
      'reads "%s" as switching the camera off',
      (phrase) => {
        expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'camera', on: false });
      }
    );

    it.each(['camera on', 'turn the camera on', 'start the camera'])(
      'reads "%s" as switching the camera on',
      (phrase) => {
        expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'camera', on: true });
      }
    );
  });

  describe('the recognition switch', () => {
    it.each(['ai off', 'turn off the ai', 'barcodes only', 'stop guessing'])(
      'reads "%s" as switching recognition off',
      (phrase) => {
        expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'ai', on: false });
      }
    );

    it.each(['ai on', 'turn the ai on', 'recognition on'])(
      'reads "%s" as switching recognition on',
      (phrase) => {
        expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'ai', on: true });
      }
    );

    it('does not confuse the camera switch with the recognition switch', () => {
      expect(parseClerkIntent('camera off', CANDIDATES)).toEqual({ kind: 'camera', on: false });
      expect(parseClerkIntent('ai off', CANDIDATES)).toEqual({ kind: 'ai', on: false });
    });
  });

  describe('looking again', () => {
    it.each(['look again', 'scan again', 'have another look'])(
      'reads "%s" as another look',
      (phrase) => {
        // "have another look" carries an add verb; it is not a request to ring up
        // a product called "look", which is why this is matched first.
        expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'look' });
      }
    );
  });

  describe('the free local verbs', () => {
    it.each([
      'say that again',
      'say it again',
      'repeat that',
      'repeat',
      'what did you say',
      'come again',
      'one more time',
    ])('reads "%s" as a repeat', (phrase) => {
      expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'repeat' });
    });

    it.each([
      'never mind',
      'nevermind',
      'forget it',
      'forget that',
      'ignore that',
      'skip it',
      'my mistake',
    ])('reads "%s" as a dismissal', (phrase) => {
      expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'dismiss' });
    });

    it.each([
      'what can you do',
      'what can I say',
      'what do I say',
      'what can you say',
      'help me out',
      'commands',
      'how does this work',
    ])('reads "%s" as asking what she can do', (phrase) => {
      expect(parseClerkIntent(phrase, CANDIDATES)).toEqual({ kind: 'help' });
    });

    it.each([
      ['look again', { kind: 'look' }],
      ['scan again', { kind: 'look' }],
      ['try again', { kind: 'look' }],
      ['speak again', { kind: 'voice', on: true }],
      ['cancel that', { kind: 'undo' }],
      ['remove that', { kind: 'undo' }],
      ['one more time', { kind: 'repeat' }],
      ['never mind', { kind: 'dismiss' }],
      ['clear the cart', { kind: 'clearRequested' }],
    ])('does not let the new needles shadow "%s"', (phrase, intent) => {
      // The ladder's ordering is the whole guard here: device commands stay ahead
      // of the local verbs so "look again" keeps its eyes, undo stays ahead so
      // "cancel that" stays destructive-first, and the add verbs stay behind so
      // "one more time" is not an add of a product called "time".
      expect(parseClerkIntent(phrase, CANDIDATES)).toEqual(intent);
    });

    it('still adds a coffee when the cashier says "one more coffee"', () => {
      // `one more` is an add verb, and only the trailing "time" makes the repeat.
      expect(parseClerkIntent('one more coffee', CANDIDATES)).toEqual({
        kind: 'add',
        query: ['coffee'],
        quantity: 1,
      });
    });

    it('still adds a coffee when the cashier says "help me add a coffee"', () => {
      // Which is why there is no bare `help` needle: the word is far more often
      // part of an instruction than a request for the command list.
      expect(parseClerkIntent('help me add a coffee', CANDIDATES)).toEqual({
        kind: 'add',
        query: ['coffee'],
        quantity: 1,
      });
    });

    it('still removes a named item, which no local verb may swallow', () => {
      expect(parseClerkIntent('remove the oat milk', CANDIDATES)).toEqual({
        kind: 'remove',
        query: ['oat', 'milk'],
        quantity: 1,
      });
    });

    it('leaves genuinely open-ended language to the tier above', () => {
      // The point of shrinking the default arm is that what is left in it means
      // "open-ended", not "nobody got round to adding this phrase".
      expect(parseClerkIntent('lovely weather today', CANDIDATES)).toEqual({ kind: 'unknown' });
    });
  });
});

describe('rankLabelsBySpokenWords', () => {
  it('folds plurals on both sides, because nobody says "add two sandwich"', () => {
    expect(rankLabelsBySpokenWords(['sandwiches'], ['Sandwich', 'Coffee'])).toEqual([
      { index: 0, score: 2, coverage: 1 },
    ]);
  });

  it('returns every match, best first', () => {
    const ranked = rankLabelsBySpokenWords(['soy', 'milk'], ['Oat Milk', 'Soy Milk']);
    expect(ranked.map((match) => match.index)).toEqual([1, 0]);
  });

  it('reports a tie as a tie rather than picking one', () => {
    // The caller decides what a tie means: choosing between candidates refuses to
    // guess, while adding by name offers the tied products as a choice.
    const ranked = rankLabelsBySpokenWords(['milk'], ['Oat Milk', 'Soy Milk']);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.score).toBe(ranked[1]?.score);
  });

  it('scores nothing for a word that only appears inside another', () => {
    expect(rankLabelsBySpokenWords(['tea'], ['Steak Pie'])).toEqual([]);
  });

  it('breaks a scoring tie in favour of the name that was said completely', () => {
    // "Coffee" and "Coffee Cake" both score one for a bare "coffee". Coverage is
    // what knows the cashier named one of them entirely and the other halfway.
    const ranked = rankLabelsBySpokenWords(['coffee'], ['Coffee Cake', 'Coffee']);
    expect(ranked[0]?.index).toBe(1);
  });
});

describe('clampSpokenQuantity', () => {
  it('reads a misheard number as one rather than as an error', () => {
    // NaN is the dangerous one: it survives Math.max and Math.min, so an
    // `added >= wanted` loop guard is permanently false and the loop keeps adding
    // until stock refuses — the whole shelf, from one utterance, silently.
    expect(clampSpokenQuantity(NaN)).toBe(1);
  });

  it('clamps the infinities like any other out-of-range number', () => {
    expect(clampSpokenQuantity(Infinity)).toBe(MAX_SPOKEN_QUANTITY);
    expect(clampSpokenQuantity(-Infinity)).toBe(1);
  });

  it('never returns less than one', () => {
    expect(clampSpokenQuantity(0)).toBe(1);
    expect(clampSpokenQuantity(-3)).toBe(1);
  });

  it('floors a fraction to a whole unit count', () => {
    // There is no such thing as 2.7 of a thing on a till.
    expect(clampSpokenQuantity(2.7)).toBe(2);
  });

  it('caps an oversized count at the spoken maximum', () => {
    expect(clampSpokenQuantity(40)).toBe(MAX_SPOKEN_QUANTITY);
  });

  it('leaves a quantity that is already in range alone', () => {
    expect(clampSpokenQuantity(1)).toBe(1);
    expect(clampSpokenQuantity(3)).toBe(3);
    expect(clampSpokenQuantity(MAX_SPOKEN_QUANTITY)).toBe(MAX_SPOKEN_QUANTITY);
  });

  it('does not change what the parser reads off a phrase', () => {
    // The clamp now runs inside the counting-word path, so this is the regression
    // guard that it is the same rule and not a stricter one.
    expect(parseClerkIntent('add three coffees', CANDIDATES)).toEqual({
      kind: 'add',
      query: ['coffees'],
      quantity: 3,
    });
  });
});
