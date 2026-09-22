import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  CUSTOMER_LOYALTY_GATEWAY,
  CustomerLoyaltyProjection,
} from '@core/application/ports/customer-loyalty-gateway.port';
import { CurrentCustomerService } from './current-customer.service';

/** Route-owned, server-authoritative loyalty read model for the current App ID subject. */
@Injectable()
export class CurrentCustomerLoyaltyService {
  private readonly currentCustomer = inject(CurrentCustomerService);
  private readonly gateway = inject(CUSTOMER_LOYALTY_GATEWAY);
  private readonly _projection = signal<CustomerLoyaltyProjection | null>(null);
  private readonly _loading = signal(false);
  private readonly _unavailable = signal(false);
  private generation = 0;

  readonly projection = this._projection.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly unavailable = this._unavailable.asReadonly();
  readonly pointsBalance = computed(() => this._projection()?.pointsBalance ?? null);
  readonly tier = computed(() => this._projection()?.tier ?? null);

  constructor() {
    effect(() => {
      const session = this.currentCustomer.session();
      const generation = ++this.generation;
      this.clear();
      if (session === null) return;
      void this.load(session.customerId, session.accessToken, generation);
    });
  }

  /** Reload after a confirmed award without allowing an older session to repopulate state. */
  refresh(): void {
    const session = this.currentCustomer.session();
    const generation = ++this.generation;
    this.clear();
    if (session !== null) void this.load(session.customerId, session.accessToken, generation);
  }

  private async load(subject: string, accessToken: string, generation: number): Promise<void> {
    this._loading.set(true);
    try {
      const projection = await this.gateway.read(accessToken);
      if (!this.isCurrent(subject, generation)) return;
      this._projection.set(projection);
    } catch {
      if (!this.isCurrent(subject, generation)) return;
      this._unavailable.set(true);
    } finally {
      if (this.isCurrent(subject, generation)) this._loading.set(false);
    }
  }

  private isCurrent(subject: string, generation: number): boolean {
    return generation === this.generation && this.currentCustomer.customerId() === subject;
  }

  private clear(): void {
    this._projection.set(null);
    this._loading.set(false);
    this._unavailable.set(false);
  }
}
