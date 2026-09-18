import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeReservedQuantity,
  availableStock,
  commit,
  release,
  reserve,
} from './checkout-inventory.ts';

const T1 = '2026-09-18T12:00:00.000Z';
const T2 = '2026-09-18T12:01:00.000Z';

function inventory(stock = 5, checkoutMarkers = {}) {
  return { stock, checkoutMarkers };
}

describe('checkout inventory', () => {
  it('reserves without decrement, replays, and rejects changed quantity', () => {
    const reserved = reserve(inventory(), 'c-1', 2, T1);
    assert.equal(reserved.stock, 5);
    assert.equal(availableStock(reserved.stock, reserved.checkoutMarkers), 3);
    assert.deepEqual(reserve(reserved, 'c-1', 2, T2), reserved);
    assert.throws(() => reserve(reserved, 'c-1', 3, T2));
  });

  it('commits exactly once and never releases committed evidence', () => {
    const reserved = reserve(inventory(), 'c-1', 2, T1);
    const committed = commit(reserved, 'c-1', T2);
    assert.equal(committed.stock, 3);
    assert.deepEqual(commit(committed, 'c-1', T2), committed);
    assert.throws(() => release(committed, 'c-1'));
  });

  it('releases active reservations idempotently', () => {
    const reserved = reserve(inventory(), 'c-1', 2, T1);
    const released = release(reserved, 'c-1');
    assert.equal(activeReservedQuantity(released.checkoutMarkers), 0);
    assert.deepEqual(release(released, 'c-1'), released);
  });

  it('safely retains prototype-sensitive persisted checkout ids', () => {
    const parsed = JSON.parse(
      `{"__proto__":{"state":"reserved","quantity":5,"reservedAt":"${T1}"}}`
    );
    assert.equal(activeReservedQuantity(parsed), 5);
    assert.equal(availableStock(5, parsed), 0);
    assert.throws(() => reserve(inventory(5, parsed), 'another', 1, T2));
    const inheritedName = reserve(inventory(), 'constructor', 1, T1);
    assert.equal(activeReservedQuantity(inheritedName.checkoutMarkers), 1);
  });

  it('requires canonical and causally ordered timestamps', () => {
    assert.throws(() => reserve(inventory(), 'c-1', 1, 'not-a-date'));
    const reserved = reserve(inventory(), 'c-1', 1, T2);
    assert.throws(() => commit(reserved, 'c-1', T1));
  });

  it('rejects over-reserved and malformed stock data', () => {
    assert.throws(() => availableStock(1.5, {}));
    assert.throws(() =>
      reserve(inventory(1, { c: { state: 'reserved', quantity: 2, reservedAt: T1 } }), 'x', 1, T2)
    );
    assert.throws(() =>
      activeReservedQuantity({
        c: { state: 'reserved', quantity: 1, reservedAt: T1, untrusted: true },
      })
    );
    assert.throws(() => reserve(inventory(), 'bad\ncheckout', 1, T1));
  });
});
