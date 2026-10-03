import type { DomainEventPayloadMap, DomainEventType } from '@core/domain/events/domain-event';

/**
 * Where application code records domain events (Epic #349).
 *
 * Recording is the durable part: once `record` resolves the event is in IndexedDB and
 * will reach its handlers eventually, across reloads and offline stretches. Callers
 * never wait for non-blocking handlers to finish.
 */
export interface IDomainEventOutbox {
  /** Persist an event and kick off its handlers. Resolves with the event id. */
  record<K extends DomainEventType>(
    type: K,
    aggregateId: string,
    payload: DomainEventPayloadMap[K]
  ): Promise<string>;

  /**
   * Run every unfinished event for one aggregate now, ignoring backoff.
   * Resolves when they have all been handled; rejects with the last handler error
   * otherwise, so a caller that needs the side effect (an image upload that needs the
   * product on the server) can say why it is not there.
   */
  flush(aggregateId: string): Promise<void>;
}
