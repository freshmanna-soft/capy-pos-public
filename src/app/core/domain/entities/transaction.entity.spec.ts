import { describe, it, expect, beforeEach } from 'vitest';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
  ITransactionItem,
} from '@core/domain/entities/transaction.entity';
import { TransactionBuilder } from '@core/domain/entities/transaction.builder';
import { ProductBuilder } from '@core/domain/entities/product.builder';
import { CartItem } from '@core/domain/entities/cart.entity';

describe('Transaction Entity', () => {
  let mockItems: ITransactionItem[];
  let transaction: Transaction;

  beforeEach(() => {
    mockItems = [
      {
        productId: 'prod-1',
        productName: 'Product 1',
        quantity: 2,
        unitPrice: 10.0,
        subtotal: 20.0,
      },
      {
        productId: 'prod-2',
        productName: 'Product 2',
        quantity: 1,
        unitPrice: 15.0,
        subtotal: 15.0,
      },
    ];

    transaction = new TransactionBuilder()
      .withId('txn-1')
      .withCustomerId('cust-1')
      .withItems(mockItems)
      .withSubtotal(35.0)
      .withTaxRate(0.08)
      .withTaxAmount(2.8)
      .withDiscountAmount(0)
      .withTotal(37.8)
      .build();
  });

  describe('Constructor and Validation', () => {
    it('should create a transaction with valid data', () => {
      expect(transaction.id).toBe('txn-1');
      expect(transaction.customerId).toBe('cust-1');
      expect(transaction.items).toHaveLength(2);
      expect(transaction.subtotal).toBe(35.0);
      expect(transaction.taxRate).toBe(0.08);
      expect(transaction.taxAmount).toBe(2.8);
      expect(transaction.total).toBe(37.8);
      expect(transaction.status).toBe(TransactionStatus.PENDING);
      expect(transaction.type).toBe(TransactionType.SALE);
    });

    it('should throw error if no items provided', () => {
      expect(() => {
        new TransactionBuilder()
          .withId('txn-1')
          .withCustomerId('cust-1')
          .withItems([])
          .withSubtotal(0)
          .withTaxRate(0.08)
          .withTaxAmount(0)
          .withDiscountAmount(0)
          .withTotal(0)
          .build();
      }).toThrow('Transaction must have at least one item');
    });

    it('should create transaction without customer', () => {
      const txn = new TransactionBuilder()
        .withId('txn-1')
        .withItems(mockItems)
        .withSubtotal(35.0)
        .withTaxRate(0.08)
        .withTaxAmount(2.8)
        .withDiscountAmount(0)
        .withTotal(37.8)
        .build();
      expect(txn.customerId).toBeUndefined();
      expect(txn.hasCustomer()).toBe(false);
    });
  });

  describe('Status Management', () => {
    it('should mark transaction as processing', () => {
      transaction.markAsProcessing('user-1');
      expect(transaction.status).toBe(TransactionStatus.PROCESSING);
      expect(transaction.updatedBy).toBe('user-1');
    });

    it('should mark transaction as completed', () => {
      transaction.markAsProcessing();
      transaction.markAsCompleted('user-1');
      expect(transaction.status).toBe(TransactionStatus.COMPLETED);
      expect(transaction.completedAt).toBeInstanceOf(Date);
      expect(transaction.updatedBy).toBe('user-1');
    });

    it('should cancel transaction', () => {
      transaction.cancel('Customer request', 'user-1');
      expect(transaction.status).toBe(TransactionStatus.CANCELLED);
      expect(transaction.cancelledAt).toBeInstanceOf(Date);
      expect(transaction.cancellationReason).toBe('Customer request');
    });
  });

  describe('Refund Operations', () => {
    beforeEach(() => {
      transaction.markAsProcessing();
      transaction.markAsCompleted();
    });

    it('should process partial refund', () => {
      transaction.refund(10.0, 'user-1');
      expect(transaction.refundedAmount).toBe(10.0);
      expect(transaction.status).toBe(TransactionStatus.PARTIALLY_REFUNDED);
    });

    it('should process full refund', () => {
      transaction.refund(37.8, 'user-1');
      expect(transaction.refundedAmount).toBe(37.8);
      expect(transaction.status).toBe(TransactionStatus.REFUNDED);
    });
  });

  describe('Payment Management', () => {
    it('should add payment to transaction', () => {
      transaction.addPayment('pay-1', 'user-1');
      expect(transaction.paymentIds).toContain('pay-1');
      expect(transaction.hasPayments()).toBe(true);
      expect(transaction.getPaymentCount()).toBe(1);
    });
  });

  describe('Factory Method - fromCartItems', () => {
    it('should create transaction from cart items', () => {
      const product1 = new ProductBuilder()
        .withId('prod-1')
        .withName('Product 1')
        .withPrice(10.0)
        .withSku('SKU-1')
        .withCategory('Category A')
        .withStock(100)
        .build();

      const product2 = new ProductBuilder()
        .withId('prod-2')
        .withName('Product 2')
        .withPrice(15.0)
        .withSku('SKU-2')
        .withCategory('Category B')
        .withStock(50)
        .build();

      const cartItems = [new CartItem(product1, 2), new CartItem(product2, 1)];

      const txn = Transaction.fromCartItems('txn-1', cartItems, 0.08, 0, 'cust-1', 'user-1');

      expect(txn.id).toBe('txn-1');
      expect(txn.customerId).toBe('cust-1');
      expect(txn.items).toHaveLength(2);
      expect(txn.subtotal).toBe(35.0);
      expect(txn.taxAmount).toBeCloseTo(2.8, 2);
      expect(txn.total).toBeCloseTo(37.8, 2);
      expect(txn.status).toBe(TransactionStatus.PENDING);
      expect(txn.createdBy).toBe('user-1');
    });
  });
});

// Made with Bob
