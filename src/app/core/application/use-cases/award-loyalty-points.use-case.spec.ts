import { TestBed } from '@angular/core/testing';
import { vi, type MockedObject } from 'vitest';
import { AwardLoyaltyPointsUseCase, toLoyaltyTier } from './award-loyalty-points.use-case';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { ICustomerRepository } from '@core/domain/interfaces/customer.repository.interface';
import { Customer, CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';
import { LOYALTY_SERVICE } from '@core/domain/rules/loyalty.service.provider';
import { LoyaltyService } from '@core/domain/rules/loyalty.service';
import { LoyaltyTier } from '@core/domain/rules/loyalty.service.interface';

describe('AwardLoyaltyPointsUseCase', () => {
  let useCase: AwardLoyaltyPointsUseCase;
  let mockRepository: MockedObject<ICustomerRepository>;

  /**
   * The real `LoyaltyService` is used rather than a stub: it is a pure domain
   * service with no dependencies, and the point of this use case is the arithmetic
   * that crosses it. A stub would let a wrong rate or a dropped multiplier pass.
   */
  function customer(
    overrides: Partial<{
      id: string;
      status: CustomerStatus;
      tier: CustomerTier;
      loyaltyPoints: number;
    }> = {}
  ): Customer {
    return new Customer({
      id: overrides.id ?? 'customer-1',
      name: 'Marco Rossi',
      email: 'marco@example.com',
      phone: '+1234567890',
      status: overrides.status ?? CustomerStatus.ACTIVE,
      tier: overrides.tier ?? CustomerTier.BRONZE,
      loyaltyPoints: overrides.loyaltyPoints ?? 0,
    });
  }

  /** A customer as it comes back from the write, with the award already applied. */
  function afterAward(points: number, from = customer()): Customer {
    from.addPoints(points);
    return from;
  }

  function configure(loyalty?: unknown): AwardLoyaltyPointsUseCase {
    mockRepository = {
      findById: vi.fn(),
      updateLoyaltyPoints: vi.fn(),
    } as unknown as MockedObject<ICustomerRepository>;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AwardLoyaltyPointsUseCase,
        { provide: CUSTOMER_REPOSITORY, useValue: mockRepository },
        { provide: LOYALTY_SERVICE, useValue: loyalty ?? new LoyaltyService() },
      ],
    });
    return TestBed.inject(AwardLoyaltyPointsUseCase);
  }

  beforeEach(() => {
    useCase = configure();
  });

  // -------------------------------------------------------------------------
  // The happy path — AC: points are awarded and the tier is recalculated
  // -------------------------------------------------------------------------

  describe('awarding points for a sale', () => {
    it('awards the points the loyalty rules price the sale at', async () => {
      mockRepository.findById.mockResolvedValue(customer());
      mockRepository.updateLoyaltyPoints.mockResolvedValue(afterAward(120));

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 12 });

      // 12 whole units at the BRONZE rate of 10 points per unit, no multiplier.
      expect(result.awarded).toBe(true);
      expect(result.points).toBe(120);
      expect(mockRepository.updateLoyaltyPoints).toHaveBeenCalledWith('customer-1', 120);
    });

    it('reports the balance and tier the write came back with', async () => {
      mockRepository.findById.mockResolvedValue(customer({ loyaltyPoints: 0 }));
      mockRepository.updateLoyaltyPoints.mockResolvedValue(afterAward(120));

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 12 });

      expect(result.balance).toBe(120);
      expect(result.previousTier).toBe(CustomerTier.BRONZE);
      expect(result.tier).toBe(CustomerTier.BRONZE);
    });

    it('surfaces the promotion when the sale crosses a tier threshold', async () => {
      // 950 points held, 100 more earned: over the 1000-point SILVER threshold.
      mockRepository.findById.mockResolvedValue(customer({ loyaltyPoints: 950 }));
      // A distinct instance: the write returns its own copy, and sharing one here
      // would let the award mutate the customer the read handed back.
      mockRepository.updateLoyaltyPoints.mockResolvedValue(
        afterAward(100, customer({ loyaltyPoints: 950 }))
      );

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 10 });

      expect(result.previousTier).toBe(CustomerTier.BRONZE);
      expect(result.tier).toBe(CustomerTier.SILVER);
    });

    it('prices the sale at the tier the customer arrived with', async () => {
      // SILVER carries a 1.25 multiplier: 10 units -> 100 base + 25 bonus.
      mockRepository.findById.mockResolvedValue(customer({ tier: CustomerTier.SILVER }));
      mockRepository.updateLoyaltyPoints.mockResolvedValue(
        afterAward(125, customer({ tier: CustomerTier.SILVER }))
      );

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 10 });

      expect(result.points).toBe(125);
    });
  });

  // -------------------------------------------------------------------------
  // Rounding — the decision recorded on the use case
  // -------------------------------------------------------------------------

  describe('rounding', () => {
    it('ignores the fractional part of a sale', async () => {
      mockRepository.findById.mockResolvedValue(customer());
      mockRepository.updateLoyaltyPoints.mockResolvedValue(afterAward(120));

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 12.99 });

      // Whole currency units only: 12.99 earns exactly what 12.00 earns.
      expect(result.points).toBe(120);
    });

    it('awards nothing for a sale below one whole currency unit', async () => {
      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 0.99 });

      expect(result.awarded).toBe(false);
      expect(result.reason).toBe('below-minimum-spend');
      expect(mockRepository.findById).not.toHaveBeenCalled();
      expect(mockRepository.updateLoyaltyPoints).not.toHaveBeenCalled();
    });

    it('awards nothing when the rules price a whole-unit sale at no points', async () => {
      // Guards a future sub-point rate: `addPoints` rejects a non-positive award, so
      // without this the write would throw on every small sale.
      useCase = configure({ calculatePoints: () => ({ totalPoints: 0 }) });
      mockRepository.findById.mockResolvedValue(customer());

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 5 });

      expect(result.awarded).toBe(false);
      expect(result.reason).toBe('below-minimum-spend');
      expect(result.previousTier).toBe(CustomerTier.BRONZE);
      expect(mockRepository.updateLoyaltyPoints).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Everything that must not become an exception on the selling path
  // -------------------------------------------------------------------------

  describe('outcomes that write nothing', () => {
    it.each([
      ['zero', 0],
      ['negative', -10],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('refuses a %s amount without reading the customer', async (_label, amount) => {
      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: amount });

      expect(result.awarded).toBe(false);
      expect(result.reason).toBe('invalid-amount');
      expect(mockRepository.findById).not.toHaveBeenCalled();
    });

    it('reports a card that no longer resolves to a customer', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await useCase.execute({ customerId: 'ghost', purchaseAmount: 20 });

      expect(result.awarded).toBe(false);
      expect(result.reason).toBe('customer-not-found');
      expect(mockRepository.updateLoyaltyPoints).not.toHaveBeenCalled();
    });

    it('refuses a blocked customer as a decision, not an error', async () => {
      mockRepository.findById.mockResolvedValue(
        customer({ status: CustomerStatus.BLOCKED, tier: CustomerTier.GOLD })
      );

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 20 });

      expect(result.awarded).toBe(false);
      expect(result.reason).toBe('customer-blocked');
      expect(result.previousTier).toBe(CustomerTier.GOLD);
      expect(mockRepository.updateLoyaltyPoints).not.toHaveBeenCalled();
    });

    it('reports a failed read instead of throwing', async () => {
      mockRepository.findById.mockRejectedValue(new Error('IndexedDB is gone'));

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 20 });

      expect(result.awarded).toBe(false);
      expect(result.reason).toBe('award-failed');
      expect(result.error).toBe('IndexedDB is gone');
    });

    it('reports a failed write instead of throwing', async () => {
      mockRepository.findById.mockResolvedValue(customer());
      mockRepository.updateLoyaltyPoints.mockRejectedValue(new Error('write conflict'));

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 20 });

      expect(result.awarded).toBe(false);
      expect(result.reason).toBe('award-failed');
      expect(result.error).toBe('write conflict');
    });

    it('survives a rejection that is not an Error', async () => {
      mockRepository.findById.mockRejectedValue('nope');

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 20 });

      expect(result.reason).toBe('award-failed');
      expect(result.error).toBe('Failed to award loyalty points');
    });
  });

  // -------------------------------------------------------------------------
  // The bridge between the two spellings of the tier ladder
  // -------------------------------------------------------------------------

  describe('toLoyaltyTier', () => {
    it.each(Object.values(CustomerTier))('maps %s onto a loyalty tier', (tier) => {
      // Asserted over the enum rather than a hand-written list, so adding a rung to
      // CustomerTier fails here instead of silently earning BRONZE rates.
      expect(Object.values(LoyaltyTier)).toContain(toLoyaltyTier(tier));
      expect(toLoyaltyTier(tier)).toBe(tier as unknown as LoyaltyTier);
    });

    it('falls back to BRONZE for a tier no longer in the ladder', () => {
      // Dexie records are unvalidated; a corrupt tier must cost the multiplier, not
      // the sale.
      expect(toLoyaltyTier('PALLADIUM')).toBe(LoyaltyTier.BRONZE);
    });

    it('prices a sale at BRONZE for a customer whose stored tier is corrupt', async () => {
      mockRepository.findById.mockResolvedValue(
        customer({ tier: 'PALLADIUM' as unknown as CustomerTier })
      );
      mockRepository.updateLoyaltyPoints.mockResolvedValue(afterAward(100));

      const result = await useCase.execute({ customerId: 'customer-1', purchaseAmount: 10 });

      expect(result.awarded).toBe(true);
      expect(result.points).toBe(100);
    });
  });
});
