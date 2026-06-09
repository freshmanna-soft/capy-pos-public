import { describe, it, expect } from 'vitest';
import { TransactionBuilder } from './transaction.builder';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
  ITransactionItem,
} from './transaction.entity';
import { CustomerStatus, CustomerTier } from './customer.entity';
import { CustomerBuilder } from './customer.builder';

describe('TransactionBuilder', () => {
  const sampleItems: ITransactionItem[] = [
    { productId: 'p1', productName: 'Widget', quantity: 2, unitPrice: 10, subtotal: 20 },
    { productId: 'p2', productName: 'Gadget', quantity: 1, unitPrice: 15, subtotal: 15 },
  ];

  it('should build a valid Transaction with defaults', () => {
    const transaction = new TransactionBuilder().build();

    expect(transaction).toBeInstanceOf(Transaction);
    expect(transaction.id).toBeDefined();
    expect(transaction.status).toBe(TransactionStatus.PENDING);
    expect(transaction.type).toBe(TransactionType.SALE);
    expect(transaction.items.length).toBe(1);
    expect(transaction.refundedAmount).toBe(0);
    expect(transaction.paymentIds).toEqual([]);
  });

  it('should set id via withId', () => {
    const transaction = new TransactionBuilder().withId('txn-123').build();

    expect(transaction.id).toBe('txn-123');
  });

  it('should set customerId via withCustomerId', () => {
    const transaction = new TransactionBuilder().withCustomerId('cust-1').build();

    expect(transaction.customerId).toBe('cust-1');
  });

  it('should set items via withItems', () => {
    const transaction = new TransactionBuilder()
      .withItems(sampleItems)
      .withSubtotal(35)
      .withTaxAmount(2.8)
      .withTotal(37.8)
      .build();

    expect(transaction.items).toEqual(sampleItems);
    expect(transaction.items.length).toBe(2);
  });

  it('should set financial fields', () => {
    const transaction = new TransactionBuilder()
      .withSubtotal(100)
      .withTaxRate(0.1)
      .withTaxAmount(10)
      .withDiscountAmount(5)
      .withTotal(105)
      .build();

    expect(transaction.subtotal).toBe(100);
    expect(transaction.taxRate).toBe(0.1);
    expect(transaction.taxAmount).toBe(10);
    expect(transaction.discountAmount).toBe(5);
    expect(transaction.total).toBe(105);
  });

  it('should set status and type', () => {
    const transaction = new TransactionBuilder()
      .withStatus(TransactionStatus.COMPLETED)
      .withType(TransactionType.RETURN)
      .build();

    expect(transaction.status).toBe(TransactionStatus.COMPLETED);
    expect(transaction.type).toBe(TransactionType.RETURN);
  });

  it('should set refundedAmount', () => {
    const transaction = new TransactionBuilder().withRefundedAmount(5).build();

    expect(transaction.refundedAmount).toBe(5);
  });

  it('should set date fields', () => {
    const created = new Date('2025-01-01');
    const updated = new Date('2025-01-02');
    const completed = new Date('2025-01-03');
    const cancelled = new Date('2025-01-04');

    const transaction = new TransactionBuilder()
      .withCreatedAt(created)
      .withUpdatedAt(updated)
      .withCompletedAt(completed)
      .withCancelledAt(cancelled)
      .build();

    expect(transaction.createdAt).toBe(created);
    expect(transaction.updatedAt).toBe(updated);
    expect(transaction.completedAt).toBe(completed);
    expect(transaction.cancelledAt).toBe(cancelled);
  });

  it('should set audit fields', () => {
    const transaction = new TransactionBuilder()
      .withCreatedBy('admin')
      .withUpdatedBy('manager')
      .build();

    expect(transaction.createdBy).toBe('admin');
    expect(transaction.updatedBy).toBe('manager');
  });

  it('should set cancellation reason', () => {
    const transaction = new TransactionBuilder()
      .withCancellationReason('Customer changed mind')
      .build();

    expect(transaction.cancellationReason).toBe('Customer changed mind');
  });

  it('should set paymentIds', () => {
    const transaction = new TransactionBuilder().withPaymentIds(['pay-1', 'pay-2']).build();

    expect(transaction.paymentIds).toEqual(['pay-1', 'pay-2']);
  });

  it('should set receiptNumber', () => {
    const transaction = new TransactionBuilder().withReceiptNumber('REC-001').build();

    expect(transaction.receiptNumber).toBe('REC-001');
  });

  it('should set notes', () => {
    const transaction = new TransactionBuilder().withNotes('Rush order').build();

    expect(transaction.notes).toBe('Rush order');
  });

  it('should set customer', () => {
    const customer = new CustomerBuilder()
      .withId('cust-1')
      .withName('John Doe')
      .withEmail('john@example.com')
      .withPhone('+1234567890')
      .withStatus(CustomerStatus.ACTIVE)
      .withLoyaltyPoints(100)
      .withTier(CustomerTier.SILVER)
      .build();

    const transaction = new TransactionBuilder().withCustomer(customer).build();

    expect(transaction.customer).toBe(customer);
  });

  it('should support fluent chaining for all methods', () => {
    const transaction = new TransactionBuilder()
      .withId('txn-fluent')
      .withCustomerId('cust-1')
      .withItems(sampleItems)
      .withSubtotal(35)
      .withTaxRate(0.08)
      .withTaxAmount(2.8)
      .withDiscountAmount(0)
      .withTotal(37.8)
      .withStatus(TransactionStatus.COMPLETED)
      .withType(TransactionType.SALE)
      .withRefundedAmount(0)
      .withPaymentIds(['pay-1'])
      .withReceiptNumber('REC-100')
      .withNotes('Test transaction')
      .withCreatedBy('cashier')
      .build();

    expect(transaction.id).toBe('txn-fluent');
    expect(transaction.customerId).toBe('cust-1');
    expect(transaction.items).toEqual(sampleItems);
    expect(transaction.subtotal).toBe(35);
    expect(transaction.total).toBe(37.8);
    expect(transaction.status).toBe(TransactionStatus.COMPLETED);
    expect(transaction.paymentIds).toEqual(['pay-1']);
    expect(transaction.receiptNumber).toBe('REC-100');
    expect(transaction.notes).toBe('Test transaction');
    expect(transaction.createdBy).toBe('cashier');
  });

  it('should create independent instances', () => {
    const builder = new TransactionBuilder().withId('txn-shared');
    const txn1 = builder.build();
    const txn2 = builder.withId('txn-other').build();

    expect(txn1.id).toBe('txn-shared');
    expect(txn2.id).toBe('txn-other');
  });
});
