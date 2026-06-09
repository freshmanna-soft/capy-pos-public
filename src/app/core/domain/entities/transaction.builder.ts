import { AbstractEntityBuilder } from './abstract-entity.builder';
import { Customer } from './customer.entity';
import { ITransactionBuilder } from './transaction-builder.interface';
import {
  ITransactionItem,
  Transaction,
  TransactionStatus,
  TransactionType,
} from './transaction.entity';

/**
 * TransactionBuilder
 * Concrete builder for creating Transaction entities with a fluent API.
 * Extends AbstractEntityBuilder for common entity fields (id, createdAt, etc.)
 * Implements ITransactionBuilder for type-safe contract.
 *
 * Usage:
 * ```typescript
 * const transaction = new TransactionBuilder()
 *   .withId('txn-1')
 *   .withItems([{ productId: 'p1', productName: 'Item', quantity: 2, unitPrice: 10, subtotal: 20 }])
 *   .withSubtotal(20)
 *   .withTaxRate(0.08)
 *   .withTaxAmount(1.60)
 *   .withTotal(21.60)
 *   .withStatus(TransactionStatus.COMPLETED)
 *   .build();
 * ```
 */
export class TransactionBuilder
  extends AbstractEntityBuilder<Transaction, TransactionBuilder>
  implements ITransactionBuilder
{
  private _customerId?: string;
  private _items: ITransactionItem[] = [
    {
      productId: 'default-product',
      productName: 'Default Item',
      quantity: 1,
      unitPrice: 10,
      subtotal: 10,
    },
  ];
  private _subtotal = 10;
  private _taxRate = 0.08;
  private _taxAmount = 0.8;
  private _discountAmount = 0;
  private _total = 10.8;
  private _status: TransactionStatus = TransactionStatus.PENDING;
  private _type: TransactionType = TransactionType.SALE;
  private _refundedAmount = 0;
  private _completedAt?: Date;
  private _cancelledAt?: Date;
  private _cancellationReason?: string;
  private _paymentIds: string[] = [];
  private _receiptNumber?: string;
  private _notes?: string;
  private _customer?: Customer;

  withCustomerId(customerId: string): this {
    this._customerId = customerId;
    return this;
  }

  withItems(items: ITransactionItem[]): this {
    this._items = items;
    return this;
  }

  withSubtotal(subtotal: number): this {
    this._subtotal = subtotal;
    return this;
  }

  withTaxRate(taxRate: number): this {
    this._taxRate = taxRate;
    return this;
  }

  withTaxAmount(taxAmount: number): this {
    this._taxAmount = taxAmount;
    return this;
  }

  withDiscountAmount(discountAmount: number): this {
    this._discountAmount = discountAmount;
    return this;
  }

  withTotal(total: number): this {
    this._total = total;
    return this;
  }

  withStatus(status: TransactionStatus): this {
    this._status = status;
    return this;
  }

  withType(type: TransactionType): this {
    this._type = type;
    return this;
  }

  withRefundedAmount(refundedAmount: number): this {
    this._refundedAmount = refundedAmount;
    return this;
  }

  withCompletedAt(completedAt: Date): this {
    this._completedAt = completedAt;
    return this;
  }

  withCancelledAt(cancelledAt: Date): this {
    this._cancelledAt = cancelledAt;
    return this;
  }

  withCancellationReason(reason: string): this {
    this._cancellationReason = reason;
    return this;
  }

  withPaymentIds(paymentIds: string[]): this {
    this._paymentIds = paymentIds;
    return this;
  }

  withReceiptNumber(receiptNumber: string): this {
    this._receiptNumber = receiptNumber;
    return this;
  }

  withNotes(notes: string): this {
    this._notes = notes;
    return this;
  }

  withCustomer(customer: Customer): this {
    this._customer = customer;
    return this;
  }

  build(): Transaction {
    return new Transaction({
      id: this._id,
      customerId: this._customerId,
      items: this._items,
      subtotal: this._subtotal,
      taxRate: this._taxRate,
      taxAmount: this._taxAmount,
      discountAmount: this._discountAmount,
      total: this._total,
      status: this._status,
      type: this._type,
      refundedAmount: this._refundedAmount,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      createdBy: this._createdBy,
      updatedBy: this._updatedBy,
      completedAt: this._completedAt,
      cancelledAt: this._cancelledAt,
      cancellationReason: this._cancellationReason,
      paymentIds: this._paymentIds,
      receiptNumber: this._receiptNumber,
      notes: this._notes,
      customer: this._customer,
    });
  }
}
