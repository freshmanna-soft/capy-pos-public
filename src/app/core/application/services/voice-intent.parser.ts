/**
 * What the cashier asked the clerk to do.
 *
 * Deliberately a small closed set. Every one of these also has a keyboard
 * equivalent in the HUD, so voice is an accelerator rather than the only way in.
 */
export type ClerkIntent =
  /** Yes, that's the one. Take the top candidate. */
  | { kind: 'confirm' }
  /** No. Discard the candidates and look again. */
  | { kind: 'reject' }
  /** That one — a 1-based position in the candidate list. */
  | { kind: 'choose'; index: number }
  /**
   * Ring something up by name — "add two coffees".
   *
   * Carries the words that were said, not a product: the parser deliberately
   * knows nothing about the catalogue, so resolving the name (and deciding what
   * to do when it matches more than one thing) stays with the facade, which is
   * the only place that knows what this till sells and what is in stock.
   */
  | { kind: 'add'; query: string[]; quantity: number }
  /** Take a named item back off — "remove the water bottle". */
  | { kind: 'remove'; query: string[]; quantity: number }
  /** Take the last thing off the cart. */
  | { kind: 'undo' }
  /**
   * "Clear the cart" — understood, and deliberately not done here.
   *
   * Recognized as its own intent rather than left to fall through, because the
   * alternative is answering a perfectly ordinary request with "I can't see
   * 'everything' in the cart", which reads as a malfunction.
   */
  | { kind: 'clearRequested' }
  /** Look at the scene again, even if it hasn't changed. */
  | { kind: 'look' }
  /** Turn the camera off or back on without ending the session. */
  | { kind: 'camera'; on: boolean }
  /** Stop or resume paying the model to guess. Barcodes are unaffected. */
  | { kind: 'ai'; on: boolean }
  /** Read the running total. */
  | { kind: 'total' }
  /** Go to payment. */
  | { kind: 'checkout' }
  /**
   * Silence her, or give the voice back. Captions carry on either way.
   *
   * Separate from `mic`, which is the opposite ear. "Be quiet" and "stop
   * listening" were one intent while there was only one thing to switch off, and
   * that conflated the two most privacy-sensitive controls on the till: one stops
   * her talking over a customer, the other stops her hearing the counter.
   */
  | { kind: 'voice'; on: boolean }
  /** Stop listening. */
  | { kind: 'mic'; on: false }
  | { kind: 'unknown' };

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  first: 1,
  '1': 1,
  two: 2,
  second: 2,
  '2': 2,
  three: 3,
  third: 3,
  '3': 3,
};

/**
 * The most of anything one spoken phrase may add or remove.
 *
 * A cap rather than an open number because recognition mishears counts more
 * readily than names — "add two" and "add twenty two" differ by one dropped
 * word, and one of them empties the shelf. Anything larger is a job for the
 * manual terminal, where the number is typed and visible before it is committed.
 */
export const MAX_SPOKEN_QUANTITY = 5;

/** Counting words, including the articles that mean "one of them". */
const QUANTITY_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
};

/** Verb phrases that introduce something to ring up. */
const ADD_VERBS = ['add', 'ring up', 'one more', 'another', 'put in'];

/**
 * Verb phrases that introduce something to take back off.
 *
 * "take it off" and "take that off" are deliberately absent: they carry no name
 * and are already understood as undo, which is checked immediately after this.
 */
const REMOVE_VERBS = ['remove', 'delete', 'drop', 'scratch'];

/**
 * "Take" is a removal verb only when a particle follows it somewhere.
 *
 * Split out from the list above because the particle need not be adjacent —
 * "take the water bottle off" is as natural as "take off the water bottle", and a
 * contiguous "take off" needle matches only one of them.
 */
const TAKE_PARTICLES = ['off', 'away', 'out'];

/** Asking for the whole cart, which is answered rather than acted on. */
const BULK_WORDS = new Set(['everything', 'all', 'everythings', 'lot']);

/**
 * Words that carry no product identity.
 *
 * Used for two jobs: stripping them out of a spoken name, and — because what is
 * left over decides it — telling "remove the water bottle" from "remove that".
 */
const FILLER = new Set([
  'the',
  'a',
  'an',
  'that',
  'this',
  'it',
  'its',
  'one',
  'ones',
  'item',
  'items',
  'thing',
  'things',
  'last',
  'please',
  'my',
  'me',
  'of',
  'from',
  'cart',
  'off',
  'out',
  'in',
  'up',
  'again',
  'some',
  'more',
  'another',
  'and',
  'to',
  'for',
  'there',
  'then',
  'now',
  'just',
  'also',
]);

