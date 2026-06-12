import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@core/domain/entities/transaction.entity';
import { IBaseRepository } from '@core/domain/interfaces/base.repository.interface';

/**
 * Transaction Repository Interface
 *
 * Extends base repository with transaction-specific operations.
 * Follows Interface Segregation Principle (SOLID).
 * Enables easy switching between SQLite and API implementations.
 *
 * @interface ITransactionRepository
 * @extends IBaseRepository<Transaction>
 */
export interface ITransactionRepository extends IBaseRepository<Transaction> {
  /**
   * Find transactions by customer ID
   * @param customerId - Customer identifier
   * @returns Promise resolving to array of transactions
   */
  findByCustomerId(customerId: string): Promise<Transaction[]>;

  /**
   * Find transactions by status
   * @param status - Transaction status
   * @returns Promise resolving to array of transactions
   */
  findByStatus(status: TransactionStatus): Promise<Transaction[]>;

  /**
   * Find transactions by type
   * @param type - Transaction type
   * @returns Promise resolving to array of transactions
   */
  findByType(type: TransactionType): Promise<Transaction[]>;

  /**
   * Find transactions by date range
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Promise resolving to array of transactions
   */
  findByDateRange(startDate: Date, endDate: Date): Promise<Transaction[]>;

  /**
   * Find transactions by receipt number
   * @param receiptNumber - Receipt number
   * @returns Promise resolving to transaction or null
   */
  findByReceiptNumber(receiptNumber: string): Promise<Transaction | null>;

  /**
   * Get total sales for a date range
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Promise resolving to total sales amount
   */
  getTotalSales(startDate: Date, endDate: Date): Promise<number>;

  /**
   * Get transaction count for a date range
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Promise resolving to transaction count
   */
  getTransactionCount(startDate: Date, endDate: Date): Promise<number>;

  /**
   * Get average transaction value for a date range
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Promise resolving to average transaction value
   */
  getAverageTransactionValue(startDate: Date, endDate: Date): Promise<number>;

  /**
   * Get top selling products for a date range
   * @param startDate - Start date
   * @param endDate - End date
   * @param limit - Maximum number of products to return
   * @returns Promise resolving to array of product sales data
   */
  getTopProducts(
    startDate: Date,
    endDate: Date,
    limit: number
  ): Promise<
    {
      productId: string;
      productName: string;
      quantitySold: number;
      revenue: number;
      transactionCount: number;
    }[]
  >;

  /**
   * Get sales by hour for a specific date
   * @param date - Date to analyze
   * @returns Promise resolving to hourly sales breakdown
   */
  getSalesByHour(date: Date): Promise<
    {
      hour: number;
      sales: number;
      transactions: number;
    }[]
  >;

  /**
   * Get refund statistics for a date range
   * @param startDate - Start date
   * @param endDate - End date
   * @returns Promise resolving to refund statistics
   */
  getRefundStats(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalRefunds: number;
    refundCount: number;
    refundRate: number;
  }>;

  /**
   * Find completed transactions
   * @param limit - Maximum number of transactions to return
   * @returns Promise resolving to array of completed transactions
   */
  findCompleted(limit?: number): Promise<Transaction[]>;

  /**
   * Find pending transactions
   * @returns Promise resolving to array of pending transactions
   */
  findPending(): Promise<Transaction[]>;

  /**
   * Update transaction status
   * @param transactionId - Transaction ID
   * @param status - New status
   * @param updatedBy - User who updated the transaction
   * @returns Promise resolving to updated transaction
   */
  updateStatus(
    transactionId: string,
    status: TransactionStatus,
    updatedBy?: string
  ): Promise<Transaction>;

  /**
   * Add payment to transaction
   * @param transactionId - Transaction ID
   * @param paymentId - Payment ID to add
   * @param updatedBy - User who updated the transaction
   * @returns Promise resolving to updated transaction
   */
  addPayment(transactionId: string, paymentId: string, updatedBy?: string): Promise<Transaction>;

  /**
   * Search transactions by product
   * @param productId - Product ID
   * @param startDate - Optional start date
   * @param endDate - Optional end date
   * @returns Promise resolving to array of transactions containing the product
   */
  findByProduct(productId: string, startDate?: Date, endDate?: Date): Promise<Transaction[]>;
}

// Made with Bob
