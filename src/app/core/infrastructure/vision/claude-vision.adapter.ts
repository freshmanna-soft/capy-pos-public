import { Injectable, inject } from '@angular/core';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import {
  RecognitionRequest,
  RecognitionResult,
  VisionCandidate,
  emptyRecognition,
} from '@core/application/dtos/recognition.dto';
import { VisionRecognizer } from '@core/application/ports/vision-recognizer.port';
import { rankCandidates } from '@core/application/services/candidate-ranking';
import { environment } from '../../../../environments/environment';

/**
 * Wall-clock ceiling for one look.
 *
 * Set to match the recognition Lambda's own timeout, and deliberately not lower.
 * At 8 seconds this was under the p95 of a real call — measured against the local
 * proxy, looks landed anywhere between 3 and 8.3 seconds — so the till would
 * abandon a request the server went on to answer correctly. That is the worst of
 * both outcomes: the shop is billed for the look and the cashier is told the
 * clerk couldn't see, so they hold the item up and are billed again.
 *
 * If a look is genuinely too slow to wait for, the fix is a smaller frame
 * (`CAPTURE_MAX_EDGE`) or a lower effort in the proxy — not giving up on work
 * that has already been paid for.
 */
const REQUEST_TIMEOUT_MS = 15000;

/** Anything the proxy sends beyond this is noise the HUD can't show. */
const MAX_CANDIDATES = 3;

/** Shape the proxy is contracted to return. Validated, never trusted. */
interface ProxyResponse {
  candidates?: unknown;
  utterance?: unknown;
  empty?: unknown;
}

/**
 * ClaudeVisionAdapter
 *
 * Sends a captured frame to this deployment's vision proxy, which calls Claude
 * with the frame and the catalog and returns candidates. Active only when
 * `environment.features.aiVision` is true.
 *
 * The API key lives in the proxy, never here — a browser bundle cannot hold a
 * model credential, so `{apiUrl}/vision/identify` is a required piece of
 * infrastructure, not an indirection. See `infra/vision-proxy/README.md`.
 *
 * Every failure path returns an empty result rather than throwing. The clerk
 * calls this from a scanning loop, and a rejected promise there would end the
 * session over one dropped request; instead the capybara says she didn't catch
 * it and the cashier holds the item up again.
 */
@Injectable()
export class ClaudeVisionAdapter implements VisionRecognizer {
  readonly kind = 'claude';

  private readonly auth = inject(AUTH_GATEWAY);
  /**
   * An absolute `visionApiUrl` wins, so recognition can be pointed at a locally
   * running proxy without dragging the rest of the app's API along with it.
   */
  private readonly endpoint =
    environment.visionApiUrl.length > 0
      ? environment.visionApiUrl
      : `${environment.apiUrl}${environment.visionApiPath}`;

  async identify(request: RecognitionRequest, signal?: AbortSignal): Promise<RecognitionResult> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    // Either the caller moving on or the timeout should cancel the request.
    signal?.addEventListener('abort', () => timeout.abort(), { once: true });

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        signal: timeout.signal,
        headers: this.buildHeaders(),
        body: JSON.stringify({
          image: request.imageBase64,
          mediaType: request.mediaType,
          catalog: request.catalog,
        }),
      });

      if (!response.ok) {
        console.error(`[Vision] Proxy returned ${response.status}`);
        return emptyRecognition("I couldn't reach my eyes just now. Try again?");
      }

      return this.parse((await response.json()) as ProxyResponse, request);
    } catch (error) {
      // An abort from the caller is a normal cancellation, not a failure.
      if (signal?.aborted) {
        return emptyRecognition('');
      }
      console.error('[Vision] Recognition request failed:', error);
      return emptyRecognition("I couldn't reach my eyes just now. Try again?");
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.auth.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Validate the proxy's response into a `RecognitionResult`.
   *
   * Defensive on purpose: this is network input, and a malformed confidence or
   * an unknown product id would otherwise reach the cart. Candidates whose id
   * isn't in the catalog we sent are dropped — the model must choose from the
   * products this till sells, and anything else is a hallucinated SKU.
   */
  private parse(body: ProxyResponse, request: RecognitionRequest): RecognitionResult {
    const known = new Set(request.catalog.map((hint) => hint.id));
    const raw = Array.isArray(body.candidates) ? body.candidates : [];

    // Ranked through the shared rule, which also refuses to let a near-tie act on
    // its own — otherwise the till buys whichever product the model listed first.
    const candidates: VisionCandidate[] = rankCandidates(
      raw
        .map((entry) => this.parseCandidate(entry, known))
        .filter((candidate): candidate is VisionCandidate => candidate !== null)
    ).slice(0, MAX_CANDIDATES);

    const utterance =
      typeof body.utterance === 'string' && body.utterance.trim().length > 0
        ? body.utterance.trim()
        : 'Let me look again.';

    return {
      candidates,
      utterance,
      empty: candidates.length === 0,
    };
  }

  private parseCandidate(entry: unknown, known: Set<string>): VisionCandidate | null {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const record = entry as Record<string, unknown>;
    const productId = record['productId'];
    const label = record['label'];
    const confidence = record['confidence'];

    if (typeof productId !== 'string' || !known.has(productId)) {
      return null;
    }
    if (
      typeof label !== 'string' ||
      typeof confidence !== 'number' ||
      !Number.isFinite(confidence)
    ) {
      return null;
    }

    // Clamping happens in rankCandidates, which every tier goes through.
    return { productId, label, confidence };
  }
}