/**
 * Turn a spoken phrase into an intent.
 *
 * Plain string matching, not a second model call. Three reasons: a till cannot
 * wait a network round trip to find out whether "yes" meant yes; the command set
 * is small and closed, so matching is exhaustive rather than approximate; and a
 * deterministic parser can be unit tested against the exact phrases cashiers
 * actually say. An LLM here would add latency and cost to solve a problem that
 * doesn't need it.
 *
 * Order matters. Commands are checked before product names so that "no" is a
 * rejection even when a product happens to be called "Nori", and positional
 * choices are checked before names because "two" is faster to say than "sourdough".
 *
 * @param transcript Raw speech, any casing.
 * @param candidateLabels The candidates currently on screen, in display order.
 *   Product-name matching is scoped to these — the clerk should never *choose* a
 *   name it isn't currently offering. Adding by name is not scoped this way,
 *   which is the whole point of the `add` intent.
 */
export function parseClerkIntent(transcript: string, candidateLabels: string[] = []): ClerkIntent {
  const words = normalize(transcript);
  if (words.length === 0) {
    return { kind: 'unknown' };
  }

  const command = matchCommand(words);
  if (command !== null) {
    return command;
  }

  // Positional choice, but only when there is something to choose from.
  if (candidateLabels.length > 0) {
    for (const word of words) {
      const index = NUMBER_WORDS[word];
      if (index !== undefined && index <= candidateLabels.length) {
        return { kind: 'choose', index };
      }
    }

    const byName = matchCandidateByName(words, candidateLabels);
    if (byName !== null) {
      return { kind: 'choose', index: byName };
    }
  }

  return { kind: 'unknown' };
}

/**
 * Fixed commands, in priority order.
 *
 * Destructive and navigational commands are checked before everything else so
 * they can never be shadowed by a product name or by a stray "yes" later in the
 * same sentence — "no, undo the oat milk" has to undo. Rejection is checked
 * before confirmation for the same reason: acting on a mistaken yes costs money.
 *
 * The named commands sit above `reject` and `confirm` on that same logic: "no,
 * add a coffee" is an instruction, not a refusal.
 */
function matchCommand(words: string[]): ClerkIntent | null {
  const phrase = words.join(' ');

  const device = matchDeviceCommand(phrase);
  if (device !== null) {
    return device;
  }

  // A removal verb with a name after it removes that name; a removal verb with
  // nothing but filler after it ("remove that") is the undo it has always been.
  const removal =
    matchQuantified(words, REMOVE_VERBS) ?? matchQuantifiedFrom(words, findTakeVerb(words));
  if (removal !== null) {
    // "remove everything" is a real request with a real answer, which is not
    // "I don't stock everything". Gated behind the verb so "that's everything"
    // stays a checkout.
    if (removal.query.some((word) => BULK_WORDS.has(word))) {
      return { kind: 'clearRequested' };
    }
    return removal.query.length > 0 ? { kind: 'remove', ...removal } : { kind: 'undo' };
  }
  if (matchesAny(phrase, ['clear the cart', 'empty the cart', 'start over', 'clear everything'])) {
    return { kind: 'clearRequested' };
  }
  if (matchesAny(phrase, ['undo', 'remove that', 'take it off', 'take that off', 'cancel that'])) {
    return { kind: 'undo' };
  }

  // An add verb with nothing nameable after it is left unresolved rather than
  // guessed at, so "add two" can still fall through to picking candidate two.
  const addition = matchQuantified(words, ADD_VERBS);
  if (addition !== null && addition.query.length > 0) {
    return { kind: 'add', ...addition };
  }

  if (matchesAny(phrase, ['checkout', 'check out', 'pay', 'payment', 'thats everything', 'done'])) {
    return { kind: 'checkout' };
  }
  if (matchesAny(phrase, ['total', 'how much', 'whats the damage', 'balance'])) {
    return { kind: 'total' };
  }
  if (matchesAny(phrase, ['no', 'nope', 'wrong', 'not that', 'neither', 'none of those'])) {
    return { kind: 'reject' };
  }
  if (
    matchesAny(phrase, ['yes', 'yep', 'yeah', 'yup', 'correct', 'thats it', 'thats right', 'ok'])
  ) {
    return { kind: 'confirm' };
  }
  return null;
}

