import { TestBed } from '@angular/core/testing';
import { EventBusMessage, EventBusService } from './event-bus.service';
import { EventSource, EventType, busEvent } from './event-bus.events';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('EventBusService', () => {
  let bus: EventBusService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    bus = TestBed.inject(EventBusService);
  });

  function publishCartAdd(options?: Parameters<typeof busEvent>[3]): EventBusMessage {
    bus.publish(
      busEvent(
        EventType.CART_ITEM_ADDED,
        EventSource.POS_FACADE,
        { productId: 'p1', name: 'Mango', price: 2.5 },
        options
      )
    );
    return bus.getHistory(1)[0];
  }

  describe('identity', () => {
    it('stamps every message with a UUID v4 id', () => {
      const first = publishCartAdd();
      const second = publishCartAdd();

      expect(first.id).toMatch(UUID_V4);
      expect(second.id).toMatch(UUID_V4);
      expect(first.id).not.toBe(second.id);
    });

    it('passes correlationId and causationId through untouched', () => {
      const message = publishCartAdd({ correlationId: 'sale-42', causationId: 'evt-7' });

      expect(message.correlationId).toBe('sale-42');
      expect(message.causationId).toBe('evt-7');
    });

    it('leaves correlationId unset when none is given rather than inventing one', () => {
      const message = publishCartAdd();

      expect(message.correlationId).toBeUndefined();
      expect(message.causationId).toBeUndefined();
    });

    it('defaults priority to normal and honours an explicit one', () => {
      expect(publishCartAdd().priority).toBe('normal');
      expect(publishCartAdd({ priority: 'critical' }).priority).toBe('critical');
    });
  });

  describe('publishing', () => {
    it('never writes to console.log', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        publishCartAdd();
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });

    it('delivers a typed payload to subscribeToType subscribers of that type only', () => {
      const received: { productId: string; price: number }[] = [];
      const sub = bus
        .subscribeToType(EventType.CART_ITEM_ADDED)
        .subscribe((msg) =>
          received.push({ productId: msg.payload.productId, price: msg.payload.price })
        );

      publishCartAdd();
      bus.publish(
        busEvent(EventType.CART_ITEM_REMOVED, EventSource.POS_FACADE, { productId: 'p2' })
      );
      sub.unsubscribe();

      expect(received).toEqual([{ productId: 'p1', price: 2.5 }]);
    });
  });

  describe('getStatistics', () => {
    it('keeps the totalMessages / byType / bySource / byPriority shape', () => {
      publishCartAdd();
      bus.publish(
        busEvent(
          EventType.SYNC_ERROR,
          EventSource.SYNC_SERVICE,
          { error: 'offline' },
          { priority: 'critical' }
        )
      );

      expect(bus.getStatistics()).toEqual({
        totalMessages: 2,
        byType: { 'cart.item.added': 1, 'sync.error': 1 },
        bySource: { PosFacade: 1, SyncService: 1 },
        byPriority: { normal: 1, critical: 1 },
      });
    });
  });

  describe('payload typing (checked by tsc -p tsconfig.spec.json)', () => {
    it('rejects payloads that do not match their event type', () => {
      // Each call below must stay a compile error. If one stops erroring, the
      // payload map has gone loose and tsc reports the unused directive. The bad
      // payloads are named so every call fits on the line its directive covers.
      const priceAsString = { productId: 'p', name: 'n', price: '1' };
      const missingName = { productId: 'p', price: 1 };
      const cartRemoval = { productId: 'p' };
      const wrong = [
        // @ts-expect-error price must be a number
        () => busEvent(EventType.CART_ITEM_ADDED, EventSource.POS_FACADE, priceAsString),
        // @ts-expect-error name is required on cart.item.added
        () => busEvent(EventType.CART_ITEM_ADDED, EventSource.POS_FACADE, missingName),
        // @ts-expect-error a cart-removal payload is not a sync-completed payload
        () => busEvent(EventType.SYNC_COMPLETED, EventSource.SYNC_SERVICE, cartRemoval),
        // @ts-expect-error unknown event types are not publishable
        () => busEvent('made.up', EventSource.POS_FACADE, {}),
      ];

      expect(wrong).toHaveLength(4);
    });
  });
});
