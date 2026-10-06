import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DomainEvent, DomainEventType } from '@core/domain/events/domain-event';
import { DexieDatabase, IProductDB } from '@core/infrastructure/database/dexie-database.service';
import {
  DOMAIN_EVENT_OUTBOX,
  RetryLaterError,
} from '@core/infrastructure/messaging/outbox-dispatcher.service';
import { ProductRemoteSyncHandler, ProductServerCopyService } from './product-remote-sync.handler';
import { SyncService } from './sync.service';
import { SyncSessionCredentialService } from './sync-session-credential.service';

const UPSERTED = DomainEventType.PRODUCT_UPSERTED;

function upserted(productId: string): DomainEvent<typeof UPSERTED> {
  return {
    id: 'e1',
    type: UPSERTED,
    aggregateId: productId,
    payload: { productId },
    attempts: 0,
    createdAt: new Date(),
  };
}

function product(overrides: Partial<IProductDB> = {}): IProductDB {
  const now = new Date();
  return {
    id: '24687b42-ac2b-4af3-bc7b-0f1e3fca68d3',
    name: 'Alfalfa',
    description: '',
    sku: 'FEED-7',
    category: 'Feed',
    price: 9.5,
    cost: 4,
    quantity: 7,
    minStockLevel: 2,
    unit: 'piece',
    taxRate: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ProductRemoteSyncHandler', () => {
  let handler: ProductRemoteSyncHandler;
  let db: DexieDatabase;
  let sync: { isRunning: ReturnType<typeof vi.fn>; pushUpsertAsync: ReturnType<typeof vi.fn> };
  const carriesStaffCredential = signal(true);

  beforeEach(() => {
    carriesStaffCredential.set(true);
    sync = {
      isRunning: vi.fn().mockReturnValue(true),
      pushUpsertAsync: vi.fn().mockResolvedValue({ productId: 'x', success: true, status: 201 }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: SyncSessionCredentialService, useValue: { carriesStaffCredential } },
      ],
    });
    db = TestBed.inject(DexieDatabase);
    handler = TestBed.inject(ProductRemoteSyncHandler);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.delete();
    TestBed.resetTestingModule();
  });

  it('upserts the product as it is in IndexedDB when the handler runs', async () => {
    const row = product();
    await db.products.add(row);
    await db.products.update(row.id, { price: 11 }); // edited after the event was recorded

    await handler.handle(upserted(row.id));

    expect(sync.pushUpsertAsync).toHaveBeenCalledWith({
      id: row.id,
      name: 'Alfalfa',
      price: 11,
      category: 'Feed',
      stock: 7,
      description: '',
      isActive: true,
    });
  });

  it('sends a soft-deleted product as inactive', async () => {
    const row = product({ deletedAt: new Date() });
    await db.products.add(row);

    await handler.handle(upserted(row.id));

    expect(sync.pushUpsertAsync).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it('does nothing for a product that no longer exists locally', async () => {
    await handler.handle(upserted('gone'));
    expect(sync.pushUpsertAsync).not.toHaveBeenCalled();
  });

  it('defers, without pushing, while the worker carries no staff credential', async () => {
    // Covers both nobody signed in and the shop's capability token holding the
    // worker's slot: either way a push would be refused (401/403), not applied.
    await db.products.add(product());
    carriesStaffCredential.set(false);

    await expect(handler.handle(upserted(product().id))).rejects.toBeInstanceOf(RetryLaterError);
    expect(sync.pushUpsertAsync).not.toHaveBeenCalled();
  });

  it('defers while the sync worker is not running', async () => {
    await db.products.add(product());
    sync.isRunning.mockReturnValue(false);

    await expect(handler.handle(upserted(product().id))).rejects.toBeInstanceOf(RetryLaterError);
  });

  it('defers while offline', async () => {
    await db.products.add(product());
    vi.stubGlobal('navigator', { ...navigator, onLine: false });

    await expect(handler.handle(upserted(product().id))).rejects.toBeInstanceOf(RetryLaterError);
  });

  it('lets a server rejection through so the dispatcher counts it', async () => {
    await db.products.add(product());
    sync.pushUpsertAsync.mockRejectedValue(new Error('HTTP 400 (non-retryable)'));

    await expect(handler.handle(upserted(product().id))).rejects.toThrow('HTTP 400');
  });
});

describe('ProductServerCopyService', () => {
  it('records a fresh upsert and flushes it, so products saved before the outbox sync too', async () => {
    const outbox = {
      record: vi.fn().mockResolvedValue('e1'),
      flush: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DOMAIN_EVENT_OUTBOX, useValue: outbox }],
    });

    await TestBed.inject(ProductServerCopyService).ensureOnServer('p1');

    expect(outbox.record).toHaveBeenCalledWith(UPSERTED, 'p1', { productId: 'p1' });
    expect(outbox.flush).toHaveBeenCalledWith('p1');
    expect(outbox.record.mock.invocationCallOrder[0]).toBeLessThan(
      outbox.flush.mock.invocationCallOrder[0]
    );
    TestBed.resetTestingModule();
  });

  it('rejects with the reason when the product still cannot reach the server', async () => {
    const outbox = {
      record: vi.fn().mockResolvedValue('e1'),
      flush: vi.fn().mockRejectedValue(new Error('Nobody is signed in')),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DOMAIN_EVENT_OUTBOX, useValue: outbox }],
    });

    await expect(TestBed.inject(ProductServerCopyService).ensureOnServer('p1')).rejects.toThrow(
      'Nobody is signed in'
    );
    TestBed.resetTestingModule();
  });
});