/**
 * What she should do with her eyes, ears and voice, rather than with the cart.
 *
 * Checked first and as a block. The ear and voice phrases come before the camera
 * ones so a looser "stop the …" can never swallow "stop listening", and all of
 * them come before the verbs because "have another look" contains an add verb and
 * is not a request to ring up a product called "look".
 *
 * "Stop listening" is matched before the voice phrases: it is the more specific
 * of the two, and getting it wrong leaves a microphone open that the cashier
 * believes they closed.
 */
function matchDeviceCommand(phrase: string): ClerkIntent | null {
  if (matchesAny(phrase, ['stop listening', 'dont listen', 'mic off', 'stop hearing'])) {
    return { kind: 'mic', on: false };
  }
  if (
    matchesAny(phrase, [
      'mute',
      'be quiet',
      'stop talking',
      'quiet please',
      'hush',
      'voice off',
      'no talking',
      'dont talk',
      'stop speaking',
    ])
  ) {
    return { kind: 'voice', on: false };
  }
  if (
    matchesAny(phrase, [
      'unmute',
      'voice on',
      'speak up',
      'you can talk',
      'talk to me',
      'speak again',
    ])
  ) {
    return { kind: 'voice', on: true };
  }
  if (
    matchesAny(phrase, [
      'camera off',
      'turn off the camera',
      'turn the camera off',
      'stop the camera',
      'hide the camera',
      'no camera',
      'privacy',
    ])
  ) {
    return { kind: 'camera', on: false };
  }
  if (
    matchesAny(phrase, [
      'camera on',
      'turn on the camera',
      'turn the camera on',
      'start the camera',
      'show the camera',
      'use the camera',
    ])
  ) {
    return { kind: 'camera', on: true };
  }
  if (
    matchesAny(phrase, [
      'ai off',
      'turn off the ai',
      'turn the ai off',
      'recognition off',
      'barcodes only',
      'stop guessing',
    ])
  ) {
    return { kind: 'ai', on: false };
  }
  if (
    matchesAny(phrase, [
      'ai on',
      'turn on the ai',
      'turn the ai on',
      'recognition on',
      'use the ai',
    ])
  ) {
    return { kind: 'ai', on: true };
  }
  if (
    matchesAny(phrase, ['look again', 'scan again', 'try again', 'another look', 'have a look'])
  ) {
    return { kind: 'look' };
  }
  return null;
}

/**
 * Split "add two coffees" into a count and a name.
 *
 * @returns null when none of `verbs` was said. Otherwise the count (1 unless one
 *   was spoken) and whatever words are left once the verb, the count and the
 *   filler are taken out — which may be nothing at all.
 */
function matchQuantified(
  words: string[],
  verbs: string[]
): { query: string[]; quantity: number } | null {
  return matchQuantifiedFrom(words, findVerb(words, verbs));
}

/** The half of `matchQuantified` that runs once the verb has been located. */
function matchQuantifiedFrom(
  words: string[],
  start: number | null
): { query: string[]; quantity: number } | null {
  if (start === null) {
    return null;
  }

  const rest = words.slice(start);
  let quantity = 1;
  const query: string[] = [];

  for (const word of rest) {
    const count = QUANTITY_WORDS[word];
    // Only the first count is read. A second number is part of a name far more
    // often than it is a correction ("two number 7 sauces").
    if (count !== undefined && query.length === 0 && quantity === 1 && count !== 1) {
      quantity = Math.min(count, MAX_SPOKEN_QUANTITY);
      continue;
    }
    if (count !== undefined && query.length === 0) {
      // "a", "an", "one" — a count of one, and nothing to record.
      continue;
    }
    if (!FILLER.has(word)) {
      query.push(word);
    }
  }

  return { query, quantity };
}

/**
 * Where the words after a verb phrase begin.
 *
 * Whole-word sequence matching, so "dropping" is not "drop" and a product called
 * "Add-ins" cannot be mistaken for the verb.
 */
function findVerb(words: string[], verbs: string[]): number | null {
  for (const verb of verbs) {
    const parts = verb.split(' ');
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (parts.every((part, offset) => words[i + offset] === part)) {
        return i + parts.length;
      }
    }
  }
  return null;
}

/**
 * "take … off" in either order, which a contiguous match cannot do.
 *
 * The particle is left in the residual for the filler pass to drop, so both
 * "take off the coffee" and "take the coffee off" reduce to the same name — and
 * "take it off" still reduces to nothing, which is the undo it has always been.
 */
