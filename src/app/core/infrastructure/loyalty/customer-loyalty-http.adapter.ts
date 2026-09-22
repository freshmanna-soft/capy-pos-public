import { Injectable } from '@angular/core';
import {
  CustomerLoyaltyGateway,
  CustomerLoyaltyProjection,
  CustomerLoyaltyStatus,
  CustomerLoyaltyTier,
} from '@core/application/ports/customer-loyalty-gateway.port';
import { environment } from '../../../../environments/environment';

@Injectable()
export class CustomerLoyaltyHttpAdapter implements CustomerLoyaltyGateway {
  private readonly endpoint = `${environment.apiUrl}/self-checkout/customer/loyalty`;

  async read(accessToken: string): Promise<CustomerLoyaltyProjection> {
    const response = await fetch(this.endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok || !isCustomerLoyaltyProjection(body)) {
      throw new Error('Customer loyalty is unavailable.');
    }
    return body;
  }
}

function isCustomerLoyaltyProjection(value: unknown): value is CustomerLoyaltyProjection {
  if (!isRecord(value)) return false;
  return (
    Object.values(CustomerLoyaltyStatus).includes(
      value['status'] as (typeof CustomerLoyaltyStatus)[keyof typeof CustomerLoyaltyStatus]
    ) &&
    Number.isSafeInteger(value['pointsBalance']) &&
    (value['pointsBalance'] as number) >= 0 &&
    Object.values(CustomerLoyaltyTier).includes(
      value['tier'] as (typeof CustomerLoyaltyTier)[keyof typeof CustomerLoyaltyTier]
    ) &&
    value['policyVersion'] === 'self-checkout-usd-v1' &&
    isIsoTimestamp(value['updatedAt'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
