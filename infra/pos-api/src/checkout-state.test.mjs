import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CheckoutState as S,
  assertCheckoutTransition,
  canTransitionCheckout,
  captureMayHaveSucceeded,
  isTerminalCheckoutState,
} from './checkout-state.ts';

describe('checkout state safety', () => {
  it('records requested and provider-unknown boundaries without losing provenance', () => {
    assert.equal(
      canTransitionCheckout(S.CREATE_ORDER_REQUESTED, S.RECONCILE_CREATE_ORDER_UNKNOWN),
      true
    );
    assert.equal(canTransitionCheckout(S.AUTHORIZE_REQUESTED, S.RECONCILE_AUTHORIZE_UNKNOWN), true);
    assert.equal(canTransitionCheckout(S.CAPTURE_REQUESTED, S.RECONCILE_CAPTURE_UNKNOWN), true);
  });

  it('requires a non-capture fence and confirmed provider fact before void', () => {
    for (const state of [S.AUTHORIZED, S.RESERVING, S.RESERVED]) {
      assert.equal(canTransitionCheckout(state, S.EXPIRED), false);
      assert.equal(canTransitionCheckout(state, S.VOIDED), false);
    }
    assert.equal(canTransitionCheckout(S.RESERVED, S.NEVER_CAPTURE_VOID_REQUESTED), true);
    assert.equal(
      canTransitionCheckout(S.NEVER_CAPTURE_VOID_REQUESTED, S.CONFIRMED_NON_CAPTURABLE),
      true
    );
    assert.equal(canTransitionCheckout(S.CONFIRMED_NON_CAPTURABLE, S.VOIDED), true);
  });

  it('does not let capture-possible or captured provenance return to void or expiry', () => {
    for (const state of [
      S.CAPTURE_REQUESTED,
      S.RECONCILE_CAPTURE_UNKNOWN,
      S.CAPTURED_PENDING_COMMIT,
      S.COMMITTING,
      S.RECONCILE_CAPTURED,
      S.MANUAL_REVIEW_CAPTURE_UNKNOWN,
      S.MANUAL_REVIEW_CAPTURED,
    ]) {
      assert.equal(canTransitionCheckout(state, S.NEVER_CAPTURE_VOID_REQUESTED), false);
      assert.equal(canTransitionCheckout(state, S.VOIDED), false);
      assert.equal(canTransitionCheckout(state, S.EXPIRED), false);
      assert.equal(captureMayHaveSucceeded(state), true);
    }
  });

  it('retries only after unknown authorization is confirmed absent', () => {
    assert.equal(canTransitionCheckout(S.AUTHORIZE_REQUESTED, S.EXPIRED), false);
    assert.equal(canTransitionCheckout(S.RECONCILE_AUTHORIZE_UNKNOWN, S.AUTHORIZE_REQUESTED), true);
    assert.equal(canTransitionCheckout(S.RECONCILE_AUTHORIZE_UNKNOWN, S.EXPIRED), true);
    assert.equal(
      canTransitionCheckout(S.RECONCILE_AUTHORIZE_UNKNOWN, S.CONFIRMED_NON_CAPTURABLE),
      false
    );
  });

  it('requires retrieval before unknown capture becomes non-capturable', () => {
    assert.equal(
      canTransitionCheckout(S.RECONCILE_CAPTURE_UNKNOWN, S.CONFIRMED_NON_CAPTURABLE),
      true
    );
    assert.equal(canTransitionCheckout(S.RECONCILE_CAPTURE_UNKNOWN, S.VOIDED), false);
    assert.throws(() => assertCheckoutTransition(S.RECONCILE_CAPTURE_UNKNOWN, S.VOIDED));
  });

  it('identifies provenance-specific terminal manual review states', () => {
    for (const state of [
      S.COMPLETED,
      S.MANUAL_REVIEW_CREATE_UNKNOWN,
      S.MANUAL_REVIEW_AWAITING_APPROVAL,
      S.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
      S.MANUAL_REVIEW_AUTHORIZED,
      S.MANUAL_REVIEW_CAPTURE_UNKNOWN,
      S.MANUAL_REVIEW_CAPTURED,
    ]) {
      assert.equal(isTerminalCheckoutState(state), true);
    }
  });

  it('fails closed for unknown persisted values', () => {
    for (const state of [undefined, null, '', 'captured-ish', {}, 1]) {
      assert.equal(canTransitionCheckout(state, S.COMPLETED), false);
      assert.equal(canTransitionCheckout(S.COMMITTING, state), false);
      assert.equal(isTerminalCheckoutState(state), false);
      assert.equal(captureMayHaveSucceeded(state), true);
    }
  });
});
