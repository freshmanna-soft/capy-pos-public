import { Injectable, inject } from '@angular/core';
import {
  DEFAULT_TENANT_ID,
  DexieDatabase,
  IRecognitionSampleDB,
} from '@core/infrastructure/database/dexie-database.service';
import { RecognitionOutcome, RecognitionTier } from './recognition-log.service';

/** How many samples one product is allowed to keep before the oldest are evicted. */
const DEFAULT_PER_PRODUCT_CAP = 200;

/**
 * RecognitionSampleService
 *
 * The pixels behind a human-confirmed recognition — the counterpart
 * `RecognitionLogService` deliberately doesn't keep.
 *
 * `RecognitionLogService` records *that* a proposal was right or wrong; this
 * records *what it looked like*, so a future on-device classifier has
 * something to train on. Only `chosen`/`corrected` outcomes are worth a
 * sample — those are the only rows with a human-confirmed ground truth. An
 * auto-add was never checked by anyone, and a rejection has no product to
 * label the frame with.
 *
 * Every write is fire-and-forget, same reasoning as `RecognitionLogService`:
 * a training sample is worth having and never worth failing a sale over.
 */
@Injectable({ providedIn: 'root' })
export class RecognitionSampleService {
  private readonly db = inject(DexieDatabase);

  /**
   * Record the frame behind a `chosen`/`corrected` log row.
   *
   * `imageBase64` is converted to a `Blob` here rather than by the caller —
   * IndexedDB stores a `Blob` natively, and doing the conversion at the one
   * write site keeps every caller passing the same bare base64 string
   * `camera.service.ts::captureFrame()` already produces.
   */
  record(entry: {
    logId: string;
    productId: string;
    tier: RecognitionTier;
    outcome: RecognitionOutcome;
    imageBase64: string;
    width: number;
    height: number;
  }): void {
    const row: IRecognitionSampleDB = {
      id: `smp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: DEFAULT_TENANT_ID,
      logId: entry.logId,
      productId: entry.productId,
      tier: entry.tier,
      outcome: entry.outcome,
      imageBlob: base64ToBlob(entry.imageBase64),
      width: entry.width,
      height: entry.height,
      createdAt: new Date(),
    };

    void this.db.recognitionSamples.add(row).catch((error: unknown) => {
      console.warn('[Clerk] Could not record recognition sample:', error);
    });
  }

  /** How many samples exist for one product, for a cap check or a status line. */
  async countByProduct(productId: string): Promise<number> {
    return this.db.recognitionSamples.where('productId').equals(productId).count();
  }

  /**
   * Every sample, for the offline training export.
   *
   * Deliberately the only path off the device: this must stay a call a human
   * makes on demand, never a background sync — see the privacy note on the
   * feature this belongs to.
   */
  async exportAll(): Promise<IRecognitionSampleDB[]> {
    return this.db.recognitionSamples.toArray();
  }

  /**
   * Evict a product's oldest samples down to `perProductCap`.
   *
   * `'corrected'` rows are protected ahead of `'chosen'` ones — a mistake
   * paired with its correction is the rarer and more valuable sample, and
   * FIFO eviction alone would treat it the same as an ordinary confirmation.
   */
  async pruneOldest(productId: string, perProductCap = DEFAULT_PER_PRODUCT_CAP): Promise<void> {
    const rows = await this.db.recognitionSamples.where('productId').equals(productId).toArray();
    if (rows.length <= perProductCap) {
      return;
    }

    const byPriority = [...rows].sort((a, b) => {
      if (a.outcome !== b.outcome) {
        return a.outcome === 'corrected' ? 1 : -1; // corrected sorts last, evicted last
      }
      return a.createdAt.getTime() - b.createdAt.getTime(); // oldest first within a group
    });

    const toEvict = byPriority.slice(0, rows.length - perProductCap);
    await this.db.recognitionSamples.bulkDelete(toEvict.map((row) => row.id));
  }

  /** Drop every sample. Offered so a till's local training set can be reset. */
  async clear(): Promise<void> {
    await this.db.recognitionSamples.clear();
  }
}

function base64ToBlob(base64: string, mediaType = 'image/jpeg'): Blob {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mediaType });
}
