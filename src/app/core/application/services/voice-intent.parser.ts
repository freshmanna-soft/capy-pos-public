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
  /** Take the last thing off the cart. */
  | { kind: 'undo' }
  /** Read the running total. */
  | { kind: 'total' }
  /** Go to payment. */
  | { kind: 'checkout' }
  /** Stop listening. */
  | { kind: 'mute' }
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
 *   Product-name matching is scoped to these — the clerk should never act on a
 *   name it isn't currently offering.
 */
export function parseClerkIntent(transcript: string, candidateLabels: string[] = []): ClerkIntent {
  const words = normalize(transcript);
  if (words.length === 0) {
    return { kind: 'unknown' };
  }

  const command = matchCommand(words.join(' '));
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
 */
function matchCommand(phrase: string): ClerkIntent | null {
  if (matchesAny(phrase, ['stop listening', 'mute', 'be quiet', 'stop talking'])) {
    return { kind: 'mute' };
  }
  if (matchesAny(phrase, ['undo', 'remove that', 'take it off', 'take that off', 'cancel that'])) {
    return { kind: 'undo' };
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
 * Find a candidate whose name the cashier said.
 *
 * Scored by distinctiveness rather than by word length. The words that tell two
 * candidates apart are often the short ones — "oat" milk versus "soy" milk — so a
 * length filter would discard exactly the information that matters. Instead, a
 * word unique to one candidate counts double and a word shared across several
 * counts single, so "soy milk" picks the soy and plain "milk" picks nothing when
 * both are on offer.
 *
 * Matching is on whole words, which is what prevents substring false positives:
 * "tea" cannot select "Steak Pie".
 */
function matchCandidateByName(words: string[], labels: string[]): number | null {
  const spoken = new Set(words);
  const keysPerLabel = labels.map((label) =>
    // Two characters or fewer are articles and noise, never a product's identity.
    normalize(label).filter((word) => word.length > 2)
  );

  // How many candidates each word appears in — a word in all of them is useless.
  const occurrences = new Map<string, number>();
  for (const keys of keysPerLabel) {
    for (const key of new Set(keys)) {
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }
  }

  let bestIndex: number | null = null;
  let bestScore = 0;
  let tied = false;

  keysPerLabel.forEach((keys, position) => {
    let score = 0;
    for (const key of new Set(keys)) {
      if (spoken.has(key)) {
        score += (occurrences.get(key) ?? 1) === 1 ? 2 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = position + 1;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  });

  // A tie means what was said doesn't distinguish the candidates. Picking the
  // first one would charge for an item nobody named; leaving it unresolved makes
  // the clerk ask again, which is the cheaper mistake.
  return bestScore > 0 && !tied ? bestIndex : null;
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

/** True when the phrase contains any of these as a whole-word sequence. */
function matchesAny(phrase: string, needles: string[]): boolean {
  const padded = ` ${phrase} `;
  return needles.some((needle) => padded.includes(` ${needle} `));
}
