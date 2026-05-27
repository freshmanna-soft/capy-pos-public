import { BaseEntity, IRefundable } from './base.entity';
import { Customer } from './customer.entity';
import { Payment, PaymentMethod } from './payment.entity';
import { CartItem } from './cart.entity';

/**
 * Transaction Status Enum
 */
export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED'
}

/**
 * Transaction Type Enum
 */
export enum TransactionType {
  SALE = 'SALE',
  RETURN = 'RETURN',
  EXCHANGE = 'EXCHANGE',
  VOID = 'VOID'
}

/**
 * Transaction Item Interface
 * Represents a line item in a transaction
 */
export interface ITransactionItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discount?: number;
  tax?: number;
}

/**
 * Abstract Transaction Base Class
 * Provides common transaction functionality
 * Implements IRefundable interface
 */
export abstract class AbstractTransaction extends BaseEntity implements IRefundable {
  constructor(
    id: string,
    public readonly customerId: string | undefined,
    public readonly items: ITransactionItem[],
    public readonly subtotal: number,
    public readonly taxRate: number,
    public readonly taxAmount: number,
    public readonly discountAmount: number,
    public readonly total: number,
    public status: TransactionStatus = TransactionStatus.PENDING,
    public readonly type: TransactionType = TransactionType.SALE,
    public refundedAmount: number = 0,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    createdBy?: string,
    updatedBy?: string,
    public completedAt?: Date,
    public cancelledAt?: Date,
    public cancellationReason?: string
  ) {
    super(id, createdAt, updatedAt, createdBy, updatedBy);
  }

  /**
   * Validates transaction data
   */
  protected validate(): void {
    if (!this.items || this.items.length === 0) {
      throw new Error('Transaction must have at least one item');
    }
    if (this.subtotal < 0) {
      throw new Error('Subtotal cannot be negative');
    }
    if (this.taxRate < 0 || this.taxRate > 1) {
      throw new Error('Tax rate must be between 0 and 1');
    }
    if (this.taxAmount < 0) {
      throw new Error('Tax amount cannot be negative');
    }
    if (this.discountAmount < 0) {
      throw new Error('Discount amount cannot be negative');
    }
    if (this.total < 0) {
      throw new Error('Total cannot be negative');
    }
    if (this.refundedAmount < 0) {
      throw new Error('Refunded amount cannot be negative');
    }
    if (this.refundedAmount > this.total) {
      throw new Error('Refunded amount cannot exceed total');
    }
  }

  /**
   * Marks transaction as processing
   */
  markAsProcessing(updatedBy?: string): void {
    if (this.status !== TransactionStatus.PENDING) {
      throw new Error('Can only process pending transactions');
    }
    this.status = TransactionStatus.PROCESSING;
    this.touch(updatedBy);
  }

  /**
   * Marks transaction as completed
   */
  markAsCompleted(updatedBy?: string): void {
    if (this.status !== TransactionStatus.PROCESSING) {
      throw new Error('Can only complete processing transactions');
    }
    this.status = TransactionStatus.COMPLETED;
    this.completedAt = new Date();
    this.touch(updatedBy);
  }

  /**
   * Cancels the transaction
   */
  cancel(reason: string, updatedBy?: string): void {
    if (this.status === TransactionStatus.COMPLETED) {
      throw new Error('Cannot cancel a completed transaction. Use refund instead.');
    }
    if (this.status === TransactionStatus.CANCELLED) {
      throw new Error('Transaction is already cancelled');
    }
    this.status = TransactionStatus.CANCELLED;
    this.cancelledAt = new Date();
    this.cancellationReason = reason;
    this.touch(updatedBy);
  }

  /**
   * Processes a refund
   * Implements IRefundable interface
   */
  refund(amount: number, updatedBy?: string): void {
    if (this.status !== TransactionStatus.COMPLETED &&
        this.status !== TransactionStatus.PARTIALLY_REFUNDED) {
      throw new Error('Can only refund completed transactions');
    }
    if (amount <= 0) {
      throw new Error('Refund amount must be greater than 0');
    }
    if (this.refundedAmount + amount > this.total) {
      throw new Error('Total refund amount cannot exceed transaction total');
    }

    this.refundedAmount += amount;
    
    if (this.refundedAmount === this.total) {
      this.status = TransactionStatus.REFUNDED;
    } else {
      this.status = TransactionStatus.PARTIALLY_REFUNDED;
    }
    
    this.touch(updatedBy);
  }

