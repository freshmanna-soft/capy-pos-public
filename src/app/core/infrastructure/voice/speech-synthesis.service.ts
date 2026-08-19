import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';

/** Slightly higher and a touch quicker than default — reads as friendly, not childish. */
const VOICE_PITCH = 1.15;
const VOICE_RATE = 1.02;

/**
 * If no word-boundary event has arrived this soon after speech starts, assume
 * the browser doesn't fire them and drive the mouth from a timer instead.
 */
const BOUNDARY_GRACE_MS = 400;

/** Fallback cadence, roughly a syllable at conversational speed. */
const FALLBACK_SYLLABLE_MS = 190;

/** Where "this till keeps its voice down" is remembered. */
const MUTE_KEY = 'capy-clerk-muted';

/** Names that tend to map to a warmer voice, best first. */
const PREFERRED_VOICES = ['Samantha', 'Karen', 'Moira', 'Google UK English Female', 'Female'];

/**
 * SpeechSynthesisService
 *
 * The clerk's voice, and the source of her mouth movement.
 *
 * Mouth-sync note, because the implementation looks indirect: browsers give no
 * access to synthesized audio, so there is no waveform to analyse. What they do
 * give is `onboundary`, which fires as each word begins. This service records
 * *when* the last boundary fired and lets the renderer shape the mouth from the
 * elapsed time. The result is convincing at a glance and approximate on close
 * inspection — it tracks words, not phonemes. That is the ceiling of what the
 * platform allows, not a shortcut.
 *
 * Where `onboundary` never fires (some Android and Linux voices), a timer
 * produces pseudo-boundaries at a fixed cadence so the mouth still moves.
 */
@Injectable({ providedIn: 'root' })
export class SpeechSynthesisService {
  /**
   * False when this build has voice switched off or the browser has no synthesis.
   * Either way the HUD hides the audio affordances rather than offering controls
   * that silently do nothing.
   */
  readonly supported =
    environment.clerkVoice.synthesis && typeof globalThis.speechSynthesis !== 'undefined';

  private readonly _speaking = signal(false);
  private readonly _lastBoundaryAt = signal(0);
  private readonly _muted = signal(readMutePreference());

  readonly speaking = this._speaking.asReadonly();
  /**
   * Whether she has been told to keep quiet.
   *
   * Read by the HUD rather than inferred from `speaking`: a clerk with nothing to
   * say and a clerk that has been silenced both sit at `speaking() === false`, and
   * only one of them should show a struck-through speaker.
   */
  readonly muted = this._muted.asReadonly();
  /**
   * `performance.now()` of the most recent word start. The stage reads this every
   * frame to shape the mouth; it is a timestamp rather than an amplitude so all
   * per-frame easing stays in the renderer where the frame clock already is.
   */
  readonly lastBoundaryAt = this._lastBoundaryAt.asReadonly();

  private voice: SpeechSynthesisVoice | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private boundarySeen = false;

  constructor() {
    if (!this.supported) {
      return;
    }
    this.pickVoice();
    // Voice lists populate asynchronously in Chromium; without this the first
    // line of the session speaks in the default robot voice.
    globalThis.speechSynthesis.addEventListener('voiceschanged', () => this.pickVoice());
  }

  /**
   * Say something, interrupting whatever she was saying.
   *
   * Interrupting is the correct policy for a till. If the cashier has already
   * moved on to the next item, finishing the sentence about the previous one is
   * worse than useless — it describes a state that no longer exists.
   *
   * Muted, this does nothing at all rather than queueing silently: callers caption
   * every line they speak, so the words still reach the cashier and there is
   * nothing waiting to be released when the voice comes back.
   */
  speak(text: string): void {
    if (!this.supported || this._muted() || text.trim().length === 0) {
      return;
    }

    this.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = VOICE_PITCH;
    utterance.rate = VOICE_RATE;
    if (this.voice) {
      utterance.voice = this.voice;
    }

    utterance.onstart = () => {
      this._speaking.set(true);
      this.boundarySeen = false;
      this.markBoundary();
      this.armFallback(text);
    };
    utterance.onboundary = () => {
      this.boundarySeen = true;
      this.clearFallback();
      this.markBoundary();
    };
    utterance.onend = () => this.finish();
    utterance.onerror = () => this.finish();

    globalThis.speechSynthesis.speak(utterance);
  }

  /** Stop mid-sentence and close her mouth. */
  cancel(): void {
    if (!this.supported) {
      return;
    }
    globalThis.speechSynthesis.cancel();
    this.finish();
  }

  /**
   * Silence her, or give the voice back.
   *
   * Persisted, unlike the camera and recognition switches. Those are moments in a
   * shift — not in front of this customer, not for this item — while a shop that
   * doesn't want a talking till doesn't want one tomorrow either, and a mute that
   * has to be pressed again every morning gets solved by turning the feature off
   * instead.
   *
   * Two things deliberately keep working while muted. Captions are untouched: the
   * text was always the real channel and the voice the enhancement on top of it.
   * And because `speaking` never goes true, the barge-in guard that pauses the
   * microphone while she talks never fires either — there is no longer any voice
   * for the microphone to mistake for the cashier, so she listens throughout.
   */
  setMuted(muted: boolean): void {
    if (muted === this._muted()) {
      return;
    }
    this._muted.set(muted);
    writeMutePreference(muted);
    if (muted) {
      // Mid-sentence, not at the end of it. A mute that waits for the current line
      // to finish is indistinguishable from one that didn't work.
      this.cancel();
    }
  }

  /** Flip the voice. @returns whether she is muted now. */
  toggleMuted(): boolean {
    this.setMuted(!this._muted());
    return this._muted();
  }

  private finish(): void {
    this.clearFallback();
    this._speaking.set(false);
  }

  private markBoundary(): void {
    this._lastBoundaryAt.set(performance.now());
  }

  /**
   * Start the pseudo-boundary timer, and cancel it if real boundary events turn
   * up. Both run for at most `BOUNDARY_GRACE_MS`, which is short enough that a
   * doubled mouth pulse isn't noticeable.
   */
  private armFallback(text: string): void {
    this.clearFallback();
    const expectedWords = Math.max(1, text.split(/\s+/).length);

    setTimeout(() => {
      if (this.boundarySeen || !this._speaking()) {
        return;
      }
      let pulses = 0;
      this.fallbackTimer = setInterval(() => {
        // Stop roughly when the sentence should be over, in case `onend` is also
        // unreliable on this platform.
        if (!this._speaking() || pulses++ > expectedWords * 3) {
          this.clearFallback();
          return;
        }
        this.markBoundary();
      }, FALLBACK_SYLLABLE_MS);
    }, BOUNDARY_GRACE_MS);
  }

  private clearFallback(): void {
    if (this.fallbackTimer !== null) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private pickVoice(): void {
    const voices = globalThis.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
    if (voices.length === 0) {
      return;
    }
    for (const name of PREFERRED_VOICES) {
      const match = voices.find((v) => v.name.includes(name));
      if (match) {
        this.voice = match;
        return;
      }
    }
    this.voice = voices[0] ?? null;
  }
}

/** Whether this till was left muted. Silence is opt-in, so absent means audible. */
function readMutePreference(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'muted';
  } catch {
    // Private mode or blocked storage: default to speaking, which is the state the
    // HUD shows and the one a new till is expected to be in.
    return false;
  }
}

function writeMutePreference(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? 'muted' : 'audible');
  } catch {
    // Not remembering it is survivable; pressing mute again is one key.
  }
}
