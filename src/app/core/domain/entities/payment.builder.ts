import { AbstractEntityBuilder } from './abstract-entity.builder';
import { IPaymentBuilder } from './payment-builder.interface';
import { Payment, PaymentMethod, PaymentStatus } from './payment.entity';

/**
 * PaymentBuilder
 * Concrete builder for constructing Payment entities using a fluent API.
 *
 * Extends AbstractEntityBuilder for common entity fields (id, timestamps, audit)
 * and implements IPaymentBuilder for the payment-specific contract.
 *
 * Note: Payment extends BaseEntity (not SoftDeletableEntity), so deletedAt/deletedBy
 * from AbstractEntityBuilder are not passed to the Payment constructor.
 *
 * Usage:
 * ```typescript
 * const payment = new PaymentBuilder()
 *   .withOrderId('order-123')
 *   .withAmount(99.99)
 *   .withMethod(PaymentMethod.CREDIT_CARD)
 *   .withCardLast4('4242')
 *   .withCardBrand('Visa')
 *   .build();
 * ```
 */
export class PaymentBuilder
  extends AbstractEntityBuilder<Payment, PaymentBuilder>
  implements IPaymentBuilder
{
  private _orderId = 'default-order';
  private _amount = 1;
  private _method: PaymentMethod = PaymentMethod.CASH;
  private _status: PaymentStatus = PaymentStatus.PENDING;
  private _currency = 'USD';
  private _refundedAmount = 0;
  private _completedAt?: Date;
  private _failureReason?: string;
  private _transactionId?: string;
  private _cardLast4?: string;
  private _cardBrand?: string;
  private _receiptNumber?: string;

  withOrderId(orderId: string): this {
    this._orderId = orderId;
    return this;
  }

  withAmount(amount: number): this {
    this._amount = amount;
    return this;
  }

  withMethod(method: PaymentMethod): this {
    this._method = method;
    return this;
  }

  withStatus(status: PaymentStatus): this {
    this._status = status;
    return this;
  }

  withCurrency(currency: string): this {
    this._currency = currency;
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

  withFailureReason(failureReason: string): this {
    this._failureReason = failureReason;
    return this;
  }

  withTransactionId(transactionId: string): this {
    this._transactionId = transactionId;
    return this;
  }

  withCardLast4(cardLast4: string): this {
    this._cardLast4 = cardLast4;
    return this;
  }

  withCardBrand(cardBrand: string): this {
    this._cardBrand = cardBrand;
    return this;
  }

  withReceiptNumber(receiptNumber: string): this {
    this._receiptNumber = receiptNumber;
    return this;
  }

  /**
   * Builds and returns the Payment entity.
   * Delegates validation to the Payment constructor.
   */
  build(): Payment {
    return new Payment({
      id: this._id,
      orderId: this._orderId,
      amount: this._amount,
      method: this._method,
      status: this._status,
      currency: this._currency,
      refundedAmount: this._refundedAmount,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      createdBy: this._createdBy,
      updatedBy: this._updatedBy,
      completedAt: this._completedAt,
      failureReason: this._failureReason,
      transactionId: this._transactionId,
      cardLast4: this._cardLast4,
      cardBrand: this._cardBrand,
      receiptNumber: this._receiptNumber,
    });
  }
}
