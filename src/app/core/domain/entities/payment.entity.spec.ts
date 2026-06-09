import { describe, it, expect, beforeEach } from 'vitest';
import { Payment, PaymentMethod, PaymentStatus } from '@core/domain/entities/payment.entity';

describe('Payment Entity', () => {
  let payment: Payment;
  const testId = 'payment-123';
  const testOrderId = 'order-456';
  const testAmount = 100;
  const testMethod = PaymentMethod.CREDIT_CARD;

  beforeEach(() => {
    payment = new Payment({
      id: testId,
      orderId: testOrderId,
      amount: testAmount,
      method: testMethod,
    });
  });

  // Helper to create completed payment
  const completePayment = (p: Payment) => {
    p.markAsProcessing();
    p.markAsCompleted();
  };

  describe('Creation & Validation', () => {
    it('should create valid payment', () => {
      expect(payment.id).toBe(testId);
      expect(payment.orderId).toBe(testOrderId);
      expect(payment.amount).toBe(testAmount);
      expect(payment.status).toBe(PaymentStatus.PENDING);
    });

    it.each([
      ['empty order ID', '', testAmount, 'Order ID is required'],
      ['zero amount', testOrderId, 0, 'Payment amount must be greater than 0'],
      ['negative amount', testOrderId, -50, 'Payment amount must be greater than 0'],
    ])('should throw error for %s', (_, orderId, amount, expectedError) => {
      expect(
        () =>
          new Payment({
            id: testId,
            orderId: orderId as string,
            amount: amount as number,
            method: testMethod,
          }),
      ).toThrow(expectedError);
    });

    it.each([
      ['negative refunded', -10, 'Refunded amount cannot be negative'],
      ['exceeds payment', 150, 'Refunded amount cannot exceed payment amount'],
    ])('should throw error for %s amount', (_, refundedAmount, expectedError) => {
      expect(
        () =>
          new Payment({
            id: testId,
            orderId: testOrderId,
            amount: testAmount,
            method: testMethod,
            status: PaymentStatus.PENDING,
            currency: 'USD',
            refundedAmount,
          }),
      ).toThrow(expectedError);
    });
  });

  describe('Payment Lifecycle', () => {
    it.each([
      ['processing', () => payment.markAsProcessing('user-1'), PaymentStatus.PROCESSING],
      [
        'completed',
        () => {
          payment.markAsProcessing();
          payment.markAsCompleted('user-1');
        },
        PaymentStatus.COMPLETED,
      ],
      [
        'failed',
        () => {
          payment.markAsProcessing();
          payment.markAsFailed('Test', 'user-1');
        },
        PaymentStatus.FAILED,
      ],
    ])('should transition to %s', (_, action, expectedStatus) => {
      action();
      expect(payment.status).toBe(expectedStatus);
    });

    it('should store transaction ID when processing', () => {
      payment.markAsProcessingWithTransaction('txn-789', 'user-1');
      expect(payment.transactionId).toBe('txn-789');
    });

    it('should store receipt when completed', () => {
      payment.markAsProcessing();
      payment.markAsCompletedWithReceipt('receipt-001', 'user-1');
      expect(payment.receiptNumber).toBe('receipt-001');
    });

    it.each([
      [
        'process non-pending',
        () => {
          payment.markAsProcessing();
          payment.markAsProcessing();
        },
        'Can only process pending payments',
      ],
      [
        'complete non-processing',
        () => payment.markAsCompleted(),
        'Can only complete processing payments',
      ],
      [
        'fail completed',
        () => {
          completePayment(payment);
          payment.markAsFailed('Test');
        },
        'Cannot fail a completed payment',
      ],
    ])('should throw error when trying to %s', (_, action, expectedError) => {
      expect(action).toThrow(expectedError);
    });
  });

  describe('Refund Operations', () => {
    beforeEach(() => completePayment(payment));

    it.each([
      ['partial', 30, PaymentStatus.PARTIALLY_REFUNDED, 70],
      ['full', 100, PaymentStatus.REFUNDED, 0],
    ])('should process %s refund', (_, amount, expectedStatus, expectedRefundable) => {
      payment.refund(amount);
      expect(payment.status).toBe(expectedStatus);
      expect(payment.getRefundableAmount()).toBe(expectedRefundable);
    });

    it('should process multiple partial refunds', () => {
      payment.refund(30);
      payment.refund(20);
      expect(payment.refundedAmount).toBe(50);
    });

    it.each([
      [
        'non-completed',
        () =>
          new Payment({
            id: testId,
            orderId: testOrderId,
            amount: testAmount,
            method: testMethod,
          }).refund(50),
        'Can only refund completed payments',
      ],
      ['zero amount', () => payment.refund(0), 'Refund amount must be greater than 0'],
      ['negative amount', () => payment.refund(-10), 'Refund amount must be greater than 0'],
      [
        'exceeds payment',
        () => payment.refund(150),
        'Total refund amount cannot exceed payment amount',
      ],
      [
        'total exceeds',
        () => {
          payment.refund(80);
          payment.refund(30);
        },
        'Total refund amount cannot exceed payment amount',
      ],
    ])('should throw error for %s', (_, action, expectedError) => {
      expect(action).toThrow(expectedError);
    });
  });

  describe('Status Checks', () => {
    it.each([
      [
        'pending',
        PaymentStatus.PENDING,
        { isPending: true, isProcessing: false, isCompleted: false },
      ],
      [
        'processing',
        PaymentStatus.PROCESSING,
        { isPending: false, isProcessing: true, isCompleted: false },
      ],
      [
        'completed',
        PaymentStatus.COMPLETED,
        { isPending: false, isProcessing: false, isCompleted: true },
      ],
    ])('should check %s status', (_, status, expected) => {
      if (status === PaymentStatus.PROCESSING) payment.markAsProcessing();
      if (status === PaymentStatus.COMPLETED) completePayment(payment);

      expect(payment.isPending()).toBe(expected.isPending);
      expect(payment.isProcessing()).toBe(expected.isProcessing);
      expect(payment.isCompleted()).toBe(expected.isCompleted);
    });

    it('should check refundable status', () => {
      expect(payment.isRefundable()).toBe(false);
      completePayment(payment);
      expect(payment.isRefundable()).toBe(true);
      payment.refund(100);
      expect(payment.isRefundable()).toBe(false);
    });
  });

  describe('Card Details & Utilities', () => {
    it('should mask card number', () => {
      const cardPayment = new Payment({
        id: testId,
        orderId: testOrderId,
        amount: testAmount,
        method: testMethod,
        cardLast4: '4242',
        cardBrand: 'Visa',
      });
      expect(cardPayment.getMaskedCardNumber()).toBe('**** **** **** 4242');
    });

    it('should calculate payment duration', async () => {
      payment.markAsProcessing();
      await new Promise((resolve) => setTimeout(resolve, 10));
      payment.markAsCompleted();
      expect(payment.getPaymentDuration()).toBeGreaterThan(0);
    });

    it('should clone and serialize', () => {
      const cloned = payment.clone();
      expect(cloned.id).toBe(payment.id);

      const json = payment.toJSON();
      const restored = Payment.fromJSON(json);
      expect(restored.id).toBe(payment.id);
    });

    it('should track audit info', () => {
      expect(payment.isNew()).toBe(true);
      payment.markAsProcessing('user-1');
      expect(payment.updatedBy).toBe('user-1');
    });
  });
});

// Made with Bob
