import { Injectable, signal } from '@angular/core';
import { Customer } from '@core/domain/entities/customer.entity';

/**
 * KioskCustomerService
 *
 * Holds the customer who signed in at the kiosk for the current shopping session.
 * Cleared when the session ends (payment complete or idle reset).
 *
 * Intentionally minimal: kiosk sessions are anonymous by default.
 * A customer attaches themselves optionally via email on the splash screen.
 */
@Injectable({ providedIn: 'root' })
export class KioskCustomerService {
  private readonly _customer = signal<Customer | null>(null);
  readonly customer = this._customer.asReadonly();

  set(customer: Customer): void {
    this._customer.set(customer);
  }

  clear(): void {
    this._customer.set(null);
  }
}
