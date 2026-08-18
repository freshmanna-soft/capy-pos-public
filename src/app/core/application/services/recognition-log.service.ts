import { Injectable, inject } from '@angular/core';
import {
  DEFAULT_TENANT_ID,
  DexieDatabase,
  IRecognitionLogDB,
} from '@core/infrastructure/database/dexie-database.service';

/** Which tier of the cascade produced an answer. */
export type RecognitionTier = 'barcode' | 'samples' | 'model';

/**
 * What the cashier did about a proposal.
 *
 * `corrected` and `undone` are the two that matter: both are a recorded wrong answer,
 * and `corrected` comes with the right one attached.
 */
export type RecognitionOutcome =
  | 'auto'
  | 'undone'
  | 'chosen'
  | 'corrected'
  | 'rejected'
  | 'unknown';

/** How often each tier is right, over some window. */
export interface TierAccuracy {
  tier: RecognitionTier;
  /** Attempts recorded. */
  total: number;
  /** Acted on and not undone, or the offered top candidate accepted. */
  correct: number;
  /** Undone, or corrected to a different product. */
  wrong: number;
  /** Nothing proposed, or all candidates rejected. */
  abstained: number;
  /** correct / (correct + wrong). Null when nothing decisive happened. */
  precision: number | null;
}

/** How many recent rows the summary considers. */
const SUMMARY_WINDOW = 500;

/**
 * RecognitionLogService
 *
 * Records what the clerk proposed and what the cashier then did about it.
 *
 * It exists because recognition quality is otherwise unfalsifiable. "It seems to
 * pick the first item" is a real complaint, but it cannot be aimed at without
 * knowing which tier answered, how confident it claimed to be, and whether the
 * cashier had to fix it. The expensive fix — a learned sample index — should be
 * pointed at measured failures rather than remembered ones, and this is the
 * measurement.
 *
 * Every write is fire-and-forget. Telemetry is worth having and is never worth
 * failing a sale over.
 */
@Injectable({ providedIn: 'root' })
export class RecognitionLogService {
  private readonly db = inject(DexieDatabase);

  /**
   * Record a proposal and its outcome.
   *
   * @returns the row id, so a later correction can amend the same row.
   */
  record(entry: {
    tier: RecognitionTier;
    proposedProductId?: string;
    confidence: number;
    candidateCount: number;
    outcome: RecognitionOutcome;
    actualProductId?: string;
  }): string {
    const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const row: IRecognitionLogDB = {
      id,
      tenantId: DEFAULT_TENANT_ID,
      tier: entry.tier,
      confidence: entry.confidence,
      candidateCount: entry.candidateCount,
      outcome: entry.outcome,
      createdAt: new Date(),
      ...(entry.proposedProductId ? { proposedProductId: entry.proposedProductId } : {}),
      ...(entry.actualProductId ? { actualProductId: entry.actualProductId } : {}),
    };

    void this.db.recognitionLog.add(row).catch((error: unknown) => {
      console.warn('[Clerk] Could not record recognition:', error);
    });
    return id;
  }

  /**
   * Amend a row once the cashier's verdict is known.
   *
   * Proposals are logged the moment they are acted on, because that is when the
   * confidence and tier are in hand — but whether it was *right* is only known up to
   * four seconds later, when the undo window closes. So the row is written
   * optimistically and revised.
   */
  amend(id: string, outcome: RecognitionOutcome, actualProductId?: string): void {
    void this.db.recognitionLog
      .update(id, {
        outcome,
        ...(actualProductId ? { actualProductId } : {}),
      })
      .catch((error: unknown) => {
        console.warn('[Clerk] Could not amend recognition:', error);
      });
  }

  /**
   * Per-tier accuracy over the recent window.
   *
   * Reads newest-first and caps at `SUMMARY_WINDOW`: on a busy till this table grows
   * without bound, and the useful question is always "how is it doing now", not
   * "how has it done since installation".
   */
  async summarise(): Promise<TierAccuracy[]> {
    const rows = await this.db.recognitionLog
      .orderBy('createdAt')
      .reverse()
      .limit(SUMMARY_WINDOW)
      .toArray();
    return summariseRows(rows);
  }

  /** Drop the log. Offered so a till can be reset without a rebuild. */
  async clear(): Promise<void> {
    await this.db.recognitionLog.clear();
  }
}

/**
 * Aggregate rows into per-tier accuracy.
 *
 * Split out as a pure function so the arithmetic — which is the part that can be
 * wrong in a way nobody notices — is testable without a database.
 */
export function summariseRows(rows: readonly IRecognitionLogDB[]): TierAccuracy[] {
  const tiers: RecognitionTier[] = ['barcode', 'samples', 'model'];

  return tiers.map((tier) => {
    const mine = rows.filter((row) => row.tier === tier);
    const correct = mine.filter((row) => row.outcome === 'auto' || row.outcome === 'chosen').length;
    const wrong = mine.filter(
      (row) => row.outcome === 'undone' || row.outcome === 'corrected'
    ).length;
    const abstained = mine.filter(
      (row) => row.outcome === 'unknown' || row.outcome === 'rejected'
    ).length;
    const decisive = correct + wrong;

    return {
      tier,
      total: mine.length,
      correct,
      wrong,
      abstained,
      // Null rather than 0 or 1 when nothing decisive happened: a tier that has
      // only ever abstained has no precision, and reporting 0 would read as broken
      // while reporting 1 would read as perfect.
      precision: decisive === 0 ? null : correct / decisive,
    };
  });
}