function findTakeVerb(words: string[]): number | null {
  const take = words.indexOf('take');
  if (take === -1) {
    return null;
  }
  const hasParticle = words.slice(take + 1).some((word) => TAKE_PARTICLES.includes(word));
  return hasParticle ? take + 1 : null;
}

/** One label that some of the spoken words matched, and how well. */
export interface LabelMatch {
  /** Zero-based index into the labels that were passed in. */
  index: number;
  /** Higher is a better match. Only labels scoring above zero are returned. */
  score: number;
  /**
   * How much of the label was actually said, 0..1.
   *
   * The tie-break, and it earns its place on names that contain each other: a
   * shop selling "Coffee" and "Coffee Cake" scores both the same for a bare
   * "coffee", and only coverage knows that one of them was named completely and
   * the other was named halfway.
   */
  coverage: number;
}

/**
 * Rank labels by how distinctively the spoken words identify them.
 *
 * Scored by distinctiveness rather than by word length. The words that tell two
 * products apart are often the short ones — "oat" milk versus "soy" milk — so a
 * length filter would discard exactly the information that matters. Instead, a
 * word unique to one label counts double and a word shared across several counts
 * single, so "soy milk" ranks the soy first and plain "milk" ties them.
 *
 * Matching is on whole words, which is what prevents substring false positives:
 * "tea" cannot select "Steak Pie". Singular and plural are folded on both sides,
 * because nobody says "add two sandwich".
 *
 * Exported because two callers need it and they want different things from a
 * tie: choosing between candidates refuses to guess, while adding by name shows
 * the tied products as a choice.
 *
 * @returns Matches best first. Equal scores keep the order of `labels`.
 */
export function rankLabelsBySpokenWords(
  spokenWords: readonly string[],
  labels: readonly string[]
): LabelMatch[] {
  const spoken = new Set(spokenWords.map(fold));
  const keysPerLabel = labels.map(
    (label) =>
      new Set(
        // Two characters or fewer are articles and noise, never a product's identity.
        normalize(label)
          .map(fold)
          .filter((word) => word.length > 2)
      )
  );

  // How many labels each word appears in — a word in all of them is useless.
  const occurrences = new Map<string, number>();
  for (const keys of keysPerLabel) {
    for (const key of keys) {
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }
  }

  const matches: LabelMatch[] = [];
  keysPerLabel.forEach((keys, index) => {
    let score = 0;
    let matched = 0;
    for (const key of keys) {
      if (spoken.has(key)) {
        score += (occurrences.get(key) ?? 1) === 1 ? 2 : 1;
        matched++;
      }
    }
    if (score > 0) {
      matches.push({ index, score, coverage: matched / keys.size });
    }
  });

  // Stable: equal scores and equal coverage stay in the order they were offered
  // in, which for candidates is the recognizer's own ranking.
  return matches.sort((left, right) => right.score - left.score || right.coverage - left.coverage);
}

/**
 * Find the one candidate whose name the cashier said.
 *
 * A tie means what was said doesn't distinguish the candidates. Picking the
 * first one would charge for an item nobody named; leaving it unresolved makes
 * the clerk ask again, which is the cheaper mistake.
 *
 * @returns a 1-based position, or null when nothing or more than one thing matched.
 */
function matchCandidateByName(words: string[], labels: string[]): number | null {
  const ranked = rankLabelsBySpokenWords(words, labels);
  const best = ranked[0];
  if (!best) {
    return null;
  }
  const runnerUp = ranked[1];
  if (
    runnerUp !== undefined &&
    runnerUp.score === best.score &&
    runnerUp.coverage === best.coverage
  ) {
    return null;
  }
  return best.index + 1;
}

/** Lowercase, strip punctuation, split on whitespace. */
function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/**
 * Crude singularization, for name matching only.
 *
 * Deliberately not applied in `normalize`: the command vocabulary contains words
 * that end in s ("yes", "thats"), and folding those would break every fixed
 * phrase. Only product names go through here, where the risk is limited to
 * ranking a name slightly differently.
 */
function fold(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

/** True when the phrase contains any of these as a whole-word sequence. */
function matchesAny(phrase: string, needles: string[]): boolean {
  const padded = ` ${phrase} `;
  return needles.some((needle) => padded.includes(` ${needle} `));
}
