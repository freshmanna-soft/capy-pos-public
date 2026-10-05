import { Injectable, inject } from '@angular/core';
import { DomainEvent, DomainEventType } from '@core/domain/events/domain-event';
import {
  EventHandler,
  RetryLaterError,
  TerminalHandlerError,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';
import { SyncService } from './sync.service';
import { SyncSessionCredentialService } from './sync-session-credential.service';

/** The receipt key. Stable across releases: renaming it re-sends every old sale. */
export const SALE_REMOTE_SYNC_HANDLER = 'sale-remote-sync';

type SaleCompleted = typeof DomainEventType.SALE_COMPLETED;

/**
 * Delivers each SaleCompleted event to pos-api's `POST /api/events` (#359), so the
 * server applies the sale to its own stock, at least once and exactly once in effect.
 *
 * Registered only when `environment.features.eventSync` is on. The outbox dispatcher
 * provides what the story asks for:
 * - **Marked delivered only after the ack.** The receipt is written once this resolves.
 * - **A crash or reload mid-POST resends.** There is no receipt yet, so the event goes
 *   again, and the server answers `duplicate`.
 * - **One drain at a time, across tabs.** The dispatcher serializes its work under a
 *   Web Lock.
 *
 * Verdicts:
 * - `applied` and `duplicate` are delivered.
 * - `rejected` and `conflict` will never succeed. The event goes dead and is reported
 *   (audit log + agent monitor, and a toast for managers), never retried forever.
 * - `retry`, or a failed request, throws, and the dispatcher retries with backoff.
 * - No session, offline, a 401/403, or the server's flag still off: the event is
 *   parked without spending an attempt. A 401 never opens the sync circuit (see
 *   `pushEvents` in the worker).
 */
@Injectable({ providedIn: 'root' })
export class SaleRemoteSyncHandler implements EventHandler<SaleCompleted> {
  readonly name = SALE_REMOTE_SYNC_HANDLER;
  readonly eventType = DomainEventType.SALE_COMPLETED;

  private readonly sync = inject(SyncService);
  private readonly credential = inject(SyncSessionCredentialService);

  async handle(event: DomainEvent<SaleCompleted>): Promise<void> {
    if (!this.sync.isRunning()) throw new RetryLaterError('Sync worker is not running.');
    // Any credential will do: staff, kiosk-device or shop-session. pos-api decides
    // what each may publish (#358).
    if (!this.credential.token()) {
      throw new RetryLaterError('Nobody is signed in; the sale syncs after sign-in.');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new RetryLaterError('Offline; the sale syncs when the connection is back.');
    }

    const outcome = await this.sync.pushEventsAsync([
      {
        eventId: event.id,
        type: event.type,
        ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }),
        payload: event.payload,
      },
    ]);
    if (!outcome.ok) {
      if (outcome.retryLater) throw new RetryLaterError(outcome.error);
      throw new Error(outcome.error);
    }

    const ack = outcome.results.find((result) => result.eventId === event.id);
    switch (ack?.status) {
      case 'applied':
      case 'duplicate':
        return;
      case 'rejected':
      case 'conflict':
        throw new TerminalHandlerError(`pos-api ${ack.status} the sale: ${ack.error ?? ''}`);
      case 'retry':
        throw new Error(`pos-api asked to resend: ${ack.error ?? ''}`);
      default:
        throw new Error('pos-api answered without a verdict for this event.');
    }
  }
}
