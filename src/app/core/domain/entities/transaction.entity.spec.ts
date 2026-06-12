import {
  Transaction,
  TransactionStatus,
  TransactionType,
  ITransactionItem,
  ITransactionParams,
} from '@core/domain/entities/transaction.entity';
import { CartItem } from '@core/domain/entities/cart.entity';
import { ProductBuilder } from '@core/domain/entities/product.builder';

/**
 * Comprehensive Unit Tests for Transaction Entity
 * Covers: AbstractTransaction + Transaction class
 * Target: 95%+ coverage on all metrics
 */
describe('Transaction Entity', () => {
  const createValidItems = (): ITransactionItem[] => [
    {
      productId: 'prod-1',
      productName: 'Coffee',
      quantity: 2,
      unitPrice: 5.0,
      subtotal: 10.0,
    },
    {
      productId: 'prod-2',
      productName: 'Tea',
      quantity: 1,
      unitPrice: 3.0,
      subtotal: 3.0,
    },
  ];

  const createValidParams = (overrides?: Partial<ITransactionParams>): ITransactionParams => ({
    id: 'txn-001',
    items: createValidItems(),
    subtotal: 13.0,
    taxRate: 0.1,
    taxAmount: 1.3,
    discountAmount: 0,
    total: 14.3,
    ...overrides,
  });

  describe('Construction', () => {
    it('should create a valid transaction with required params', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.id).toBe('txn-001');
      expect(txn.items).toHaveLength(2);
      expect(txn.subtotal).toBe(13.0);
      expect(txn.taxRate).toBe(0.1);
      expect(txn.taxAmount).toBe(1.3);
      expect(txn.discountAmount).toBe(0);
      expect(txn.total).toBe(14.3);
    });

    it('should default status to PENDING', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.status).toBe(TransactionStatus.PENDING);
    });

    it('should default type to SALE', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.type).toBe(TransactionType.SALE);
    });

    it('should default refundedAmount to 0', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.refundedAmount).toBe(0);
    });

    it('should default paymentIds to empty array', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.paymentIds).toEqual([]);
    });

    it('should accept optional customerId', () => {
      const txn = new Transaction(createValidParams({ customerId: 'cust-1' }));
      expect(txn.customerId).toBe('cust-1');
    });

    it('should accept optional status', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.PROCESSING }));
      expect(txn.status).toBe(TransactionStatus.PROCESSING);
    });

    it('should accept optional type', () => {
      const txn = new Transaction(createValidParams({ type: TransactionType.RETURN }));
      expect(txn.type).toBe(TransactionType.RETURN);
    });

    it('should accept optional receiptNumber', () => {
      const txn = new Transaction(createValidParams({ receiptNumber: 'REC-001' }));
      expect(txn.receiptNumber).toBe('REC-001');
    });

    it('should accept optional notes', () => {
      const txn = new Transaction(createValidParams({ notes: 'Test note' }));
      expect(txn.notes).toBe('Test note');
    });

    it('should accept optional createdAt and updatedAt', () => {
      const date = new Date('2025-01-01');
      const txn = new Transaction(createValidParams({ createdAt: date, updatedAt: date }));
      expect(txn.createdAt).toEqual(date);
      expect(txn.updatedAt).toEqual(date);
    });

    it('should accept optional createdBy and updatedBy', () => {
      const txn = new Transaction(createValidParams({ createdBy: 'user-1', updatedBy: 'user-2' }));
      expect(txn.createdBy).toBe('user-1');
      expect(txn.updatedBy).toBe('user-2');
    });

    it('should accept optional completedAt', () => {
      const date = new Date('2025-01-02');
      const txn = new Transaction(createValidParams({ completedAt: date }));
      expect(txn.completedAt).toEqual(date);
    });

    it('should accept optional cancelledAt and cancellationReason', () => {
      const date = new Date('2025-01-02');
      const txn = new Transaction(
        createValidParams({ cancelledAt: date, cancellationReason: 'Customer request' })
      );
      expect(txn.cancelledAt).toEqual(date);
      expect(txn.cancellationReason).toBe('Customer request');
    });

    it('should accept optional refundedAmount', () => {
      const txn = new Transaction(
        createValidParams({
          status: TransactionStatus.PARTIALLY_REFUNDED,
          refundedAmount: 5.0,
        })
      );
      expect(txn.refundedAmount).toBe(5.0);
    });
  });

  describe('Validation', () => {
    it('should throw if items array is empty', () => {
      expect(() => new Transaction(createValidParams({ items: [] }))).toThrow(
        'Transaction must have at least one item'
      );
    });

    it('should throw if subtotal is negative', () => {
      expect(() => new Transaction(createValidParams({ subtotal: -1 }))).toThrow(
        'Subtotal cannot be negative'
      );
    });

    it('should throw if taxRate is negative', () => {
      expect(() => new Transaction(createValidParams({ taxRate: -0.1 }))).toThrow(
        'Tax rate must be between 0 and 1'
      );
    });

    it('should throw if taxRate exceeds 1', () => {
      expect(() => new Transaction(createValidParams({ taxRate: 1.5 }))).toThrow(
        'Tax rate must be between 0 and 1'
      );
    });

    it('should throw if taxAmount is negative', () => {
      expect(() => new Transaction(createValidParams({ taxAmount: -1 }))).toThrow(
        'Tax amount cannot be negative'
      );
    });

    it('should throw if discountAmount is negative', () => {
      expect(() => new Transaction(createValidParams({ discountAmount: -1 }))).toThrow(
        'Discount amount cannot be negative'
      );
    });

    it('should throw if total is negative', () => {
      expect(() => new Transaction(createValidParams({ total: -1 }))).toThrow(
        'Total cannot be negative'
      );
    });

    it('should throw if refundedAmount is negative', () => {
      expect(() => new Transaction(createValidParams({ refundedAmount: -1 }))).toThrow(
        'Refunded amount cannot be negative'
      );
    });

    it('should throw if refundedAmount exceeds total', () => {
      expect(() => new Transaction(createValidParams({ total: 10, refundedAmount: 15 }))).toThrow(
        'Refunded amount cannot exceed total'
      );
    });

    it('should throw if id is empty', () => {
      expect(() => new Transaction(createValidParams({ id: '' }))).toThrow('ID is required');
    });
  });

  describe('Status Transitions - markAsProcessing', () => {
    it('should transition from PENDING to PROCESSING', () => {
      const txn = new Transaction(createValidParams());
      txn.markAsProcessing();
      expect(txn.status).toBe(TransactionStatus.PROCESSING);
    });

    it('should accept updatedBy parameter', () => {
      const txn = new Transaction(createValidParams());
      txn.markAsProcessing('cashier-1');
      expect(txn.updatedBy).toBe('cashier-1');
    });

    it('should throw if not in PENDING status', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.PROCESSING }));
      expect(() => txn.markAsProcessing()).toThrow('Can only process pending transactions');
    });

    it('should throw if in COMPLETED status', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      expect(() => txn.markAsProcessing()).toThrow('Can only process pending transactions');
    });
  });

  describe('Status Transitions - markAsCompleted', () => {
    it('should transition from PROCESSING to COMPLETED', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.PROCESSING }));
      txn.markAsCompleted();
      expect(txn.status).toBe(TransactionStatus.COMPLETED);
      expect(txn.completedAt).toBeInstanceOf(Date);
    });

    it('should accept updatedBy parameter', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.PROCESSING }));
      txn.markAsCompleted('manager-1');
      expect(txn.updatedBy).toBe('manager-1');
    });

    it('should throw if not in PROCESSING status', () => {
      const txn = new Transaction(createValidParams());
      expect(() => txn.markAsCompleted()).toThrow('Can only complete processing transactions');
    });
  });

  describe('Status Transitions - cancel', () => {
    it('should cancel a PENDING transaction', () => {
      const txn = new Transaction(createValidParams());
      txn.cancel('Customer changed mind');
      expect(txn.status).toBe(TransactionStatus.CANCELLED);
      expect(txn.cancelledAt).toBeInstanceOf(Date);
      expect(txn.cancellationReason).toBe('Customer changed mind');
    });

    it('should cancel a PROCESSING transaction', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.PROCESSING }));
      txn.cancel('System error');
      expect(txn.status).toBe(TransactionStatus.CANCELLED);
    });

    it('should accept updatedBy parameter', () => {
      const txn = new Transaction(createValidParams());
      txn.cancel('Reason', 'admin-1');
      expect(txn.updatedBy).toBe('admin-1');
    });

    it('should throw if transaction is COMPLETED', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      expect(() => txn.cancel('Reason')).toThrow(
        'Cannot cancel a completed transaction. Use refund instead.'
      );
    });

    it('should throw if transaction is already CANCELLED', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.CANCELLED }));
      expect(() => txn.cancel('Reason')).toThrow('Transaction is already cancelled');
    });
  });

  describe('Refund', () => {
    it('should process a full refund on COMPLETED transaction', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      txn.refund(14.3);
      expect(txn.status).toBe(TransactionStatus.REFUNDED);
      expect(txn.refundedAmount).toBe(14.3);
    });

    it('should process a partial refund on COMPLETED transaction', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      txn.refund(5.0);
      expect(txn.status).toBe(TransactionStatus.PARTIALLY_REFUNDED);
      expect(txn.refundedAmount).toBe(5.0);
    });

    it('should allow multiple partial refunds', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      txn.refund(5.0);
      expect(txn.status).toBe(TransactionStatus.PARTIALLY_REFUNDED);
      txn.refund(9.3);
      expect(txn.status).toBe(TransactionStatus.REFUNDED);
      expect(txn.refundedAmount).toBe(14.3);
    });

    it('should accept updatedBy parameter', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      txn.refund(5.0, 'manager-1');
      expect(txn.updatedBy).toBe('manager-1');
    });

    it('should throw if amount is 0', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      expect(() => txn.refund(0)).toThrow('Refund amount must be greater than 0');
    });

    it('should throw if amount is negative', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      expect(() => txn.refund(-5)).toThrow('Refund amount must be greater than 0');
    });

    it('should throw if total refund exceeds transaction total', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      expect(() => txn.refund(20)).toThrow('Total refund amount cannot exceed transaction total');
    });

    it('should throw if transaction is PENDING', () => {
      const txn = new Transaction(createValidParams());
      expect(() => txn.refund(5)).toThrow('Can only refund completed transactions');
    });

    it('should throw if transaction is CANCELLED', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.CANCELLED }));
      expect(() => txn.refund(5)).toThrow('Can only refund completed transactions');
    });
  });

  describe('IRefundable Interface', () => {
    it('should return refundable amount', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      expect(txn.getRefundableAmount()).toBe(14.3);
    });

    it('should return reduced refundable amount after partial refund', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      txn.refund(4.3);
      expect(txn.getRefundableAmount()).toBe(10.0);
    });

    it('should return true for isRefundable on COMPLETED with no refunds', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      expect(txn.isRefundable()).toBe(true);
    });

    it('should return false for isRefundable on fully refunded', () => {
      const txn = new Transaction(
        createValidParams({
          status: TransactionStatus.REFUNDED,
          refundedAmount: 14.3,
        })
      );
      expect(txn.isRefundable()).toBe(false);
    });

    it('should return false for isRefundable on PENDING', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.isRefundable()).toBe(false);
    });
  });

  describe('Status Check Methods', () => {
    it('isPending should return true for PENDING', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.isPending()).toBe(true);
      expect(txn.isProcessing()).toBe(false);
      expect(txn.isCompleted()).toBe(false);
      expect(txn.isCancelled()).toBe(false);
      expect(txn.isFullyRefunded()).toBe(false);
      expect(txn.isPartiallyRefunded()).toBe(false);
    });

    it('isProcessing should return true for PROCESSING', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.PROCESSING }));
      expect(txn.isProcessing()).toBe(true);
    });

    it('isCompleted should return true for COMPLETED', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.COMPLETED }));
      expect(txn.isCompleted()).toBe(true);
    });

    it('isCancelled should return true for CANCELLED', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.CANCELLED }));
      expect(txn.isCancelled()).toBe(true);
    });

    it('isFullyRefunded should return true for REFUNDED', () => {
      const txn = new Transaction(
        createValidParams({
          status: TransactionStatus.REFUNDED,
          refundedAmount: 14.3,
        })
      );
      expect(txn.isFullyRefunded()).toBe(true);
    });

    it('isPartiallyRefunded should return true for PARTIALLY_REFUNDED', () => {
      const txn = new Transaction(
        createValidParams({
          status: TransactionStatus.PARTIALLY_REFUNDED,
          refundedAmount: 5.0,
        })
      );
      expect(txn.isPartiallyRefunded()).toBe(true);
    });
  });

  describe('Computed Values', () => {
    it('getTotalItems should sum all item quantities', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.getTotalItems()).toBe(3); // 2 + 1
    });

    it('getTransactionDuration should return undefined if not completed', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.getTransactionDuration()).toBeUndefined();
    });

    it('getTransactionDuration should return duration in ms if completed', () => {
      const createdAt = new Date('2025-01-01T10:00:00Z');
      const completedAt = new Date('2025-01-01T10:05:00Z');
      const txn = new Transaction(
        createValidParams({
          status: TransactionStatus.COMPLETED,
          createdAt,
          completedAt,
        })
      );
      expect(txn.getTransactionDuration()).toBe(300000); // 5 minutes in ms
    });

    it('getEffectiveTotal should return total minus refunded', () => {
      const txn = new Transaction(
        createValidParams({
          status: TransactionStatus.PARTIALLY_REFUNDED,
          refundedAmount: 4.3,
        })
      );
      expect(txn.getEffectiveTotal()).toBeCloseTo(10.0);
    });

    it('getEffectiveTotal should return full total when no refunds', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.getEffectiveTotal()).toBe(14.3);
    });
  });

  describe('Payment Management', () => {
    it('should add a payment', () => {
      const txn = new Transaction(createValidParams());
      txn.addPayment('pay-1');
      expect(txn.paymentIds).toContain('pay-1');
    });

    it('should add multiple payments', () => {
      const txn = new Transaction(createValidParams());
      txn.addPayment('pay-1');
      txn.addPayment('pay-2');
      expect(txn.paymentIds).toEqual(['pay-1', 'pay-2']);
    });

    it('should accept updatedBy on addPayment', () => {
      const txn = new Transaction(createValidParams());
      txn.addPayment('pay-1', 'cashier-1');
      expect(txn.updatedBy).toBe('cashier-1');
    });

    it('should throw if payment already exists', () => {
      const txn = new Transaction(createValidParams());
      txn.addPayment('pay-1');
      expect(() => txn.addPayment('pay-1')).toThrow('Payment already added to transaction');
    });

    it('should remove a payment', () => {
      const txn = new Transaction(createValidParams({ paymentIds: ['pay-1', 'pay-2'] }));
      txn.removePayment('pay-1');
      expect(txn.paymentIds).toEqual(['pay-2']);
    });

    it('should accept updatedBy on removePayment', () => {
      const txn = new Transaction(createValidParams({ paymentIds: ['pay-1'] }));
      txn.removePayment('pay-1', 'admin-1');
      expect(txn.updatedBy).toBe('admin-1');
    });

    it('should throw if payment not found on remove', () => {
      const txn = new Transaction(createValidParams());
      expect(() => txn.removePayment('pay-999')).toThrow('Payment not found in transaction');
    });

    it('hasPayments should return false when empty', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.hasPayments()).toBe(false);
    });

    it('hasPayments should return true when payments exist', () => {
      const txn = new Transaction(createValidParams({ paymentIds: ['pay-1'] }));
      expect(txn.hasPayments()).toBe(true);
    });

    it('getPaymentCount should return number of payments', () => {
      const txn = new Transaction(createValidParams({ paymentIds: ['pay-1', 'pay-2'] }));
      expect(txn.getPaymentCount()).toBe(2);
    });
  });

  describe('markAsCompletedWithReceipt', () => {
    it('should complete and set receipt number', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.PROCESSING }));
      txn.markAsCompletedWithReceipt('REC-123');
      expect(txn.status).toBe(TransactionStatus.COMPLETED);
      expect(txn.receiptNumber).toBe('REC-123');
    });

    it('should accept updatedBy', () => {
      const txn = new Transaction(createValidParams({ status: TransactionStatus.PROCESSING }));
      txn.markAsCompletedWithReceipt('REC-123', 'cashier-1');
      expect(txn.updatedBy).toBe('cashier-1');
    });
  });

  describe('Notes', () => {
    it('should add notes', () => {
      const txn = new Transaction(createValidParams());
      txn.addNotes('Customer requested gift wrap');
      expect(txn.notes).toBe('Customer requested gift wrap');
    });

    it('should accept updatedBy on addNotes', () => {
      const txn = new Transaction(createValidParams());
      txn.addNotes('Note', 'cashier-1');
      expect(txn.updatedBy).toBe('cashier-1');
    });
  });

  describe('Customer', () => {
    it('hasCustomer should return false when no customerId', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.hasCustomer()).toBe(false);
    });

    it('hasCustomer should return true when customerId is set', () => {
      const txn = new Transaction(createValidParams({ customerId: 'cust-1' }));
      expect(txn.hasCustomer()).toBe(true);
    });
  });

  describe('Item Lookup', () => {
    it('getItem should return item by productId', () => {
      const txn = new Transaction(createValidParams());
      const item = txn.getItem('prod-1');
      expect(item).toBeDefined();
      expect(item?.productName).toBe('Coffee');
    });

    it('getItem should return undefined for non-existent product', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.getItem('prod-999')).toBeUndefined();
    });

    it('hasProduct should return true for existing product', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.hasProduct('prod-1')).toBe(true);
    });

    it('hasProduct should return false for non-existent product', () => {
      const txn = new Transaction(createValidParams());
      expect(txn.hasProduct('prod-999')).toBe(false);
    });
  });

  describe('clone', () => {
    it('should create a copy with same values', () => {
      const txn = new Transaction(
        createValidParams({
          customerId: 'cust-1',
          paymentIds: ['pay-1'],
          receiptNumber: 'REC-001',
          notes: 'Test',
        })
      );
      const clone = txn.clone();
      expect(clone.id).toBe(txn.id);
      expect(clone.items).toEqual(txn.items);
      expect(clone.subtotal).toBe(txn.subtotal);
      expect(clone.total).toBe(txn.total);
      expect(clone.paymentIds).toEqual(txn.paymentIds);
      expect(clone.receiptNumber).toBe(txn.receiptNumber);
      expect(clone.notes).toBe(txn.notes);
    });

    it('should create an independent copy (not same reference)', () => {
      const txn = new Transaction(createValidParams({ paymentIds: ['pay-1'] }));
      const clone = txn.clone();
      clone.addPayment('pay-2');
      expect(txn.paymentIds).toEqual(['pay-1']);
      expect(clone.paymentIds).toEqual(['pay-1', 'pay-2']);
    });
  });

  describe('toJSON', () => {
    it('should serialize transaction to JSON', () => {
      const txn = new Transaction(
        createValidParams({
          customerId: 'cust-1',
          paymentIds: ['pay-1'],
          receiptNumber: 'REC-001',
          notes: 'Test note',
        })
      );
      const json = txn.toJSON();

      expect(json['id']).toBe('txn-001');
      expect(json['customerId']).toBe('cust-1');
      expect(json['items']).toEqual(createValidItems());
      expect(json['subtotal']).toBe(13.0);
      expect(json['taxRate']).toBe(0.1);
      expect(json['taxAmount']).toBe(1.3);
      expect(json['discountAmount']).toBe(0);
      expect(json['total']).toBe(14.3);
      expect(json['status']).toBe(TransactionStatus.PENDING);
      expect(json['type']).toBe(TransactionType.SALE);
      expect(json['refundedAmount']).toBe(0);
      expect(json['refundableAmount']).toBe(14.3);
      expect(json['effectiveTotal']).toBe(14.3);
      expect(json['totalItems']).toBe(3);
      expect(json['paymentIds']).toEqual(['pay-1']);
      expect(json['paymentCount']).toBe(1);
      expect(json['receiptNumber']).toBe('REC-001');
      expect(json['notes']).toBe('Test note');
      expect(json['hasCustomer']).toBe(true);
    });

    it('should include completedAt when set', () => {
      const completedAt = new Date('2025-06-01T12:00:00Z');
      const txn = new Transaction(
        createValidParams({
          status: TransactionStatus.COMPLETED,
          completedAt,
        })
      );
      const json = txn.toJSON();
      expect(json['completedAt']).toBe(completedAt.toISOString());
    });

    it('should include cancelledAt and cancellationReason when set', () => {
      const cancelledAt = new Date('2025-06-01T12:00:00Z');
      const txn = new Transaction(
        createValidParams({
          status: TransactionStatus.CANCELLED,
          cancelledAt,
          cancellationReason: 'Test reason',
        })
      );
      const json = txn.toJSON();
      expect(json['cancelledAt']).toBe(cancelledAt.toISOString());
      expect(json['cancellationReason']).toBe('Test reason');
    });

    it('should include transactionDuration when completed', () => {
      const createdAt = new Date('2025-01-01T10:00:00Z');
      const completedAt = new Date('2025-01-01T10:10:00Z');
      const txn = new Transaction(
        createValidParams({
          status: TransactionStatus.COMPLETED,
          createdAt,
          completedAt,
        })
      );
      const json = txn.toJSON();
      expect(json['transactionDuration']).toBe(600000);
    });

    it('should include undefined transactionDuration when not completed', () => {
      const txn = new Transaction(createValidParams());
      const json = txn.toJSON();
      expect(json['transactionDuration']).toBeUndefined();
    });
  });

  describe('fromJSON', () => {
    it('should deserialize transaction from JSON', () => {
      const data = {
        id: 'txn-002',
        customerId: 'cust-1',
        items: createValidItems(),
        subtotal: 13.0,
        taxRate: 0.1,
        taxAmount: 1.3,
        discountAmount: 0,
        total: 14.3,
        status: TransactionStatus.COMPLETED,
        type: TransactionType.SALE,
        refundedAmount: 0,
        createdAt: '2025-01-01T10:00:00.000Z',
        updatedAt: '2025-01-01T10:05:00.000Z',
        createdBy: 'user-1',
        updatedBy: 'user-2',
        completedAt: '2025-01-01T10:05:00.000Z',
        paymentIds: ['pay-1'],
        receiptNumber: 'REC-002',
        notes: 'Deserialized',
      };

      const txn = Transaction.fromJSON(data);
      expect(txn.id).toBe('txn-002');
      expect(txn.customerId).toBe('cust-1');
      expect(txn.items).toEqual(createValidItems());
      expect(txn.status).toBe(TransactionStatus.COMPLETED);
      expect(txn.type).toBe(TransactionType.SALE);
      expect(txn.createdAt).toEqual(new Date('2025-01-01T10:00:00.000Z'));
      expect(txn.updatedAt).toEqual(new Date('2025-01-01T10:05:00.000Z'));
      expect(txn.completedAt).toEqual(new Date('2025-01-01T10:05:00.000Z'));
      expect(txn.paymentIds).toEqual(['pay-1']);
      expect(txn.receiptNumber).toBe('REC-002');
      expect(txn.notes).toBe('Deserialized');
    });

    it('should handle missing optional fields', () => {
      const data = {
        id: 'txn-003',
        items: createValidItems(),
        subtotal: 13.0,
        taxRate: 0.1,
        taxAmount: 1.3,
        discountAmount: 0,
        total: 14.3,
        status: TransactionStatus.PENDING,
        type: TransactionType.SALE,
        refundedAmount: 0,
        createdAt: '2025-01-01T10:00:00.000Z',
        updatedAt: '2025-01-01T10:00:00.000Z',
      };

      const txn = Transaction.fromJSON(data);
      expect(txn.customerId).toBeUndefined();
      expect(txn.completedAt).toBeUndefined();
      expect(txn.cancelledAt).toBeUndefined();
      expect(txn.cancellationReason).toBeUndefined();
      expect(txn.paymentIds).toEqual([]);
      expect(txn.receiptNumber).toBeUndefined();
      expect(txn.notes).toBeUndefined();
      expect(txn.customer).toBeUndefined();
    });

    it('should deserialize with cancelledAt', () => {
      const data = {
        id: 'txn-004',
        items: createValidItems(),
        subtotal: 13.0,
        taxRate: 0.1,
        taxAmount: 1.3,
        discountAmount: 0,
        total: 14.3,
        status: TransactionStatus.CANCELLED,
        type: TransactionType.SALE,
        refundedAmount: 0,
        createdAt: '2025-01-01T10:00:00.000Z',
        updatedAt: '2025-01-01T10:00:00.000Z',
        cancelledAt: '2025-01-01T10:02:00.000Z',
        cancellationReason: 'Test cancel',
      };

      const txn = Transaction.fromJSON(data);
      expect(txn.cancelledAt).toEqual(new Date('2025-01-01T10:02:00.000Z'));
      expect(txn.cancellationReason).toBe('Test cancel');
    });

    it('should deserialize with customer data', () => {
      const data = {
        id: 'txn-005',
        items: createValidItems(),
        subtotal: 13.0,
        taxRate: 0.1,
        taxAmount: 1.3,
        discountAmount: 0,
        total: 14.3,
        status: TransactionStatus.PENDING,
        type: TransactionType.SALE,
        refundedAmount: 0,
        createdAt: '2025-01-01T10:00:00.000Z',
        updatedAt: '2025-01-01T10:00:00.000Z',
        customerId: 'cust-1',
        customer: {
          id: 'cust-1',
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1 555-123-4567',
          status: 'ACTIVE',
          loyaltyPoints: 100,
          tier: 'BRONZE',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      };

      const txn = Transaction.fromJSON(data);
      expect(txn.customer).toBeDefined();
      expect(txn.customer?.name).toBe('John Doe');
    });
  });

  describe('fromCartItems', () => {
    it('should create transaction from cart items', () => {
      const product1 = new ProductBuilder()
        .withId('prod-1')
        .withName('Coffee')
        .withPrice(5.0)
        .withSku('COF-001')
        .withCategory('Beverages')
        .withStock(50)
        .withDescription('Premium coffee')
        .build();

      const product2 = new ProductBuilder()
        .withId('prod-2')
        .withName('Tea')
        .withPrice(3.0)
        .withSku('TEA-001')
        .withCategory('Beverages')
        .withStock(30)
        .withDescription('Green tea')
        .build();

      const cartItems: CartItem[] = [new CartItem(product1, 2), new CartItem(product2, 1)];

      const txn = Transaction.fromCartItems('txn-100', cartItems, 0.1);

      expect(txn.id).toBe('txn-100');
      expect(txn.items).toHaveLength(2);
      expect(txn.items[0].productId).toBe('prod-1');
      expect(txn.items[0].productName).toBe('Coffee');
      expect(txn.items[0].quantity).toBe(2);
      expect(txn.items[0].unitPrice).toBe(5.0);
      expect(txn.items[0].subtotal).toBe(10.0);
      expect(txn.items[1].productId).toBe('prod-2');
      expect(txn.items[1].subtotal).toBe(3.0);
      expect(txn.subtotal).toBe(13.0);
      expect(txn.taxRate).toBe(0.1);
      expect(txn.taxAmount).toBeCloseTo(1.3);
      expect(txn.total).toBeCloseTo(14.3);
      expect(txn.status).toBe(TransactionStatus.PENDING);
      expect(txn.type).toBe(TransactionType.SALE);
    });

    it('should apply discount amount', () => {
      const product = new ProductBuilder()
        .withId('prod-1')
        .withName('Coffee')
        .withPrice(10.0)
        .withSku('COF-001')
        .withCategory('Beverages')
        .withStock(50)
        .withDescription('Coffee')
        .build();

      const cartItems: CartItem[] = [new CartItem(product, 1)];
      const txn = Transaction.fromCartItems('txn-101', cartItems, 0.1, 2.0);

      expect(txn.subtotal).toBe(10.0);
      expect(txn.discountAmount).toBe(2.0);
      // Tax on (subtotal - discount): (10 - 2) * 0.1 = 0.8
      expect(txn.taxAmount).toBeCloseTo(0.8);
      // Total: 10 - 2 + 0.8 = 8.8
      expect(txn.total).toBeCloseTo(8.8);
    });

    it('should accept optional customerId', () => {
      const product = new ProductBuilder()
        .withId('prod-1')
        .withName('Coffee')
        .withPrice(5.0)
        .withSku('COF-001')
        .withCategory('Beverages')
        .withStock(50)
        .withDescription('Coffee')
        .build();

      const cartItems: CartItem[] = [new CartItem(product, 1)];
      const txn = Transaction.fromCartItems('txn-102', cartItems, 0.1, 0, 'cust-1');

      expect(txn.customerId).toBe('cust-1');
    });

    it('should accept optional createdBy', () => {
      const product = new ProductBuilder()
        .withId('prod-1')
        .withName('Coffee')
        .withPrice(5.0)
        .withSku('COF-001')
        .withCategory('Beverages')
        .withStock(50)
        .withDescription('Coffee')
        .build();

      const cartItems: CartItem[] = [new CartItem(product, 1)];
      const txn = Transaction.fromCartItems('txn-103', cartItems, 0.1, 0, undefined, 'cashier-1');

      expect(txn.createdBy).toBe('cashier-1');
    });
  });

  describe('Full Lifecycle', () => {
    it('should support complete transaction lifecycle: PENDING → PROCESSING → COMPLETED → REFUNDED', () => {
      const txn = new Transaction(createValidParams());

      // Start
      expect(txn.isPending()).toBe(true);

      // Process
      txn.markAsProcessing('cashier-1');
      expect(txn.isProcessing()).toBe(true);

      // Complete
      txn.markAsCompleted('cashier-1');
      expect(txn.isCompleted()).toBe(true);
      expect(txn.completedAt).toBeInstanceOf(Date);

      // Partial refund
      txn.refund(5.0, 'manager-1');
      expect(txn.isPartiallyRefunded()).toBe(true);
      expect(txn.getEffectiveTotal()).toBeCloseTo(9.3);

      // Full refund
      txn.refund(9.3, 'manager-1');
      expect(txn.isFullyRefunded()).toBe(true);
      expect(txn.getEffectiveTotal()).toBeCloseTo(0);
      expect(txn.getRefundableAmount()).toBeCloseTo(0);
    });

    it('should support cancellation lifecycle: PENDING → CANCELLED', () => {
      const txn = new Transaction(createValidParams());
      txn.cancel('Customer left', 'cashier-1');
      expect(txn.isCancelled()).toBe(true);
      expect(txn.cancellationReason).toBe('Customer left');
    });
  });
});
