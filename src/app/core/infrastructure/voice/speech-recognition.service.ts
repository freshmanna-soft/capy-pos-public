import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';

/**
 * Minimal structural types for the Web Speech recognition API.
 *
 * Declared locally under distinct names rather than relying on `lib.dom` so this
 * compiles whether or not the installed TypeScript ships the (still
 * vendor-prefixed on some engines) definitions.
 */
interface RecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface RecognitionCandidate {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): RecognitionAlternative;
}
interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; item(index: number): RecognitionCandidate };
}
interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type RecognitionConstructor = new () => RecognitionLike;

/** Backoff before restarting a recognizer the engine dropped. */
const RESTART_DELAY_MS = 400;

/**
 * SpeechRecognitionService
 *
 * The clerk's ear. Runs continuous recognition while the mic is on and pushes
 * final phrases to a callback; the facade turns those into intents.
 *
 * Two behaviours here exist because of how the platform actually works, and both
 * are load-bearing:
 *
 * 1. **Barge-in guard.** Recognition must be suspended while the clerk is
 *    speaking. Otherwise her own voice comes back through the microphone, she
 *    hears "one avocado added", parses no intent from it, and in the worst case
 *    answers her own question. The facade calls `pause`/`resume` around speech.
 *
 * 2. **Restart watchdog.** Browser recognizers stop on their own — after silence,
 *    after a network hiccup, after an error — and do not resume. Without a
 *    watchdog the mic appears on and quietly stops hearing anything a minute in,
 *    which is the single most confusing failure this feature can have.
 *
 * Requires a secure context (HTTPS or localhost) and is Chromium/Safari-only.
 * When unsupported, `supported` is false and the HUD hides the mic entirely
 * rather than offering a control that can't work.
 */
@Injectable({ providedIn: 'root' })
export class SpeechRecognitionService {
  private readonly ctor = resolveRecognitionConstructor();

  readonly supported = environment.clerkVoice.recognition && this.ctor !== null;

  private readonly _listening = signal(false);
  private readonly _interim = signal('');

  /** True while the recognizer is actually running (not merely wanted). */
  readonly listening = this._listening.asReadonly();
  /** Live partial transcript, for the HUD's "heard so far" line. */
  readonly interim = this._interim.asReadonly();

  private recognition: RecognitionLike | null = null;
  /** What the facade asked for. Distinct from whether the engine is running. */
  private wanted = false;
  /** Suspended for barge-in — wanted, but deliberately not running. */
  private suspended = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private onPhrase: ((transcript: string) => void) | null = null;

  /** Register the sink for completed phrases. */
  onFinalPhrase(handler: (transcript: string) => void): void {
    this.onPhrase = handler;
  }

  start(): void {
    if (!this.supported) {
      return;
    }
    this.wanted = true;
    this.suspended = false;
    this.launch();
  }

  stop(): void {
    this.wanted = false;
    this.suspended = false;
    this.clearRestart();
    this._interim.set('');
    this.teardown();
  }

  /** Stop hearing, but stay armed. Used while the clerk is talking. */
  pause(): void {
    if (!this.wanted || this.suspended) {
      return;
    }
    this.suspended = true;
    this.clearRestart();
    this.teardown();
  }

  /** Resume after `pause`. No-op if the mic was turned off in between. */
  resume(): void {
    if (!this.wanted || !this.suspended) {
      return;
    }
    this.suspended = false;
    this.launch();
  }

  private launch(): void {
    if (this.ctor === null || this.recognition !== null || this.suspended || !this.wanted) {
      return;
    }

    const recognition = new this.ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => this._listening.set(true);

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results.item(i);
        const text = result.item(0).transcript;
        if (result.isFinal) {
          this._interim.set('');
          this.onPhrase?.(text);
        } else {
          interim += text;
        }
      }
      if (interim.length > 0) {
        this._interim.set(interim.trim());
      }
    };

    recognition.onerror = (event) => {
      // `no-speech` and `aborted` are routine — the watchdog handles them. A
      // permission failure is terminal, so stop asking.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.warn('[Voice] Microphone permission denied; disabling recognition.');
        this.wanted = false;
      }
    };

    recognition.onend = () => {
      this._listening.set(false);
      this.recognition = null;
      // The engine stops itself constantly. If we still want to be listening,
      // bring it straight back.
      if (this.wanted && !this.suspended) {
        this.scheduleRestart();
      }
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      // `start()` throws if called while an instance is already running.
      // Dropping this attempt is correct — the running one is still listening.
      this.recognition = null;
    }
  }

  private scheduleRestart(): void {
    this.clearRestart();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.launch();
    }, RESTART_DELAY_MS);
  }

  private clearRestart(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private teardown(): void {
    const recognition = this.recognition;
    if (!recognition) {
      return;
    }
    // Detach first: `abort()` fires `onend`, which would otherwise schedule the
    // restart we are trying to prevent.
    recognition.onend = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onstart = null;
    this.recognition = null;
    this._listening.set(false);
    try {
      recognition.abort();
    } catch {
      // Already stopped.
    }
  }
}

function resolveRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }
  const scope = globalThis as unknown as Record<string, unknown>;
  const ctor = scope['SpeechRecognition'] ?? scope['webkitSpeechRecognition'];
  return typeof ctor === 'function' ? (ctor as RecognitionConstructor) : null;
}
