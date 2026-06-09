import { IBuilder } from './builder.interface';
import { Customer } from './customer.entity';
import {
  ITransactionItem,
  Transaction,
  TransactionStatus,
  TransactionType,
} from './transaction.entity';

/**
 * ITransactionBuilder Interface
 * Defines the contract for building Transaction entities.
 * Extends IBuilder<Transaction> with transaction-specific fluent methods.
 *
 * This allows consumers to depend on the interface rather than
 * the concrete TransactionBuilder, enabling substitution and testing.
 */
export interface ITransactionBuilder extends IBuilder<Transaction> {
  // Identity & audit (inherited concept from AbstractEntityBuilder)
  withId(id: string): ITransactionBuilder;
  withCreatedAt(createdAt: Date): ITransactionBuilder;
  withUpdatedAt(updatedAt: Date): ITransactionBuilder;
  withCreatedBy(createdBy: string): ITransactionBuilder;
  withUpdatedBy(updatedBy: string): ITransactionBuilder;

  // Transaction-specific fields
  withCustomerId(customerId: string): ITransactionBuilder;
  withItems(items: ITransactionItem[]): ITransactionBuilder;
  withSubtotal(subtotal: number): ITransactionBuilder;
  withTaxRate(taxRate: number): ITransactionBuilder;
  withTaxAmount(taxAmount: number): ITransactionBuilder;
  withDiscountAmount(discountAmount: number): ITransactionBuilder;
  withTotal(total: number): ITransactionBuilder;
  withStatus(status: TransactionStatus): ITransactionBuilder;
  withType(type: TransactionType): ITransactionBuilder;
  withRefundedAmount(refundedAmount: number): ITransactionBuilder;
  withCompletedAt(completedAt: Date): ITransactionBuilder;
  withCancelledAt(cancelledAt: Date): ITransactionBuilder;
  withCancellationReason(reason: string): ITransactionBuilder;
  withPaymentIds(paymentIds: string[]): ITransactionBuilder;
  withReceiptNumber(receiptNumber: string): ITransactionBuilder;
  withNotes(notes: string): ITransactionBuilder;
  withCustomer(customer: Customer): ITransactionBuilder;
}
