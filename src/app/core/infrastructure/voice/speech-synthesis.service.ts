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

  readonly speaking = this._speaking.asReadonly();
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
   */
  speak(text: string): void {
    if (!this.supported || text.trim().length === 0) {
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
