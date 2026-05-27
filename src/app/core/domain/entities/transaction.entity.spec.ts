import { describe, it, expect, beforeEach } from 'vitest';
import { 
  Transaction, 
  TransactionStatus, 
  TransactionType,
  ITransactionItem 
} from './transaction.entity';
import { Customer, CustomerStatus, CustomerTier } from './customer.entity';
import { Product } from './product.entity';
import { CartItem } from './cart.entity';

describe('Transaction Entity', () => {
  let mockItems: ITransactionItem[];
  let transaction: Transaction;

  beforeEach(() => {
    mockItems = [
      {
        productId: 'prod-1',
        productName: 'Product 1',
        quantity: 2,
        unitPrice: 10.00,
        subtotal: 20.00
      },
      {
        productId: 'prod-2',
        productName: 'Product 2',
        quantity: 1,
        unitPrice: 15.00,
        subtotal: 15.00
      }
    ];

    transaction = new Transaction(
      'txn-1',
      'cust-1',
      mockItems,
      35.00,
      0.08,
      2.80,
      0,
      37.80
    );
  });

  describe('Constructor and Validation', () => {
    it('should create a transaction with valid data', () => {
      expect(transaction.id).toBe('txn-1');
      expect(transaction.customerId).toBe('cust-1');
      expect(transaction.items).toHaveLength(2);
      expect(transaction.subtotal).toBe(35.00);
      expect(transaction.taxRate).toBe(0.08);
      expect(transaction.taxAmount).toBe(2.80);
      expect(transaction.total).toBe(37.80);
      expect(transaction.status).toBe(TransactionStatus.PENDING);
      expect(transaction.type).toBe(TransactionType.SALE);
    });

    it('should throw error if no items provided', () => {
      expect(() => {
        new Transaction(
          'txn-1',
          'cust-1',
          [],
          0,
          0.08,
          0,
          0,
          0
        );
      }).toThrow('Transaction must have at least one item');
    });

    it('should create transaction without customer', () => {
      const txn = new Transaction(
        'txn-1',
        undefined,
        mockItems,
        35.00,
        0.08,
        2.80,
        0,
        37.80
      );
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
      transaction.refund(10.00, 'user-1');
      expect(transaction.refundedAmount).toBe(10.00);
      expect(transaction.status).toBe(TransactionStatus.PARTIALLY_REFUNDED);
    });

    it('should process full refund', () => {
      transaction.refund(37.80, 'user-1');
      expect(transaction.refundedAmount).toBe(37.80);
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
      const product1 = new Product(
        'prod-1',
        'Product 1',
        10.00,
        'SKU-1',
        'Category A',
        100
      );
      
      const product2 = new Product(
        'prod-2',
        'Product 2',
        15.00,
        'SKU-2',
        'Category B',
        50
      );
      
      const cartItems = [
        new CartItem(product1, 2),
        new CartItem(product2, 1)
      ];
      
      const txn = Transaction.fromCartItems(
        'txn-1',
        cartItems,
        0.08,
        0,
        'cust-1',
        'user-1'
      );
      
      expect(txn.id).toBe('txn-1');
      expect(txn.customerId).toBe('cust-1');
      expect(txn.items).toHaveLength(2);
      expect(txn.subtotal).toBe(35.00);
      expect(txn.taxAmount).toBeCloseTo(2.80, 2);
      expect(txn.total).toBeCloseTo(37.80, 2);
      expect(txn.status).toBe(TransactionStatus.PENDING);
      expect(txn.createdBy).toBe('user-1');
    });
  });
});

// Made with Bob