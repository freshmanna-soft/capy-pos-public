import { Injectable } from '@angular/core';
import { BaseDomainService } from '@core/domain/rules/base-domain.service';
import {
  DepositDeduction,
  DepositDeductionCategory,
  DepositSettlement,
  DepositSettlementRequest,
  IDepositReconciliationService,
} from '@core/domain/rules/deposit-reconciliation.service.interface';

/** The full set of deduction categories, used to seed a zeroed breakdown. */
const DEDUCTION_CATEGORIES: DepositDeductionCategory[] = Object.values(DepositDeductionCategory);

/**
 * Deposit Reconciliation Service Implementation
 *
 * Settles a tenancy's deposit at move-out: it totals the itemised deductions
 * per category and works out what is returned to the tenant and any shortfall
 * they still owe when the deductions exceed the deposit held.
 *
 * @class DepositReconciliationService
 * @extends BaseDomainService
 * @implements IDepositReconciliationService
 */
@Injectable({ providedIn: 'root' })
export class DepositReconciliationService
  extends BaseDomainService
  implements IDepositReconciliationService
{
  constructor() {
    super('DepositReconciliationService');
  }

  /**
   * Settle a single tenancy's deposit at move-out.
   */
  reconcile(request: DepositSettlementRequest): DepositSettlement {
    this.validateRequired(request, 'Deposit settlement request');
    this.validateNotEmpty(request.tenancyId, 'Tenancy id');
    this.validatePositive(request.depositHeld, 'Deposit held');

    const deductions = request.deductions ?? [];
    const deductionsByCategory = this.zeroedBreakdown();

    let totalDeductions = 0;
    for (const deduction of deductions) {
      this.validateDeduction(deduction);
      deductionsByCategory[deduction.category] += deduction.amount;
      totalDeductions += deduction.amount;
    }

    // Deductions can exhaust the deposit but never turn a return negative; any
    // excess surfaces as a shortfall the tenant owes instead.
    const amountReturned = Math.max(0, request.depositHeld - totalDeductions);
    const shortfall = Math.max(0, totalDeductions - request.depositHeld);

    return {
      tenancyId: request.tenancyId.trim(),
      depositHeld: request.depositHeld,
      totalDeductions,
      deductionsByCategory,
      amountReturned,
      shortfall,
      fullyReturned: totalDeductions === 0,
    };
  }

  /**
   * Settle every request in a batch, preserving input order.
   */
  reconcileAll(requests: DepositSettlementRequest[]): DepositSettlement[] {
    const list = requests ?? [];
    return list.map((request) => this.reconcile(request));
  }

  /**
   * Build a breakdown with every category present and zeroed, so callers never
   * have to guard against a missing category key.
   */
  private zeroedBreakdown(): Record<DepositDeductionCategory, number> {
    return DEDUCTION_CATEGORIES.reduce(
      (acc, category) => {
        acc[category] = 0;
        return acc;
      },
      {} as Record<DepositDeductionCategory, number>
    );
  }

  /**
   * Validate a single deduction line: it must be present, carry a known
   * category, and withhold a positive amount.
   */
  private validateDeduction(deduction: DepositDeduction): void {
    this.validateRequired(deduction, 'Deposit deduction');
    this.validateInput(
      DEDUCTION_CATEGORIES.includes(deduction.category),
      `Deduction category must be one of: ${DEDUCTION_CATEGORIES.join(', ')}`
    );
    this.validatePositive(deduction.amount, 'Deduction amount');
  }
}

// Made with Bob
