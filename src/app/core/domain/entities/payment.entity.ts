import { BaseEntity, IRefundable, IProcessable } from '@core/domain/entities/base.entity';

/**
 * Payment Method Enum
 */
export enum PaymentMethod {
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  DIGITAL_WALLET = 'DIGITAL_WALLET',
  GIFT_CARD = 'GIFT_CARD',
}

/**
 * Payment Status Enum
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

/**
 * Props for constructing an AbstractPayment
 */
export interface AbstractPaymentProps {
  id: string;
  orderId: string;
  amount: number;
  method: PaymentMethod;
  status?: PaymentStatus;
  currency?: string;
  refundedAmount?: number;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
  updatedBy?: string;
  completedAt?: Date;
  failureReason?: string;
}

/**
 * Props for constructing a Payment entity
 * Extends AbstractPaymentProps with card/transaction details
 */
export interface PaymentProps extends AbstractPaymentProps {
  transactionId?: string;
  cardLast4?: string;
  cardBrand?: string;
  receiptNumber?: string;
}

/**
 * Abstract Payment Base Class
 * Provides common payment functionality
 * Implements IRefundable and IProcessable interfaces
 * Follows Template Method pattern
 */
export abstract class AbstractPayment extends BaseEntity implements IRefundable, IProcessable {
  public readonly orderId: string;
  public readonly amount: number;
  public readonly method: PaymentMethod;
  public status: PaymentStatus;
  public readonly currency: string;
  public refundedAmount: number;
  public completedAt?: Date;
  public failureReason?: string;

  constructor(props: AbstractPaymentProps) {
    super(
      props.id,
      props.createdAt ?? new Date(),
      props.updatedAt ?? new Date(),
      props.createdBy,
      props.updatedBy
    );
    this.orderId = props.orderId;
    this.amount = props.amount;
    this.method = props.method;
    this.status = props.status ?? PaymentStatus.PENDING;
    this.currency = props.currency ?? 'USD';
    this.refundedAmount = props.refundedAmount ?? 0;
    this.completedAt = props.completedAt;
    this.failureReason = props.failureReason;
  }

  /**
   * Validates payment data
   * Implements abstract method from BaseEntity
   */
  protected validate(): void {
    if (!this.orderId || this.orderId.trim() === '') {
      throw new Error('Order ID is required');
    }
    if (this.amount <= 0) {
      throw new Error('Payment amount must be greater than 0');
    }
    if (this.refundedAmount < 0) {
      throw new Error('Refunded amount cannot be negative');
    }
    if (this.refundedAmount > this.amount) {
      throw new Error('Refunded amount cannot exceed payment amount');
    }
  }

  /**
   * Marks payment as processing
   * Implements IProcessable interface
   */
  markAsProcessing(updatedBy?: string): void {
    if (this.status !== PaymentStatus.PENDING) {
      throw new Error('Can only process pending payments');
    }
    this.status = PaymentStatus.PROCESSING;
    this.touch(updatedBy);
  }

  /**
   * Marks payment as completed
   * Implements IProcessable interface
   */
  markAsCompleted(updatedBy?: string): void {
    if (this.status !== PaymentStatus.PROCESSING) {
      throw new Error('Can only complete processing payments');
    }
    this.status = PaymentStatus.COMPLETED;
    this.completedAt = new Date();
    this.touch(updatedBy);
  }

  /**
   * Marks payment as failed
   * Implements IProcessable interface
   */
  markAsFailed(reason: string, updatedBy?: string): void {
    if (this.status === PaymentStatus.COMPLETED) {
      throw new Error('Cannot fail a completed payment');
    }
    this.status = PaymentStatus.FAILED;
    this.failureReason = reason;
    this.touch(updatedBy);
  }

  /**
   * Checks if payment is completed
   * Implements IProcessable interface
   */
  isCompleted(): boolean {
    return this.status === PaymentStatus.COMPLETED;
  }

  /**
   * Processes a refund
   * Implements IRefundable interface
   */
  refund(amount: number, updatedBy?: string): void {
    if (
      this.status !== PaymentStatus.COMPLETED &&
      this.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new Error('Can only refund completed payments');
    }
    if (amount <= 0) {
      throw new Error('Refund amount must be greater than 0');
    }
    if (this.refundedAmount + amount > this.amount) {
      throw new Error('Total refund amount cannot exceed payment amount');
    }

    this.refundedAmount += amount;

    if (this.refundedAmount === this.amount) {
      this.status = PaymentStatus.REFUNDED;
    } else {
      this.status = PaymentStatus.PARTIALLY_REFUNDED;
    }

    this.touch(updatedBy);
  }

  /**
   * Gets remaining refundable amount
   * Implements IRefundable interface
   */
  getRefundableAmount(): number {
    return this.amount - this.refundedAmount;
  }

