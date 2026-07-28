import { describe, it, expect, beforeEach } from 'vitest';
import { DepositReconciliationService } from '@core/domain/rules/deposit-reconciliation.service';
import {
  DepositDeductionCategory,
  DepositSettlementRequest,
  IDepositReconciliationService,
} from '@core/domain/rules/deposit-reconciliation.service.interface';

describe('DepositReconciliationService', () => {
  let service: IDepositReconciliationService;

  beforeEach(() => {
    service = new DepositReconciliationService();
  });

  const validRequest = (
    overrides: Partial<DepositSettlementRequest> = {}
  ): DepositSettlementRequest => ({
    tenancyId: 'tenancy-1',
    depositHeld: 120_000,
    deductions: [],
    ...overrides,
  });

  describe('reconcile', () => {
    it('should return the full deposit when there are no deductions', () => {
      const settlement = service.reconcile(validRequest());

      expect(settlement.totalDeductions).toBe(0);
      expect(settlement.amountReturned).toBe(120_000);
      expect(settlement.shortfall).toBe(0);
      expect(settlement.fullyReturned).toBe(true);
    });

    it('should treat an omitted deductions list as a full return', () => {
      const settlement = service.reconcile(validRequest({ deductions: undefined }));

      expect(settlement.amountReturned).toBe(120_000);
      expect(settlement.fullyReturned).toBe(true);
    });

    it('should subtract deductions from the amount returned', () => {
      const settlement = service.reconcile(
        validRequest({
          deductions: [
            { category: DepositDeductionCategory.Damage, amount: 20_000 },
            { category: DepositDeductionCategory.Cleaning, amount: 5_000 },
          ],
        })
      );

      expect(settlement.totalDeductions).toBe(25_000);
      expect(settlement.amountReturned).toBe(95_000);
      expect(settlement.shortfall).toBe(0);
      expect(settlement.fullyReturned).toBe(false);
    });

    it('should total deductions per category with zeroes for unused ones', () => {
      const settlement = service.reconcile(
        validRequest({
          deductions: [
            { category: DepositDeductionCategory.Damage, amount: 12_000 },
            { category: DepositDeductionCategory.Damage, amount: 3_000 },
            { category: DepositDeductionCategory.Arrears, amount: 40_000 },
          ],
        })
      );

      expect(settlement.deductionsByCategory).toEqual({
        [DepositDeductionCategory.Damage]: 15_000,
        [DepositDeductionCategory.Cleaning]: 0,
        [DepositDeductionCategory.Arrears]: 40_000,
        [DepositDeductionCategory.Other]: 0,
      });
    });

    it('should return zero and no shortfall when deductions exactly exhaust the deposit', () => {
      const settlement = service.reconcile(
        validRequest({
          deductions: [{ category: DepositDeductionCategory.Damage, amount: 120_000 }],
        })
      );

      expect(settlement.amountReturned).toBe(0);
      expect(settlement.shortfall).toBe(0);
      expect(settlement.fullyReturned).toBe(false);
    });

    it('should surface a shortfall when deductions exceed the deposit', () => {
      const settlement = service.reconcile(
        validRequest({
          deductions: [
            { category: DepositDeductionCategory.Damage, amount: 100_000 },
            { category: DepositDeductionCategory.Arrears, amount: 50_000 },
          ],
        })
      );

      expect(settlement.totalDeductions).toBe(150_000);
      expect(settlement.amountReturned).toBe(0);
      expect(settlement.shortfall).toBe(30_000);
      expect(settlement.fullyReturned).toBe(false);
    });

    it('should trim the tenancy id', () => {
      const settlement = service.reconcile(validRequest({ tenancyId: '  tenancy-1  ' }));

      expect(settlement.tenancyId).toBe('tenancy-1');
    });

    it('should throw for a blank tenancy id', () => {
      expect(() => service.reconcile(validRequest({ tenancyId: '  ' }))).toThrow(
        /Tenancy id cannot be empty/
      );
    });

    it('should throw for a non-positive deposit held', () => {
      expect(() => service.reconcile(validRequest({ depositHeld: 0 }))).toThrow(
        /Deposit held must be positive/
      );
    });

    it('should throw for a deduction with an unknown category', () => {
      expect(() =>
        service.reconcile(
          validRequest({
            deductions: [{ category: 'gratuity' as DepositDeductionCategory, amount: 1_000 }],
          })
        )
      ).toThrow(/Deduction category must be one of/);
    });

    it('should throw for a non-positive deduction amount', () => {
      expect(() =>
        service.reconcile(
          validRequest({
            deductions: [{ category: DepositDeductionCategory.Cleaning, amount: 0 }],
          })
        )
      ).toThrow(/Deduction amount must be positive/);
    });
  });

  describe('reconcileAll', () => {
    it('should settle every request preserving input order', () => {
      const settlements = service.reconcileAll([
        validRequest({ tenancyId: 'tenancy-1', depositHeld: 100_000 }),
        validRequest({
          tenancyId: 'tenancy-2',
          depositHeld: 80_000,
          deductions: [{ category: DepositDeductionCategory.Cleaning, amount: 20_000 }],
        }),
      ]);

      expect(settlements.map((s) => s.tenancyId)).toEqual(['tenancy-1', 'tenancy-2']);
      expect(settlements[0].amountReturned).toBe(100_000);
      expect(settlements[1].amountReturned).toBe(60_000);
    });

    it('should return an empty array for no requests', () => {
      expect(service.reconcileAll([])).toEqual([]);
    });
  });
});

// Made with Bob
