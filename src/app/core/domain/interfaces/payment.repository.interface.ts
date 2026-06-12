import { IBaseRepository } from '@core/domain/interfaces/base.repository.interface';
import { Payment, PaymentStatus, PaymentMethod } from '@core/domain/entities/payment.entity';

/**
 * Payment Repository Interface
 * Extends base repository with payment-specific operations
 */
export interface IPaymentRepository extends IBaseRepository<Payment> {
  /**
   * Find payments by transaction ID
   */
  findByTransactionId(transactionId: string): Promise<Payment[]>;

  /**
   * Find payments by customer ID
   */
  findByCustomerId(customerId: string): Promise<Payment[]>;

  /**
   * Find payments by status
   */
  findByStatus(status: PaymentStatus): Promise<Payment[]>;

  /**
   * Find payments by method
   */
  findByMethod(method: PaymentMethod): Promise<Payment[]>;

  /**
   * Find payments by date range
   */
  findByDateRange(startDate: Date, endDate: Date): Promise<Payment[]>;

  /**
   * Get total payment amount for a transaction
   */
  getTotalByTransaction(transactionId: string): Promise<number>;

  /**
   * Get total payment amount for a customer
   */
  getTotalByCustomer(customerId: string): Promise<number>;

  /**
   * Get payment statistics for a date range
   */
  getStatsByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalAmount: number;
    totalCount: number;
    byMethod: Record<PaymentMethod, { count: number; amount: number }>;
    byStatus: Record<PaymentStatus, { count: number; amount: number }>;
  }>;

  /**
   * Get refunded payments
   */
  getRefundedPayments(startDate?: Date, endDate?: Date): Promise<Payment[]>;

  /**
   * Get failed payments
   */
  getFailedPayments(startDate?: Date, endDate?: Date): Promise<Payment[]>;
}

// Made with Bob