  /**
   * Gets remaining refundable amount
   * Implements IRefundable interface
   */
  getRefundableAmount(): number {
    return this.total - this.refundedAmount;
  }

  /**
   * Checks if transaction is refundable
   * Implements IRefundable interface
   */
  isRefundable(): boolean {
    return this.status === TransactionStatus.COMPLETED && 
           this.refundedAmount < this.total;
  }

  /**
   * Checks if transaction is pending
   */
  isPending(): boolean {
    return this.status === TransactionStatus.PENDING;
  }

  /**
   * Checks if transaction is processing
   */
  isProcessing(): boolean {
    return this.status === TransactionStatus.PROCESSING;
  }

  /**
   * Checks if transaction is completed
   */
  isCompleted(): boolean {
    return this.status === TransactionStatus.COMPLETED;
  }

  /**
   * Checks if transaction is cancelled
   */
  isCancelled(): boolean {
    return this.status === TransactionStatus.CANCELLED;
  }

  /**
   * Checks if transaction is fully refunded
   */
  isFullyRefunded(): boolean {
    return this.status === TransactionStatus.REFUNDED;
  }

  /**
   * Checks if transaction is partially refunded
   */
  isPartiallyRefunded(): boolean {
    return this.status === TransactionStatus.PARTIALLY_REFUNDED;
  }

  /**
   * Gets total number of items in transaction
   */
  getTotalItems(): number {
    return this.items.reduce((total, item) => total + item.quantity, 0);
  }

  /**
   * Gets transaction duration in milliseconds
   */
  getTransactionDuration(): number | undefined {
    if (!this.completedAt) return undefined;
    return this.completedAt.getTime() - this.createdAt.getTime();
  }

  /**
   * Calculates effective total after refunds
   */
  getEffectiveTotal(): number {
    return this.total - this.refundedAmount;
  }

  /**
   * Converts transaction to JSON
   */
  override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      customerId: this.customerId,
      items: this.items,
      subtotal: this.subtotal,
      taxRate: this.taxRate,
      taxAmount: this.taxAmount,
      discountAmount: this.discountAmount,
      total: this.total,
      status: this.status,
      type: this.type,
      refundedAmount: this.refundedAmount,
      refundableAmount: this.getRefundableAmount(),
      effectiveTotal: this.getEffectiveTotal(),
      totalItems: this.getTotalItems(),
      completedAt: this.completedAt?.toISOString(),
      cancelledAt: this.cancelledAt?.toISOString(),
      cancellationReason: this.cancellationReason,
      transactionDuration: this.getTransactionDuration()
    };
  }
}

/**
 * Transaction Entity
 * Concrete implementation of AbstractTransaction
 * Represents a complete sales transaction in the POS system
 */
export class Transaction extends AbstractTransaction {
  constructor(
    id: string,
    customerId: string | undefined,
    items: ITransactionItem[],
    subtotal: number,
    taxRate: number,
    taxAmount: number,
    discountAmount: number,
    total: number,
    status: TransactionStatus = TransactionStatus.PENDING,
    type: TransactionType = TransactionType.SALE,
    refundedAmount: number = 0,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    createdBy?: string,
    updatedBy?: string,
    completedAt?: Date,
    cancelledAt?: Date,
    cancellationReason?: string,
    public paymentIds: string[] = [],
    public receiptNumber?: string,
    public notes?: string,
    public customer?: Customer
  ) {
    super(
      id,
      customerId,
      items,
      subtotal,
      taxRate,
      taxAmount,
      discountAmount,
      total,
      status,
      type,
      refundedAmount,
      createdAt,
      updatedAt,
      createdBy,
      updatedBy,
      completedAt,
      cancelledAt,
      cancellationReason
    );
    this.validate();
  }

