import { BaseEntity, IRefundable, IProcessable } from './base.entity';

/**
 * Payment Method Enum
 */
export enum PaymentMethod {
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  DIGITAL_WALLET = 'DIGITAL_WALLET',
  GIFT_CARD = 'GIFT_CARD'
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
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED'
}

/**
 * Abstract Payment Base Class
 * Provides common payment functionality
 * Implements IRefundable and IProcessable interfaces
 * Follows Template Method pattern
 */
export abstract class AbstractPayment extends BaseEntity implements IRefundable, IProcessable {
  constructor(
    id: string,
    public readonly orderId: string,
    public readonly amount: number,
    public readonly method: PaymentMethod,
    public status: PaymentStatus = PaymentStatus.PENDING,
    public readonly currency: string = 'USD',
    public refundedAmount: number = 0,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    createdBy?: string,
    updatedBy?: string,
    public completedAt?: Date,
    public failureReason?: string
  ) {
    super(id, createdAt, updatedAt, createdBy, updatedBy);
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
    if (this.status !== PaymentStatus.COMPLETED &&
        this.status !== PaymentStatus.PARTIALLY_REFUNDED) {
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
    return this.status === PaymentStatus.COMPLETED && 
           this.refundedAmount < this.amount;
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
  override toJSON(): Record<string, any> {
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
      paymentDuration: this.getPaymentDuration()
    };
  }
}

/**
 * Payment Entity
 * Concrete implementation of AbstractPayment
 * Represents a payment transaction in the POS system
 */
export class Payment extends AbstractPayment {
  constructor(
    id: string,
    orderId: string,
    amount: number,
    method: PaymentMethod,
    status: PaymentStatus = PaymentStatus.PENDING,
    currency: string = 'USD',
    refundedAmount: number = 0,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    createdBy?: string,
    updatedBy?: string,
    completedAt?: Date,
    failureReason?: string,
    public transactionId?: string,
    public cardLast4?: string,
    public cardBrand?: string,
    public receiptNumber?: string
  ) {
    super(
      id,
      orderId,
      amount,
      method,
      status,
      currency,
      refundedAmount,
      createdAt,
      updatedAt,
      createdBy,
      updatedBy,
      completedAt,
      failureReason
    );
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
    return new Payment(
      this.id,
      this.orderId,
      this.amount,
      this.method,
      this.status,
      this.currency,
      this.refundedAmount,
      this.createdAt,
      this.updatedAt,
      this.createdBy,
      this.updatedBy,
      this.completedAt,
      this.failureReason,
      this.transactionId,
      this.cardLast4,
      this.cardBrand,
      this.receiptNumber
    );
  }

  /**
   * Converts payment to JSON with card details
   */
  override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      transactionId: this.transactionId,
      cardLast4: this.cardLast4,
      cardBrand: this.cardBrand,
      maskedCardNumber: this.getMaskedCardNumber(),
      receiptNumber: this.receiptNumber
    };
  }

  /**
   * Creates payment from plain object
   */
  static fromJSON(data: any): Payment {
    return new Payment(
      data.id,
      data.orderId,
      data.amount,
      data.method,
      data.status,
      data.currency,
      data.refundedAmount,
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.createdBy,
      data.updatedBy,
      data.completedAt ? new Date(data.completedAt) : undefined,
      data.failureReason,
      data.transactionId,
      data.cardLast4,
      data.cardBrand,
      data.receiptNumber
    );
  }
}

// Made with Bob
