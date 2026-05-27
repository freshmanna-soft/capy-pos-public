import { describe, it, expect } from 'vitest';
import { Money } from './money.value-object';

describe('Money Value Object', () => {
  describe('constructor', () => {
    it('should create Money with amount and currency', () => {
      const money = new Money(10.50, 'USD');
      
      expect(money.amount).toBe(10.50);
      expect(money.currency).toBe('USD');
      expect(money.cents).toBe(1050);
    });

    it('should default to USD currency', () => {
      const money = new Money(10);
      
      expect(money.currency).toBe('USD');
    });

    it('should uppercase currency code', () => {
      const money = new Money(10, 'usd');
      
      expect(money.currency).toBe('USD');
    });

    it('should handle floating point precision', () => {
      const money = new Money(10.505);
      
      expect(money.amount).toBe(10.51); // Rounded to cents
    });

    it('should throw error for invalid amount', () => {
      expect(() => new Money(NaN, 'USD')).toThrow('Amount must be a valid number');
      expect(() => new Money(Infinity, 'USD')).toThrow('Amount must be finite');
    });

    it('should throw error for invalid currency', () => {
      expect(() => new Money(10, '')).toThrow('Currency must be a valid string');
      expect(() => new Money(10, 'US')).toThrow('Currency must be a 3-letter ISO code');
      expect(() => new Money(10, 'USDD')).toThrow('Currency must be a 3-letter ISO code');
    });
  });

  describe('INumericValueObject implementation', () => {
    describe('add', () => {
      it('should add two Money values', () => {
        const money1 = new Money(10.50, 'USD');
        const money2 = new Money(5.25, 'USD');
        
        const result = money1.add(money2);
        
        expect(result.amount).toBe(15.75);
        expect(result.currency).toBe('USD');
      });

      it('should throw error for different currencies', () => {
        const money1 = new Money(10, 'USD');
        const money2 = new Money(10, 'EUR');
        
        expect(() => money1.add(money2)).toThrow('Cannot operate on different currencies');
      });

      it('should not mutate original values', () => {
        const money1 = new Money(10, 'USD');
        const money2 = new Money(5, 'USD');
        
        money1.add(money2);
        
        expect(money1.amount).toBe(10);
        expect(money2.amount).toBe(5);
      });
    });

    describe('subtract', () => {
      it('should subtract two Money values', () => {
        const money1 = new Money(10.50, 'USD');
        const money2 = new Money(5.25, 'USD');
        
        const result = money1.subtract(money2);
        
        expect(result.amount).toBe(5.25);
      });

      it('should allow negative results', () => {
        const money1 = new Money(5, 'USD');
        const money2 = new Money(10, 'USD');
        
        const result = money1.subtract(money2);
        
        expect(result.amount).toBe(-5);
        expect(result.isNegative()).toBe(true);
      });
    });

    describe('isZero', () => {
      it('should return true for zero amount', () => {
        expect(new Money(0, 'USD').isZero()).toBe(true);
      });

      it('should return false for non-zero amount', () => {
        expect(new Money(1, 'USD').isZero()).toBe(false);
      });
    });

    describe('isPositive', () => {
      it('should return true for positive amount', () => {
        expect(new Money(10, 'USD').isPositive()).toBe(true);
      });

      it('should return false for zero', () => {
        expect(new Money(0, 'USD').isPositive()).toBe(false);
      });

      it('should return false for negative amount', () => {
        expect(new Money(-10, 'USD').isPositive()).toBe(false);
      });
    });

    describe('isNegative', () => {
      it('should return true for negative amount', () => {
        expect(new Money(-10, 'USD').isNegative()).toBe(true);
      });

      it('should return false for zero', () => {
        expect(new Money(0, 'USD').isNegative()).toBe(false);
      });

      it('should return false for positive amount', () => {
        expect(new Money(10, 'USD').isNegative()).toBe(false);
      });
    });
  });

  describe('IComparable implementation', () => {
    describe('compare', () => {
      it('should return 1 when greater', () => {
        const money1 = new Money(10, 'USD');
        const money2 = new Money(5, 'USD');
        
        expect(money1.compare(money2)).toBe(1);
      });

      it('should return -1 when less', () => {
        const money1 = new Money(5, 'USD');
        const money2 = new Money(10, 'USD');
        
        expect(money1.compare(money2)).toBe(-1);
      });

      it('should return 0 when equal', () => {
        const money1 = new Money(10, 'USD');
        const money2 = new Money(10, 'USD');
        
        expect(money1.compare(money2)).toBe(0);
      });
    });

    describe('greaterThan', () => {
      it('should return true when greater', () => {
        const money1 = new Money(10, 'USD');
        const money2 = new Money(5, 'USD');
        
        expect(money1.greaterThan(money2)).toBe(true);
      });

      it('should return false when not greater', () => {
        const money1 = new Money(5, 'USD');
        const money2 = new Money(10, 'USD');
        
        expect(money1.greaterThan(money2)).toBe(false);
      });
    });

    describe('lessThan', () => {
      it('should return true when less', () => {
        const money1 = new Money(5, 'USD');
        const money2 = new Money(10, 'USD');
        
        expect(money1.lessThan(money2)).toBe(true);
      });

      it('should return false when not less', () => {
        const money1 = new Money(10, 'USD');
        const money2 = new Money(5, 'USD');
        
        expect(money1.lessThan(money2)).toBe(false);
      });
    });
  });

  describe('BaseValueObject implementation', () => {
    describe('equals', () => {
      it('should return true for equal values', () => {
        const money1 = new Money(10, 'USD');
        const money2 = new Money(10, 'USD');
        
        expect(money1.equals(money2)).toBe(true);
      });

      it('should return false for different amounts', () => {
        const money1 = new Money(10, 'USD');
        const money2 = new Money(5, 'USD');
        
        expect(money1.equals(money2)).toBe(false);
      });

      it('should return false for different currencies', () => {
        const money1 = new Money(10, 'USD');
        const money2 = new Money(10, 'EUR');
        
        expect(money1.equals(money2)).toBe(false);
      });
    });

    describe('toJSON', () => {
      it('should convert to plain object', () => {
        const money = new Money(10.50, 'USD');
        
        const json = money.toJSON();
        
        expect(json).toEqual({ amount: 10.50, currency: 'USD' });
      });
    });

    describe('toString', () => {
      it('should return formatted string', () => {
        const money = new Money(10.50, 'USD');
        
        const str = money.toString();
        
        expect(str).toContain('10.50');
      });
    });
  });

  describe('IFormattable implementation', () => {
    describe('format', () => {
      it('should format as currency string', () => {
        const money = new Money(1234.56, 'USD');
        
        const formatted = money.format('en-US');
        
        expect(formatted).toBe('$1,234.56');
      });

      it('should format different currencies', () => {
        const money = new Money(1234.56, 'EUR');
        
        const formatted = money.format('de-DE');
        
        expect(formatted).toContain('1.234,56');
      });
    });
  });

  describe('additional operations', () => {
    describe('multiply', () => {
      it('should multiply by a factor', () => {
        const money = new Money(10, 'USD');
        
        const result = money.multiply(2.5);
        
        expect(result.amount).toBe(25);
      });
    });

    describe('divide', () => {
      it('should divide by a divisor', () => {
        const money = new Money(10, 'USD');
        
        const result = money.divide(2);
        
        expect(result.amount).toBe(5);
      });

      it('should throw error when dividing by zero', () => {
        const money = new Money(10, 'USD');
        
        expect(() => money.divide(0)).toThrow('Cannot divide by zero');
      });
    });

    describe('percentage', () => {
      it('should calculate percentage', () => {
        const money = new Money(100, 'USD');
        
        const result = money.percentage(10);
        
        expect(result.amount).toBe(10);
      });
    });

    describe('abs', () => {
      it('should return absolute value', () => {
        const money = new Money(-10, 'USD');
        
        const result = money.abs();
        
        expect(result.amount).toBe(10);
      });
    });
  });

  describe('static factory methods', () => {
    describe('fromJSON', () => {
      it('should create from plain object', () => {
        const json = { amount: 10.50, currency: 'USD' };
        
        const money = Money.fromJSON(json);
        
        expect(money.amount).toBe(10.50);
        expect(money.currency).toBe('USD');
      });
    });

    describe('zero', () => {
      it('should create zero Money', () => {
        const money = Money.zero('USD');
        
        expect(money.amount).toBe(0);
        expect(money.isZero()).toBe(true);
      });
    });

    describe('fromCents', () => {
      it('should create from cents', () => {
        const money = Money.fromCents(1050, 'USD');
        
        expect(money.amount).toBe(10.50);
        expect(money.cents).toBe(1050);
      });
    });
  });

  describe('immutability', () => {
    it('should be frozen', () => {
      const money = new Money(10, 'USD');
      
      expect(Object.isFrozen(money)).toBe(true);
    });

    it('should return new instances for all operations', () => {
      const money = new Money(10, 'USD');
      
      const added = money.add(new Money(5, 'USD'));
      const multiplied = money.multiply(2);
      
      expect(added).not.toBe(money);
      expect(multiplied).not.toBe(money);
      expect(money.amount).toBe(10); // Original unchanged
    });
  });
});

// Made with Bob