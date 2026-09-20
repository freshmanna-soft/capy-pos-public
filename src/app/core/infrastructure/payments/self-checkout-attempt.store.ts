import { Injectable } from '@angular/core';
import {
  CreatedSelfCheckout,
  SelfCheckoutItemRequest,
} from '@core/application/ports/self-checkout-gateway.port';
import {
  isCreatedSelfCheckout,
  isSelfCheckoutItemRequest,
} from './self-checkout-response.validation';

const ATTEMPT_KEY = 'capy_pos_self_checkout_attempt';

export interface StoredSelfCheckoutDraft {
  readonly cartRevision: number;
  readonly items: readonly SelfCheckoutItemRequest[];
  readonly idempotencyKey: string;
}

export interface StoredSelfCheckoutAttempt extends StoredSelfCheckoutDraft, CreatedSelfCheckout {}

export type StoredSelfCheckoutRecovery = StoredSelfCheckoutDraft | StoredSelfCheckoutAttempt;

@Injectable()
export class SelfCheckoutAttemptStore {
  read(): StoredSelfCheckoutRecovery | null {
    try {
      const raw = sessionStorage.getItem(ATTEMPT_KEY);
      if (raw === null) return null;
      const value = JSON.parse(raw) as unknown;
      return isStoredAttempt(value) ? value : null;
    } catch {
      return null;
    }
  }

  write(attempt: StoredSelfCheckoutRecovery): void {
    try {
      sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
    } catch {
      // Reload recovery is best-effort; the in-memory attempt remains usable.
    }
  }

  clear(): void {
    try {
      sessionStorage.removeItem(ATTEMPT_KEY);
    } catch {
      // Ignore blocked storage.
    }
  }
}

function isStoredAttempt(value: unknown): value is StoredSelfCheckoutRecovery {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const draftIsValid =
    Number.isSafeInteger(record['cartRevision']) &&
    (record['cartRevision'] as number) >= 0 &&
    Array.isArray(record['items']) &&
    record['items'].length > 0 &&
    record['items'].every(isSelfCheckoutItemRequest) &&
    typeof record['idempotencyKey'] === 'string' &&
    record['idempotencyKey'].trim().length > 0;
  if (!draftIsValid) return false;

  const hasCreatedFields =
    'checkoutId' in record ||
    'paypalOrderId' in record ||
    'checkoutToken' in record ||
    'quote' in record ||
    'state' in record;
  return !hasCreatedFields || isCreatedSelfCheckout(value);
}
