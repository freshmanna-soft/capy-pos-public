import { Injectable } from '@angular/core';
import {
  CatalogHint,
  RecognitionRequest,
  RecognitionResult,
  VisionCandidate,
  emptyRecognition,
} from '@core/application/dtos/recognition.dto';
import { VisionRecognizer } from '@core/application/ports/vision-recognizer.port';

/** How long a fake look takes, so the UI exercises its real loading states. */
const MIN_LATENCY_MS = 400;
const MAX_LATENCY_MS = 900;

/**
 * MockVisionAdapter
 *
 * The recognizer used when `environment.features.aiVision` is off — every
 * environment today. It lets the whole clerk experience run with no API key, no
 * network, and no cost, which matters for three reasons: the unit and e2e suites
 * need a recognizer with fixed output, a demo needs to work on a plane, and the
 * UI needs a way to reach all three confidence branches on demand.
 *
 * It is deliberately deterministic rather than random. Each call advances a
 * counter and the counter picks the confidence band, cycling high → medium →
 * low → high. A test can therefore assert "the third call asks the cashier to
 * show the item again" without stubbing anything, and a demo always walks the
 * same path. The only nondeterminism is the simulated latency, which nothing
 * asserts on.
 *
 * Products come from `request.catalog`, so this adapter has no dependency on the
 * product repository — it names things the till really sells.
 */
@Injectable()
export class MockVisionAdapter implements VisionRecognizer {
  readonly kind = 'demo';

  private callCount = 0;

  async identify(request: RecognitionRequest, signal?: AbortSignal): Promise<RecognitionResult> {
    const catalog = request.catalog;
    const call = this.callCount++;

    await this.pause(signal);
    if (signal?.aborted) {
      return emptyRecognition('');
    }

    if (catalog.length === 0) {
      return emptyRecognition("There's nothing in the catalog to match against.");
    }

    // Band cycles every call so all three UX branches are reachable in order.
    const band = call % 3;
    // Rotate the starting product so consecutive scans don't all name the same
    // thing — a demo where every item is an avocado teaches the wrong lesson.
    const offset = Math.floor(call / 3) % catalog.length;

    if (band === 0) {
      return this.highConfidence(catalog, offset);
    }
    if (band === 1) {
      return this.mediumConfidence(catalog, offset);
    }
    return this.lowConfidence();
  }

  /** One clear winner — the facade will auto-add this. */
  private highConfidence(catalog: CatalogHint[], offset: number): RecognitionResult {
    const hint = catalog[offset]!;
    return {
      candidates: [{ productId: hint.id, label: hint.name, confidence: 0.93 }],
      utterance: `One ${hint.name.toLowerCase()}, added.`,
      empty: false,
    };
  }

  /** A close call — the facade will show these and wait to be told which. */
  private mediumConfidence(catalog: CatalogHint[], offset: number): RecognitionResult {
    const confidences = [0.74, 0.63, 0.55];
    const candidates: VisionCandidate[] = [];

    for (let i = 0; i < Math.min(3, catalog.length); i++) {
      const hint = catalog[(offset + i) % catalog.length]!;
      candidates.push({ productId: hint.id, label: hint.name, confidence: confidences[i]! });
    }

    return {
      candidates,
      utterance: 'Which one is it?',
      empty: false,
    };
  }

  /** Nothing usable — the facade will ask for another look. */
  private lowConfidence(): RecognitionResult {
    return emptyRecognition("I can't tell what that is. Turn the label towards me?");
  }

  /**
   * Simulated round-trip. Resolves early on abort so a cancelled scan doesn't
   * hold a timer open for the better part of a second.
   */
  private pause(signal?: AbortSignal): Promise<void> {
    const ms = MIN_LATENCY_MS + Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }
}