  /**
   * Adds a payment to the transaction
   */
  addPayment(paymentId: string, updatedBy?: string): void {
    if (this.paymentIds.includes(paymentId)) {
      throw new Error('Payment already added to transaction');
    }
    this.paymentIds.push(paymentId);
    this.touch(updatedBy);
  }

  /**
   * Removes a payment from the transaction
   */
  removePayment(paymentId: string, updatedBy?: string): void {
    const index = this.paymentIds.indexOf(paymentId);
    if (index === -1) {
      throw new Error('Payment not found in transaction');
    }
    this.paymentIds.splice(index, 1);
    this.touch(updatedBy);
  }

  /**
   * Checks if transaction has payments
   */
  hasPayments(): boolean {
    return this.paymentIds.length > 0;
  }

  /**
   * Gets number of payments
   */
  getPaymentCount(): number {
    return this.paymentIds.length;
  }

  /**
   * Marks transaction as completed with receipt
   */
  markAsCompletedWithReceipt(receiptNumber: string, updatedBy?: string): void {
    this.markAsCompleted(updatedBy);
    this.receiptNumber = receiptNumber;
  }

  /**
   * Adds notes to the transaction
   */
  addNotes(notes: string, updatedBy?: string): void {
    this.notes = notes;
    this.touch(updatedBy);
  }

  /**
   * Checks if transaction has customer
   */
  hasCustomer(): boolean {
    return this.customerId !== undefined;
  }

  /**
   * Gets item by product ID
   */
  getItem(productId: string): ITransactionItem | undefined {
    return this.items.find(item => item.productId === productId);
  }

  /**
   * Checks if transaction contains a specific product
   */
  hasProduct(productId: string): boolean {
    return this.items.some(item => item.productId === productId);
  }

  /**
   * Creates a copy of the transaction
   */
  override clone(): Transaction {
    return new Transaction(
      this.id,
      this.customerId,
      [...this.items],
      this.subtotal,
      this.taxRate,
      this.taxAmount,
      this.discountAmount,
      this.total,
      this.status,
      this.type,
      this.refundedAmount,
      this.createdAt,
      this.updatedAt,
      this.createdBy,
      this.updatedBy,
      this.completedAt,
      this.cancelledAt,
      this.cancellationReason,
      [...this.paymentIds],
      this.receiptNumber,
      this.notes,
      this.customer
    );
  }

  /**
   * Converts transaction to JSON with additional fields
   */
  override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      paymentIds: this.paymentIds,
      paymentCount: this.getPaymentCount(),
      receiptNumber: this.receiptNumber,
      notes: this.notes,
      hasCustomer: this.hasCustomer(),
      customer: this.customer?.toJSON()
    };
  }

  /**
   * Creates transaction from plain object
   */
  static fromJSON(data: any): Transaction {
    return new Transaction(
      data.id,
      data.customerId,
      data.items,
      data.subtotal,
      data.taxRate,
      data.taxAmount,
      data.discountAmount,
      data.total,
      data.status,
      data.type,
      data.refundedAmount,
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.createdBy,
      data.updatedBy,
      data.completedAt ? new Date(data.completedAt) : undefined,
      data.cancelledAt ? new Date(data.cancelledAt) : undefined,
      data.cancellationReason,
      data.paymentIds || [],
      data.receiptNumber,
      data.notes,
      data.customer ? Customer.fromJSON(data.customer) : undefined
    );
  }

  /**
   * Creates a transaction from cart items
   */
  static fromCartItems(
    id: string,
    cartItems: CartItem[],
    taxRate: number,
    discountAmount: number = 0,
    customerId?: string,
    createdBy?: string
  ): Transaction {
    const items: ITransactionItem[] = cartItems.map(item => ({
      productId: item.product.id,
      productName: item.product.name,
      quantity: item.quantity,
      unitPrice: item.product.price,
      subtotal: item.getSubtotal()
    }));

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = (subtotal - discountAmount) * taxRate;
    const total = subtotal - discountAmount + taxAmount;

    return new Transaction(
      id,
      customerId,
      items,
      subtotal,
      taxRate,
      taxAmount,
      discountAmount,
      total,
      TransactionStatus.PENDING,
      TransactionType.SALE,
      0,
      new Date(),
      new Date(),
      createdBy
    );
  }
}

// Made with Bob