import { IBuilder } from './builder.interface';
import { Payment, PaymentMethod, PaymentStatus } from './payment.entity';

/**
 * IPaymentBuilder Interface
 * Defines the contract for building Payment entities.
 * Extends IBuilder<Payment> with payment-specific fluent methods.
 *
 * This allows consumers to depend on the interface rather than
 * the concrete PaymentBuilder, enabling substitution and testing.
 */
export interface IPaymentBuilder extends IBuilder<Payment> {
  // Identity & audit (inherited concept from AbstractEntityBuilder)
  withId(id: string): IPaymentBuilder;
  withCreatedAt(createdAt: Date): IPaymentBuilder;
  withUpdatedAt(updatedAt: Date): IPaymentBuilder;
  withCreatedBy(createdBy: string): IPaymentBuilder;
  withUpdatedBy(updatedBy: string): IPaymentBuilder;

  // Payment-specific fields
  withOrderId(orderId: string): IPaymentBuilder;
  withAmount(amount: number): IPaymentBuilder;
  withMethod(method: PaymentMethod): IPaymentBuilder;
  withStatus(status: PaymentStatus): IPaymentBuilder;
  withCurrency(currency: string): IPaymentBuilder;
  withRefundedAmount(refundedAmount: number): IPaymentBuilder;
  withCompletedAt(completedAt: Date): IPaymentBuilder;
  withFailureReason(failureReason: string): IPaymentBuilder;
  withTransactionId(transactionId: string): IPaymentBuilder;
  withCardLast4(cardLast4: string): IPaymentBuilder;
  withCardBrand(cardBrand: string): IPaymentBuilder;
  withReceiptNumber(receiptNumber: string): IPaymentBuilder;
}
