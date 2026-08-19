import { InjectionToken } from '@angular/core';
import { RecognitionRequest, RecognitionResult } from '@core/application/dtos/recognition.dto';

/**
 * VisionRecognizer Port
 *
 * Swap seam between the clerk's camera loop and whatever identifies what the
 * camera is pointed at. Mirrors the AuthGateway port convention: interface here
 * in the application layer, implementations in infrastructure, bound through the
 * token below.
 *
 * Implementations MUST NOT throw for ordinary failures (network down, model
 * declined, nothing in frame). The clerk runs this in a loop while a cashier is
 * holding up a product; a rejected promise mid-scan would tear down the session.
 * Return an empty result and let the facade decide what to say.
 */
export interface VisionRecognizer {
  /**
   * Identify the product in one captured frame.
   *
   * @param request Frame plus the catalog to choose from.
   * @param signal Aborts an in-flight call when the cashier moves on.
   */
  identify(request: RecognitionRequest, signal?: AbortSignal): Promise<RecognitionResult>;

  /** Short label for the status line, e.g. 'demo' or 'claude'. */
  readonly kind: string;
}

export const VISION_RECOGNIZER = new InjectionToken<VisionRecognizer>('VISION_RECOGNIZER');
