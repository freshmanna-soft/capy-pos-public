import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentBuilder } from './payment.builder';
import { Payment, PaymentMethod, PaymentStatus } from './payment.entity';

describe('PaymentBuilder', () => {
  let builder: PaymentBuilder;

  beforeEach(() => {
    builder = new PaymentBuilder();
  });

  describe('build() with defaults', () => {
    it('should create a Payment with sensible defaults', () => {
      const payment = builder.build();

      expect(payment).toBeInstanceOf(Payment);
      expect(payment.orderId).toBe('default-order');
      expect(payment.amount).toBe(1);
      expect(payment.method).toBe(PaymentMethod.CASH);
      expect(payment.status).toBe(PaymentStatus.PENDING);
      expect(payment.currency).toBe('USD');
      expect(payment.refundedAmount).toBe(0);
    });

    it('should generate a UUID for id by default', () => {
      const payment = builder.build();
      expect(payment.id).toBeDefined();
      expect(payment.id.length).toBeGreaterThan(0);
    });

    it('should set createdAt and updatedAt to current time by default', () => {
      const before = new Date();
      const payment = builder.build();
      const after = new Date();

      expect(payment.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(payment.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(payment.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(payment.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Identity & audit fields', () => {
    it('should set id via withId()', () => {
      const payment = builder.withId('pay-123').build();
      expect(payment.id).toBe('pay-123');
    });

    it('should set createdAt via withCreatedAt()', () => {
      const date = new Date('2025-01-15T10:00:00Z');
      const payment = builder.withCreatedAt(date).build();
      expect(payment.createdAt).toEqual(date);
    });

    it('should set updatedAt via withUpdatedAt()', () => {
      const date = new Date('2025-06-01T12:00:00Z');
      const payment = builder.withUpdatedAt(date).build();
      expect(payment.updatedAt).toEqual(date);
    });

    it('should set createdBy via withCreatedBy()', () => {
      const payment = builder.withCreatedBy('cashier').build();
      expect(payment.createdBy).toBe('cashier');
    });

    it('should set updatedBy via withUpdatedBy()', () => {
      const payment = builder.withUpdatedBy('manager').build();
      expect(payment.updatedBy).toBe('manager');
    });
  });

  describe('Payment-specific fields', () => {
    it('should set orderId via withOrderId()', () => {
      const payment = builder.withOrderId('order-456').build();
      expect(payment.orderId).toBe('order-456');
    });

    it('should set amount via withAmount()', () => {
      const payment = builder.withAmount(99.99).build();
      expect(payment.amount).toBe(99.99);
    });

    it('should set method via withMethod()', () => {
      const payment = builder.withMethod(PaymentMethod.CREDIT_CARD).build();
      expect(payment.method).toBe(PaymentMethod.CREDIT_CARD);
    });

    it('should set status via withStatus()', () => {
      const payment = builder.withStatus(PaymentStatus.COMPLETED).build();
      expect(payment.status).toBe(PaymentStatus.COMPLETED);
    });

    it('should set currency via withCurrency()', () => {
      const payment = builder.withCurrency('EUR').build();
      expect(payment.currency).toBe('EUR');
    });

    it('should set refundedAmount via withRefundedAmount()', () => {
      const payment = builder.withAmount(100).withRefundedAmount(25).build();
      expect(payment.refundedAmount).toBe(25);
    });

    it('should set completedAt via withCompletedAt()', () => {
      const date = new Date('2025-03-15T14:30:00Z');
      const payment = builder.withCompletedAt(date).build();
      expect(payment.completedAt).toEqual(date);
    });

    it('should set failureReason via withFailureReason()', () => {
      const payment = builder.withFailureReason('Insufficient funds').build();
      expect(payment.failureReason).toBe('Insufficient funds');
    });

    it('should set transactionId via withTransactionId()', () => {
      const payment = builder.withTransactionId('txn-789').build();
      expect(payment.transactionId).toBe('txn-789');
    });

    it('should set cardLast4 via withCardLast4()', () => {
      const payment = builder.withCardLast4('4242').build();
      expect(payment.cardLast4).toBe('4242');
    });

    it('should set cardBrand via withCardBrand()', () => {
      const payment = builder.withCardBrand('Visa').build();
      expect(payment.cardBrand).toBe('Visa');
    });

    it('should set receiptNumber via withReceiptNumber()', () => {
      const payment = builder.withReceiptNumber('REC-001').build();
      expect(payment.receiptNumber).toBe('REC-001');
    });
  });

  describe('Fluent API chaining', () => {
    it('should support full method chaining', () => {
      const completedAt = new Date('2025-03-15T14:30:00Z');
      const payment = new PaymentBuilder()
        .withId('pay-full')
        .withOrderId('order-100')
        .withAmount(250.0)
        .withMethod(PaymentMethod.CREDIT_CARD)
        .withStatus(PaymentStatus.COMPLETED)
        .withCurrency('USD')
        .withRefundedAmount(0)
        .withCompletedAt(completedAt)
        .withTransactionId('txn-100')
        .withCardLast4('1234')
        .withCardBrand('Mastercard')
        .withReceiptNumber('REC-100')
        .withCreatedBy('pos-terminal')
        .withUpdatedBy('system')
        .build();

      expect(payment.id).toBe('pay-full');
      expect(payment.orderId).toBe('order-100');
      expect(payment.amount).toBe(250.0);
      expect(payment.method).toBe(PaymentMethod.CREDIT_CARD);
      expect(payment.status).toBe(PaymentStatus.COMPLETED);
      expect(payment.currency).toBe('USD');
      expect(payment.refundedAmount).toBe(0);
      expect(payment.completedAt).toEqual(completedAt);
      expect(payment.transactionId).toBe('txn-100');
      expect(payment.cardLast4).toBe('1234');
      expect(payment.cardBrand).toBe('Mastercard');
      expect(payment.receiptNumber).toBe('REC-100');
      expect(payment.createdBy).toBe('pos-terminal');
      expect(payment.updatedBy).toBe('system');
    });

    it('should allow minimal configuration', () => {
      const payment = new PaymentBuilder()
        .withOrderId('order-min')
        .withAmount(50)
        .withMethod(PaymentMethod.CASH)
        .build();

      expect(payment.orderId).toBe('order-min');
      expect(payment.amount).toBe(50);
      expect(payment.method).toBe(PaymentMethod.CASH);
      expect(payment.status).toBe(PaymentStatus.PENDING);
      expect(payment.transactionId).toBeUndefined();
      expect(payment.cardLast4).toBeUndefined();
      expect(payment.cardBrand).toBeUndefined();
      expect(payment.receiptNumber).toBeUndefined();
    });
  });

  describe('Validation delegation', () => {
    it('should throw when orderId is empty', () => {
      expect(() => builder.withOrderId('').build()).toThrow('Order ID is required');
    });

    it('should throw when amount is zero', () => {
      expect(() => builder.withAmount(0).build()).toThrow('Payment amount must be greater than 0');
    });

    it('should throw when amount is negative', () => {
      expect(() => builder.withAmount(-10).build()).toThrow(
        'Payment amount must be greater than 0',
      );
    });

    it('should throw when refundedAmount is negative', () => {
      expect(() => builder.withRefundedAmount(-5).build()).toThrow(
        'Refunded amount cannot be negative',
      );
    });

    it('should throw when refundedAmount exceeds amount', () => {
      expect(() => builder.withAmount(50).withRefundedAmount(100).build()).toThrow(
        'Refunded amount cannot exceed payment amount',
      );
    });
  });

  describe('Entity behavior after build', () => {
    it('should produce a Payment that supports markAsProcessing()', () => {
      const payment = builder
        .withOrderId('order-proc')
        .withAmount(75)
        .withStatus(PaymentStatus.PENDING)
        .build();

      payment.markAsProcessing();
      expect(payment.status).toBe(PaymentStatus.PROCESSING);
    });

    it('should produce a Payment that supports refund()', () => {
      const payment = builder
        .withOrderId('order-refund')
        .withAmount(100)
        .withStatus(PaymentStatus.COMPLETED)
        .build();

      payment.refund(30);
      expect(payment.refundedAmount).toBe(30);
      expect(payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    });

    it('should produce a Payment that supports getMaskedCardNumber()', () => {
      const payment = builder.withCardLast4('9876').withCardBrand('Visa').build();

      expect(payment.getMaskedCardNumber()).toBe('**** **** **** 9876');
    });

    it('should produce a Payment that supports clone()', () => {
      const original = builder
        .withId('clone-pay')
        .withOrderId('order-clone')
        .withAmount(200)
        .withMethod(PaymentMethod.DEBIT_CARD)
        .build();

      const cloned = original.clone();
      expect(cloned.id).toBe(original.id);
      expect(cloned.orderId).toBe(original.orderId);
      expect(cloned.amount).toBe(original.amount);
      expect(cloned).not.toBe(original);
    });

    it('should produce a Payment that supports getPaymentDuration()', () => {
      const created = new Date('2025-01-01T10:00:00Z');
      const completed = new Date('2025-01-01T10:00:05Z');

      const payment = builder.withCreatedAt(created).withCompletedAt(completed).build();

      expect(payment.getPaymentDuration()).toBe(5000);
    });
  });

  describe('Multiple builds (builder reuse)', () => {
    it('should produce independent instances on successive builds', () => {
      const baseBuilder = new PaymentBuilder()
        .withOrderId('shared-order')
        .withAmount(100)
        .withMethod(PaymentMethod.CASH);

      const payment1 = baseBuilder.withId('pay-1').build();
      const payment2 = baseBuilder.withId('pay-2').build();

      expect(payment1.id).toBe('pay-1');
      expect(payment2.id).toBe('pay-2');
      expect(payment1).not.toBe(payment2);
    });
  });
});