  /**
   * Checks if payment is refundable
   * Implements IRefundable interface
   */
  isRefundable(): boolean {
    return this.status === PaymentStatus.COMPLETED && this.refundedAmount < this.amount;
  }

  /**
   * Checks if payment is pending
   */
  isPending(): boolean {
    return this.status === PaymentStatus.PENDING;
  }

  /**
   * Checks if payment is processing
   */
  isProcessing(): boolean {
    return this.status === PaymentStatus.PROCESSING;
  }

  /**
   * Checks if payment failed
   */
  isFailed(): boolean {
    return this.status === PaymentStatus.FAILED;
  }

  /**
   * Checks if payment is fully refunded
   */
  isFullyRefunded(): boolean {
    return this.status === PaymentStatus.REFUNDED;
  }

  /**
   * Checks if payment is partially refunded
   */
  isPartiallyRefunded(): boolean {
    return this.status === PaymentStatus.PARTIALLY_REFUNDED;
  }

  /**
   * Gets payment duration in milliseconds
   */
  getPaymentDuration(): number | undefined {
    if (!this.completedAt) return undefined;
    return this.completedAt.getTime() - this.createdAt.getTime();
  }

  /**
   * Converts payment to JSON
   */
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      orderId: this.orderId,
      amount: this.amount,
      method: this.method,
      status: this.status,
      currency: this.currency,
      refundedAmount: this.refundedAmount,
      refundableAmount: this.getRefundableAmount(),
      completedAt: this.completedAt?.toISOString(),
      failureReason: this.failureReason,
      paymentDuration: this.getPaymentDuration(),
    };
  }
}

/**
 * Payment Entity
 * Concrete implementation of AbstractPayment
 * Represents a payment transaction in the POS system
 */
export class Payment extends AbstractPayment {
  public transactionId?: string;
  public cardLast4?: string;
  public cardBrand?: string;
  public receiptNumber?: string;

  constructor(props: PaymentProps) {
    super(props);
    this.transactionId = props.transactionId;
    this.cardLast4 = props.cardLast4;
    this.cardBrand = props.cardBrand;
    this.receiptNumber = props.receiptNumber;
    this.validate();
  }

  /**
   * Marks payment as processing with transaction ID
   */
  markAsProcessingWithTransaction(transactionId: string, updatedBy?: string): void {
    this.markAsProcessing(updatedBy);
    this.transactionId = transactionId;
  }

  /**
   * Marks payment as completed with receipt
   */
  markAsCompletedWithReceipt(receiptNumber?: string, updatedBy?: string): void {
    this.markAsCompleted(updatedBy);
    if (receiptNumber) {
      this.receiptNumber = receiptNumber;
    }
  }

  /**
   * Gets masked card number for display
   */
  getMaskedCardNumber(): string | undefined {
    if (!this.cardLast4) return undefined;
    return `**** **** **** ${this.cardLast4}`;
  }

  /**
   * Creates a copy of the payment
   */
  override clone(): Payment {
    return new Payment({
      id: this.id,
      orderId: this.orderId,
      amount: this.amount,
      method: this.method,
      status: this.status,
      currency: this.currency,
      refundedAmount: this.refundedAmount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
      completedAt: this.completedAt,
      failureReason: this.failureReason,
      transactionId: this.transactionId,
      cardLast4: this.cardLast4,
      cardBrand: this.cardBrand,
      receiptNumber: this.receiptNumber,
    });
  }

  /**
   * Converts payment to JSON with card details
   */
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      transactionId: this.transactionId,
      cardLast4: this.cardLast4,
      cardBrand: this.cardBrand,
      maskedCardNumber: this.getMaskedCardNumber(),
      receiptNumber: this.receiptNumber,
    };
  }

  /**
   * Creates payment from plain object
   */
  static fromJSON(data: Record<string, unknown>): Payment {
    return new Payment({
      id: data['id'] as string,
      orderId: data['orderId'] as string,
      amount: data['amount'] as number,
      method: data['method'] as PaymentMethod,
      status: data['status'] as PaymentStatus,
      currency: data['currency'] as string,
      refundedAmount: data['refundedAmount'] as number,
      createdAt: new Date(data['createdAt'] as string),
      updatedAt: new Date(data['updatedAt'] as string),
      createdBy: data['createdBy'] as string | undefined,
      updatedBy: data['updatedBy'] as string | undefined,
      completedAt: data['completedAt'] ? new Date(data['completedAt'] as string) : undefined,
      failureReason: data['failureReason'] as string | undefined,
      transactionId: data['transactionId'] as string | undefined,
      cardLast4: data['cardLast4'] as string | undefined,
      cardBrand: data['cardBrand'] as string | undefined,
      receiptNumber: data['receiptNumber'] as string | undefined,
    });
  }
}

// Made with Bob
