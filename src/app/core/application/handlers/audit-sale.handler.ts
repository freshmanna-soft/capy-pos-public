import { Injectable, inject } from '@angular/core';
import { DomainEvent, DomainEventType } from '@core/domain/events/domain-event';
import {
  AuditAction,
  AuditLogService,
  AuditStatus,
} from '@core/infrastructure/audit/audit-log.service';
import { EventHandler } from '@core/infrastructure/messaging/outbox-dispatcher.service';

/** The receipt key. Stable across releases: renaming it re-runs every old sale. */
export const AUDIT_SALE_HANDLER = 'audit-sale';

type SaleCompleted = typeof DomainEventType.SALE_COMPLETED;

/** The audit row for one sale's event: re-delivery overwrites it rather than adding one. */
export function saleAuditId(eventId: string): string {
  return `sale-audit:${eventId}`;
}

/**
 * Writes the sale to the audit log, which feeds the agent-monitor dashboard (#356).
 *
 * The audit log lives in its own `AuditDatabase`, so its row cannot share a Dexie
 * transaction with the outbox. Idempotency comes from the row id instead: it is
 * derived from the event id and written with `put`, so a re-delivered event leaves
 * exactly one row. A failed write throws, and the dispatcher retries it.
 */
@Injectable({ providedIn: 'root' })
export class AuditSaleHandler implements EventHandler<SaleCompleted> {
  readonly name = AUDIT_SALE_HANDLER;
  readonly eventType = DomainEventType.SALE_COMPLETED;

  private readonly auditLog = inject(AuditLogService);

  async handle(event: DomainEvent<SaleCompleted>): Promise<void> {
    const { transactionId, method, amount } = event.payload;
    await this.auditLog.log(
      {
        agentName: 'PaymentAgent',
        operation: 'processPayment',
        entityType: 'Transaction',
        entityId: transactionId,
        action: AuditAction.EXECUTE,
        status: AuditStatus.SUCCESS,
        metadata: {
          method,
          amount,
          ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }),
        },
      },
      { id: saleAuditId(event.id) }
    );
  }
}
