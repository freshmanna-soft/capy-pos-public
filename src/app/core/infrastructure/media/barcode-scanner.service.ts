import { Injectable, signal } from '@angular/core';
import { ScannedCode } from '@core/infrastructure/media/barcode-gate';

/**
 * Retail symbologies plus QR.
 *
 * Narrowed on purpose: every extra format is more work per frame, and a till only
 * ever sees these. EAN and UPC cover packaged goods, Code 128 and Code 39 cover
 * shelf and warehouse labels, ITF covers cartons.
 */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

/** Minimal structural types — `BarcodeDetector` is not in `lib.dom` yet. */
interface DetectedBarcodeLike {
  readonly rawValue: string;
  readonly format: string;
  readonly boundingBox: { x: number; y: number; width: number; height: number };
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcodeLike[]>;
}
interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/**
 * BarcodeScannerService
 *
 * Reads barcodes out of the live video, on device, for nothing.
 *
 * This is the cheapest path through the whole clerk: a barcode is unambiguous and
 * the detection is local, so a barcoded item costs **no** recognition call at all.
 * The AI path stays as the fallback for produce, bakery, and anything whose label
 * is turned away — which is what it is good at and what a laser scanner cannot do.
 *
 * `BarcodeDetector` is not universally available: it ships on Chromium on macOS,
 * Android and ChromeOS, and is absent on Safari, Firefox, and Chromium on Windows
 * and Linux. So this is strictly an accelerator — `supported` is false elsewhere
 * and the clerk simply keeps using its eyes.
 */
@Injectable({ providedIn: 'root' })
export class BarcodeScannerService {
  private readonly ctor = resolveDetectorConstructor();

  private readonly _supported = signal(false);
  /**
   * Whether this browser can read barcodes.
   *
   * Starts false and is confirmed asynchronously: the constructor existing is not
   * proof that any usable format is implemented, and `getSupportedFormats` is the
   * only honest check.
   */
  readonly supported = this._supported.asReadonly();

  private detector: BarcodeDetectorLike | null = null;
  /** One detection in flight at a time; `detect` is slower than the tick. */
  private busy = false;

  /**
   * Prepare the detector. Safe to call repeatedly.
   *
   * @returns true when barcode scanning is available.
   */
  async prepare(): Promise<boolean> {
    if (this.detector !== null) {
      return true;
    }
    if (this.ctor === null) {
      return false;
    }

    try {
      // A constructor with no formats in common with our list is no use, and
      // asking is cheaper than discovering it per frame.
      const available = (await this.ctor.getSupportedFormats?.()) ?? FORMATS;
      const usable = FORMATS.filter((format) => available.includes(format));
      if (usable.length === 0) {
        return false;
      }
      this.detector = new this.ctor({ formats: usable });
      this._supported.set(true);
      return true;
    } catch (error) {
      console.warn('[Barcode] Detector unavailable:', error);
      return false;
    }
  }

  /**
   * Read the codes in one frame.
   *
   * Boxes come back normalised to the frame, not in device pixels, so nothing
   * downstream has to know the camera's resolution — and switching to a camera
   * with a different resolution cannot silently move the overlay.
   *
   * Returns **null** when this frame was not examined — a previous detection is
   * still running, or the video has no pixels yet. That is deliberately not the
   * same value as "examined, found nothing": the caller's dedupe measures how long
   * a code has been absent, and reporting an unexamined frame as empty would let a
   * slow decoder convince it that a code the cashier is still holding had been
   * taken away and brought back, adding the item twice.
   */
  async detect(video: HTMLVideoElement): Promise<ScannedCode[] | null> {
    if (this.detector === null || this.busy) {
      return null;
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) {
      return null;
    }

    this.busy = true;
    try {
      const found = await this.detector.detect(video);
      return found.map((code) => ({
        value: code.rawValue,
        format: code.format,
        box: {
          x: code.boundingBox.x / width,
          y: code.boundingBox.y / height,
          width: code.boundingBox.width / width,
          height: code.boundingBox.height / height,
        },
      }));
    } catch {
      // Detection throws on a frame the decoder dislikes. Report it as unexamined
      // rather than empty, for the same reason as above.
      return null;
    } finally {
      this.busy = false;
    }
  }
}

function resolveDetectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }
  const ctor = (globalThis as unknown as Record<string, unknown>)['BarcodeDetector'];
  return typeof ctor === 'function' ? (ctor as BarcodeDetectorConstructor) : null;
}
