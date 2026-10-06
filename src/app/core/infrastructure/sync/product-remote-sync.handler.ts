import { Injectable, inject } from '@angular/core';
import { DomainEvent, DomainEventType } from '@core/domain/events/domain-event';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import {
  DOMAIN_EVENT_OUTBOX,
  EventHandler,
  RetryLaterError,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';
import { SyncService } from './sync.service';
import { SyncSessionCredentialService } from './sync-session-credential.service';

/**
 * Keeps pos-api's copy of a product in step with the local one.
 *
 * Before this existed, Inventory saved products to IndexedDB only, so the server had
 * never heard of anything created there — and `POST /api/products/:id/image`, which
 * looks the product up server-side first, answered 404 "Product not found".
 *
 * Reads the product row when it runs rather than trusting a payload snapshot, so the
 * server always receives the latest local state no matter how late the retry is.
 */
@Injectable({ providedIn: 'root' })
export class ProductRemoteSyncHandler implements EventHandler<
  typeof DomainEventType.PRODUCT_UPSERTED
> {
  readonly name = 'product-remote-sync';
  readonly eventType = DomainEventType.PRODUCT_UPSERTED;

  private readonly db = inject(DexieDatabase);
  private readonly sync = inject(SyncService);
  private readonly credential = inject(SyncSessionCredentialService);

  async handle(event: DomainEvent<typeof DomainEventType.PRODUCT_UPSERTED>): Promise<void> {
    const product = await this.db.products.get(event.payload.productId);
    // Gone locally before it ever synced: there is nothing left to send.
    if (!product) return;

    if (!this.sync.isRunning()) throw new RetryLaterError('Sync worker is not running.');
    // Staff specifically, not just "some token": on /shop the worker carries the
    // customer's read-only capability token, and a push under it would only 403.
    // The arbitration lives in SyncSessionCredentialService, so no token decoding here.
    if (!this.credential.carriesStaffCredential()) {
      throw new RetryLaterError(
        'No staff session on the sync worker; the product syncs after sign-in.'
      );
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new RetryLaterError('Offline; the product syncs when the connection is back.');
    }

    await this.sync.pushUpsertAsync({
      id: product.id,
      name: product.name,
      price: product.price,
      category: product.category,
      stock: product.quantity,
      description: product.description,
      isActive: product.isActive && !product.deletedAt,
    });
  }
}

/**
 * Makes sure a product exists on the server before something depends on that.
 *
 * Records a fresh upsert and flushes it, rather than only flushing what is pending,
 * because the products that need it most were saved before the outbox existed and
 * have no event at all. An extra upsert is harmless: it is idempotent.
 */
@Injectable({ providedIn: 'root' })
export class ProductServerCopyService {
  private readonly outbox = inject(DOMAIN_EVENT_OUTBOX);

  async ensureOnServer(productId: string): Promise<void> {
    await this.outbox.record(DomainEventType.PRODUCT_UPSERTED, productId, { productId });
    await this.outbox.flush(productId);
  }
}
