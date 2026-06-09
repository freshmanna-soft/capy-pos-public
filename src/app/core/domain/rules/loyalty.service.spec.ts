import { describe, it, expect, beforeEach } from 'vitest';
import { LoyaltyService } from '@core/domain/rules/loyalty.service';
import type { ILoyaltyService } from '@core/domain/rules/loyalty.service.interface';
import { LoyaltyTier } from '@core/domain/rules/loyalty.service.interface';

describe('LoyaltyService', () => {
  let service: ILoyaltyService;

  beforeEach(() => {
    service = new LoyaltyService();
  });

  describe('calculatePoints', () => {
    it.each([
      [100, LoyaltyTier.BRONZE, false, 1000, 0, 1000, 1.0],
      [100, LoyaltyTier.SILVER, false, 1000, 250, 1250, 1.25],
      [100, LoyaltyTier.GOLD, false, 1000, 500, 1500, 1.5],
      [100, LoyaltyTier.PLATINUM, false, 1000, 1000, 2000, 2.0],
      [100, LoyaltyTier.BRONZE, true, 1000, 500, 1500, 1.5],
      [50, LoyaltyTier.SILVER, true, 500, 437, 937, 1.875],
    ])(
      'should calculate points for amount=%i, tier=%s, promo=%s',
      (amount, tier, promo, expectedBase, expectedBonus, expectedTotal, expectedMultiplier) => {
        const result = service.calculatePoints(amount, tier, promo);

        expect(result.basePoints).toBe(expectedBase);
        expect(result.bonusPoints).toBe(expectedBonus);
        expect(result.totalPoints).toBe(expectedTotal);
        expect(result.multiplier).toBe(expectedMultiplier);
      },
    );

    it('should throw error for negative purchase amount', () => {
      expect(() => service.calculatePoints(-100, LoyaltyTier.BRONZE)).toThrow(
        '[LoyaltyService] Purchase amount must be non-negative',
      );
    });
  });

  describe('determineTier', () => {
    it.each([
      [0, LoyaltyTier.BRONZE],
      [500, LoyaltyTier.BRONZE],
      [999, LoyaltyTier.BRONZE],
      [1000, LoyaltyTier.SILVER],
      [2500, LoyaltyTier.SILVER],
      [4999, LoyaltyTier.SILVER],
      [5000, LoyaltyTier.GOLD],
      [7500, LoyaltyTier.GOLD],
      [9999, LoyaltyTier.GOLD],
      [10000, LoyaltyTier.PLATINUM],
      [15000, LoyaltyTier.PLATINUM],
      [100000, LoyaltyTier.PLATINUM],
    ])('should determine tier for points=%i', (points, expectedTier) => {
      const result = service.determineTier(points);

      expect(result).toBe(expectedTier);
    });

    it('should throw error for negative points', () => {
      expect(() => service.determineTier(-100)).toThrow(
        '[LoyaltyService] Total points must be non-negative',
      );
    });
  });

  describe('getTierConfig', () => {
    it('should return BRONZE tier config', () => {
      const config = service.getTierConfig(LoyaltyTier.BRONZE);

      expect(config.tier).toBe(LoyaltyTier.BRONZE);
      expect(config.minPoints).toBe(0);
      expect(config.pointsMultiplier).toBe(1.0);
      expect(config.discountPercentage).toBe(0);
    });

    it('should return SILVER tier config', () => {
      const config = service.getTierConfig(LoyaltyTier.SILVER);

      expect(config.tier).toBe(LoyaltyTier.SILVER);
      expect(config.minPoints).toBe(1000);
      expect(config.pointsMultiplier).toBe(1.25);
      expect(config.discountPercentage).toBe(5);
    });

    it('should return GOLD tier config', () => {
      const config = service.getTierConfig(LoyaltyTier.GOLD);

      expect(config.tier).toBe(LoyaltyTier.GOLD);
      expect(config.minPoints).toBe(5000);
      expect(config.pointsMultiplier).toBe(1.5);
      expect(config.discountPercentage).toBe(10);
    });

    it('should return PLATINUM tier config', () => {
      const config = service.getTierConfig(LoyaltyTier.PLATINUM);

      expect(config.tier).toBe(LoyaltyTier.PLATINUM);
      expect(config.minPoints).toBe(10000);
      expect(config.pointsMultiplier).toBe(2.0);
      expect(config.discountPercentage).toBe(15);
    });
  });

  describe('calculateTierProgression', () => {
    it('should calculate progression for BRONZE tier', () => {
      const result = service.calculateTierProgression(500);

      expect(result.currentTier).toBe(LoyaltyTier.BRONZE);
      expect(result.currentPoints).toBe(500);
      expect(result.nextTier).toBe(LoyaltyTier.SILVER);
      expect(result.pointsToNextTier).toBe(500);
      expect(result.progressPercentage).toBe(50);
    });

    it('should calculate progression for SILVER tier', () => {
      const result = service.calculateTierProgression(3000);

      expect(result.currentTier).toBe(LoyaltyTier.SILVER);
      expect(result.currentPoints).toBe(3000);
      expect(result.nextTier).toBe(LoyaltyTier.GOLD);
      expect(result.pointsToNextTier).toBe(2000);
      expect(result.progressPercentage).toBe(50);
    });

    it('should calculate progression for GOLD tier', () => {
      const result = service.calculateTierProgression(7500);

      expect(result.currentTier).toBe(LoyaltyTier.GOLD);
      expect(result.currentPoints).toBe(7500);
      expect(result.nextTier).toBe(LoyaltyTier.PLATINUM);
      expect(result.pointsToNextTier).toBe(2500);
      expect(result.progressPercentage).toBe(50);
    });

    it('should calculate progression for PLATINUM tier (max tier)', () => {
      const result = service.calculateTierProgression(15000);

      expect(result.currentTier).toBe(LoyaltyTier.PLATINUM);
      expect(result.currentPoints).toBe(15000);
      expect(result.nextTier).toBeNull();
      expect(result.pointsToNextTier).toBe(0);
      expect(result.progressPercentage).toBe(100);
    });

    it('should throw error for negative points', () => {
      expect(() => service.calculateTierProgression(-100)).toThrow(
        '[LoyaltyService] Current points must be non-negative',
      );
    });
  });

  describe('redeemReward', () => {
    it('should redeem reward successfully', () => {
      const result = service.redeemReward('C1', 'R1', 500, 1000, 30);

      expect(result.customerId).toBe('C1');
      expect(result.rewardId).toBe('R1');
      expect(result.pointsCost).toBe(500);
      expect(result.redeemedAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.expiresAt!.getTime() - result.redeemedAt.getTime()).toBe(
        30 * 24 * 60 * 60 * 1000,
      );
    });

    it('should redeem reward without expiration', () => {
      const result = service.redeemReward('C1', 'R1', 500, 1000, null);

      expect(result.expiresAt).toBeNull();
    });

    it('should throw error for insufficient points', () => {
      expect(() => service.redeemReward('C1', 'R1', 1000, 500)).toThrow(
        '[LoyaltyService] Insufficient points. Required: 1000, Available: 500',
      );
    });

    it('should throw error for empty customer ID', () => {
      expect(() => service.redeemReward('', 'R1', 500, 1000)).toThrow(
        '[LoyaltyService] Customer ID is required',
      );
    });

    it('should throw error for empty reward ID', () => {
      expect(() => service.redeemReward('C1', '', 500, 1000)).toThrow(
        '[LoyaltyService] Reward ID is required',
      );
    });

    it('should throw error for negative points cost', () => {
      expect(() => service.redeemReward('C1', 'R1', -500, 1000)).toThrow(
        '[LoyaltyService] Points cost must be positive',
      );
    });
  });

  describe('recordTransaction', () => {
    it('should record EARNED transaction', () => {
      const result = service.recordTransaction('C1', 100, 'EARNED', 'Purchase', 500);

      expect(result.customerId).toBe('C1');
      expect(result.points).toBe(100);
      expect(result.type).toBe('EARNED');
      expect(result.reason).toBe('Purchase');
      expect(result.balanceAfter).toBe(600);
      expect(result.transactionDate).toBeInstanceOf(Date);
    });

    it('should record REDEEMED transaction', () => {
      const result = service.recordTransaction('C1', -100, 'REDEEMED', 'Reward', 500);

      expect(result.customerId).toBe('C1');
      expect(result.points).toBe(-100);
      expect(result.type).toBe('REDEEMED');
      expect(result.balanceAfter).toBe(400);
    });

    it('should record EXPIRED transaction', () => {
      const result = service.recordTransaction('C1', -50, 'EXPIRED', 'Expiration', 500);

      expect(result.points).toBe(-50);
      expect(result.type).toBe('EXPIRED');
      expect(result.balanceAfter).toBe(450);
    });

    it('should record ADJUSTED transaction', () => {
      const result = service.recordTransaction('C1', 200, 'ADJUSTED', 'Manual adjustment', 500);

      expect(result.points).toBe(200);
      expect(result.type).toBe('ADJUSTED');
      expect(result.balanceAfter).toBe(700);
    });

    it('should throw error for positive points in REDEEMED transaction', () => {
      expect(() => service.recordTransaction('C1', 100, 'REDEEMED', 'Test', 500)).toThrow(
        '[LoyaltyService] Points for REDEEMED transactions must be negative',
      );
    });

    it('should throw error for positive points in EXPIRED transaction', () => {
      expect(() => service.recordTransaction('C1', 100, 'EXPIRED', 'Test', 500)).toThrow(
        '[LoyaltyService] Points for EXPIRED transactions must be negative',
      );
    });

    it('should throw error when transaction results in negative balance', () => {
      expect(() => service.recordTransaction('C1', -600, 'REDEEMED', 'Test', 500)).toThrow(
        '[LoyaltyService] Transaction would result in negative balance. Current: 500, Change: -600, Result: -100',
      );
    });

    it('should throw error for empty customer ID', () => {
      expect(() => service.recordTransaction('', 100, 'EARNED', 'Test', 500)).toThrow(
        '[LoyaltyService] Customer ID is required',
      );
    });

    it('should throw error for empty reason', () => {
      expect(() => service.recordTransaction('C1', 100, 'EARNED', '', 500)).toThrow(
        '[LoyaltyService] Reason is required',
      );
    });
  });

  describe('calculateTierDiscount', () => {
    it.each([
      [100, LoyaltyTier.BRONZE, 0],
      [100, LoyaltyTier.SILVER, 5],
      [100, LoyaltyTier.GOLD, 10],
      [100, LoyaltyTier.PLATINUM, 15],
      [50, LoyaltyTier.SILVER, 2.5],
      [200, LoyaltyTier.GOLD, 20],
    ])('should calculate discount for amount=%i, tier=%s', (amount, tier, expectedDiscount) => {
      const result = service.calculateTierDiscount(amount, tier);

      expect(result).toBe(expectedDiscount);
    });

    it('should throw error for negative amount', () => {
      expect(() => service.calculateTierDiscount(-100, LoyaltyTier.BRONZE)).toThrow(
        '[LoyaltyService] Amount must be non-negative',
      );
    });
  });

  describe('hasSufficientPoints', () => {
    it.each([
      [1000, 500, true],
      [1000, 1000, true],
      [1000, 1001, false],
      [0, 0, true],
      [0, 1, false],
      [500, 1000, false],
    ])(
      'should check sufficient points for balance=%i, required=%i',
      (balance, required, expected) => {
        const result = service.hasSufficientPoints(balance, required);

        expect(result).toBe(expected);
      },
    );

    it('should throw error for negative balance', () => {
      expect(() => service.hasSufficientPoints(-100, 500)).toThrow(
        '[LoyaltyService] Current balance must be non-negative',
      );
    });

    it('should throw error for negative required points', () => {
      expect(() => service.hasSufficientPoints(1000, -500)).toThrow(
        '[LoyaltyService] Required points must be non-negative',
      );
    });
  });
});

// Made with Bob
