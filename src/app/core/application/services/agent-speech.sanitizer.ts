import { MAX_SPEECH_WORDS } from '@core/application/dtos/agent.dto';

/**
 * The speech budget, in words, re-exported from the DTO it is declared beside.
 *
 * Declared once, over there, because the port's contract already talks about it;
 * re-exported here because this is the module that *enforces* it, and a caller
 * asserting the budget should not have to know which of the two files owns the
 * number.
 */
export { MAX_SPEECH_WORDS };

/**
 * What the till knows that the model does not, at the moment it answers.
 *
 * Both fields are volatile and read per answer rather than passed once: the
 * catalogue is reloaded at `start()`, and the cards come and go inside a turn.
 */
export interface AgentSpeechContext {
  /**
   * Catalogue name by every code a model might name it with — SKU, barcode and
   * product id. Keys are matched case-insensitively.
   *
   * A code the model quotes is a code the cashier never hears in a useful form:
   * Web Speech reads `#` as "hash", spells a SKU letter by letter, and reads a
   * UUID as a minute of hexadecimal. The name is what she asked about.
   */
  namesByCode: ReadonlyMap<string, string>;
  /**
   * Whether candidate cards are on screen right now.
   *
   * When they are, the clerk must not name a position out loud. The next thing
   * the cashier says is scored as her choice between the recognizer's ranked
   * candidates (`chooseCandidate` writes a `'chosen'` / `'corrected'` row), so a
   * model that says "take the second one" has contaminated that row: it now
   * measures agreement with the model rather than with the recognizer.
   */
  offerOnScreen: boolean;
}

/** Fenced blocks first: their contents are code, not prose, and are dropped whole. */
const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`([^`]*)`/g;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
/**
 * Pictographs, including the variation selectors and joiners that hold a
 * multi-codepoint emoji together — dropping the pictographs alone would leave
 * the joiners behind for the synthesizer to puzzle over.
 *
 * An alternation rather than a character class, because a class listing a joiner
 * and a variation selector reads as though it matched the composed sequence. It
 * never did: each branch matches one code point, and the global replace sweeps a
 * flag or a family emoji away one code point at a time.
 */
const EMOJI = /\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|\u{20E3}/gu;
/** Heading hashes and list bullets, at the start of a line only. */
const LINE_MARKER = /^[ \t]*(?:#{1,6}[ \t]*|[-*+][ \t]+|\d+\.[ \t]+)/gm;
/** Emphasis runs, keeping the emphasized words. */
const EMPHASIS = /(\*{1,3}|_{1,3}|~{2})(?=\S)([\s\S]*?\S)\1/g;

/**
 * Tokens that are an identifier rather than a word.
 *
 * Three shapes, kept as three patterns because they fail differently: a hyphenated
 * SKU, a UUID, and a bare barcode-length digit run. The digit run is deliberately
 * floored at eight so a price, a quantity and a year all read normally.
 */
const CODE_TOKENS = [
  /#?\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /#?\b[A-Za-z]{2,}[-_][A-Za-z0-9]*\d[A-Za-z0-9-]*\b/g,
  /#?\b\d{8,14}\b/g,
];

/** What a code with no catalogue name behind it becomes. */
const ANONYMOUS_CODE = 'that one';

/**
 * Naming a card by its position, in the two ways a model writes it.
 *
 * Both replaced rather than deleted: a sentence with a hole where its object was
 * is worse to listen to than one that says "that one".
 */
const POSITION_PHRASES = [
  /\b(?:card|option|number|position|choice)\s+(?:one|two|three|four|[1-4])\b/gi,
  /\b(?:the\s+)?(?:first|second|third|fourth)\s+(?:one|option|card|choice)\b/gi,
];

/**
 * Make one model answer safe to read aloud.
 *
 * Every rule here exists because the output goes to a speech synthesizer in a
 * shop, not to a screen: markup is read as punctuation, a URL is read as a URL, an
 * identifier is spelled out, and the whole utterance pauses the microphone for as
 * long as it takes to say — which is why the length cap is the last thing applied
 * and the least negotiable.
 *
 * Never throws and never returns markup. An empty result is a valid answer: `say()`
 * already treats blank text as nothing to say, which is the right outcome for a
 * model that answered with only a code fence.
 */
export function sanitizeAgentSpeech(text: string, ctx: AgentSpeechContext): string {
  const plain = stripMarkup(text);
  const named = nameCodes(plain, ctx.namesByCode);
  const steered = ctx.offerOnScreen ? dropPositions(named) : named;
  return trimToBudget(collapse(steered));
}

/** Markdown, URLs and emoji out; the words they decorated kept. */
function stripMarkup(text: string): string {
  return text
    .replace(CODE_FENCE, ' ')
    .replace(INLINE_CODE, '$1')
    .replace(URL, ' ')
    .replace(EMOJI, ' ')
    .replace(LINE_MARKER, '')
    .replace(EMPHASIS, '$2');
}

/**
 * Every identifier becomes the name it refers to, or `that one`.
 *
 * The lookup is case-insensitive because a model quoting `sku-8891` back at us
 * means the same product as `SKU-8891`, and a case-sensitive miss would silently
 * downgrade a nameable product to a positional reference.
 */
function nameCodes(text: string, namesByCode: ReadonlyMap<string, string>): string {
  const names = new Map<string, string>();
  for (const [code, name] of namesByCode) {
    names.set(code.toLowerCase(), name);
  }
  let out = text;
  for (const pattern of CODE_TOKENS) {
    out = out.replace(pattern, (match) => {
      const key = match.replace(/^#/, '').toLowerCase();
      return names.get(key) ?? ANONYMOUS_CODE;
    });
  }
  return out;
}

function dropPositions(text: string): string {
  let out = text;
  for (const pattern of POSITION_PHRASES) {
    out = out.replace(pattern, ANONYMOUS_CODE);
  }
  return out;
}

/** One space between words, no space before punctuation the stripping left orphaned. */
function collapse(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

/**
 * Cut to the budget at the last sentence that fits.
 *
 * Words first, so a cut can never land mid-word, and then back to the last
 * sentence-ending punctuation inside those words. Falling back to the whole-word
 * cut when there is no sentence boundary is deliberate: an answer that is one long
 * clause still has to fit, and a whole-word cut is the least bad way to make it.
 */
function trimToBudget(text: string): string {
  const words = text.split(' ').filter((word) => word.length > 0);
  if (words.length <= MAX_SPEECH_WORDS) {
    return text;
  }
  const clipped = words.slice(0, MAX_SPEECH_WORDS).join(' ');
  const lastSentence = Math.max(
    clipped.lastIndexOf('.'),
    clipped.lastIndexOf('!'),
    clipped.lastIndexOf('?')
  );
  return lastSentence > 0 ? clipped.slice(0, lastSentence + 1) : clipped;
}
