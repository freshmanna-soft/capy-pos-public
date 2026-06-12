import { Injectable, inject } from '@angular/core';
import { BaseDexieRepository } from '@core/infrastructure/repositories/base-dexie.repository';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
  ITransactionItem,
} from '@core/domain/entities/transaction.entity';
import { TransactionBuilder } from '@core/domain/entities/transaction.builder';
import { ITransactionRepository } from '@core/domain/interfaces/transaction.repository.interface';
import {
  DexieDatabase,
  ITransactionDB,
} from '@core/infrastructure/database/dexie-database.service';

/**
 * Dexie Transaction Repository
 * Implements transaction-specific operations using Dexie ORM
 */
@Injectable({
  providedIn: 'root',
})
export class DexieTransactionRepository
  extends BaseDexieRepository<Transaction, ITransactionDB>
  implements ITransactionRepository
{
  private db: DexieDatabase;

  constructor() {
    const db = inject(DexieDatabase);

    super(db.transactions);

    this.db = db;
  }

  /**
   * Map database record to Transaction entity
   */
  protected mapToEntity(record: ITransactionDB): Transaction {
    const items: ITransactionItem[] = JSON.parse(record.items);
    const paymentIds: string[] = JSON.parse(record.paymentIds);

    const builder = new TransactionBuilder()
      .withId(record.id)
      .withItems(items)
      .withSubtotal(record.subtotal)
      .withTaxRate(record.taxRate)
      .withTaxAmount(record.taxAmount)
      .withDiscountAmount(record.discountAmount)
      .withTotal(record.total)
      .withStatus(record.status as TransactionStatus)
      .withType(record.type as TransactionType)
      .withRefundedAmount(record.refundedAmount)
      .withCreatedAt(new Date(record.createdAt))
      .withUpdatedAt(new Date(record.updatedAt))
      .withPaymentIds(paymentIds);

    if (record.customerId) {
      builder.withCustomerId(record.customerId);
    }
    if (record.createdBy) {
      builder.withCreatedBy(record.createdBy);
    }
    if (record.updatedBy) {
      builder.withUpdatedBy(record.updatedBy);
    }
    if (record.completedAt) {
      builder.withCompletedAt(new Date(record.completedAt));
    }
    if (record.cancelledAt) {
      builder.withCancelledAt(new Date(record.cancelledAt));
    }
    if (record.cancellationReason) {
      builder.withCancellationReason(record.cancellationReason);
    }
    if (record.receiptNumber) {
      builder.withReceiptNumber(record.receiptNumber);
    }
    if (record.notes) {
      builder.withNotes(record.notes);
    }

    return builder.build();
  }

  /**
   * Map Transaction entity to database record
   */
  protected mapToDatabase(entity: Transaction): ITransactionDB {
    const json = entity.toJSON();
    return {
      id: entity.id,
      customerId: entity.customerId,
      items: JSON.stringify(entity.items),
      subtotal: entity.subtotal,
      taxRate: entity.taxRate,
      taxAmount: entity.taxAmount,
      discountAmount: entity.discountAmount,
      total: entity.total,
      status: entity.status,
      type: entity.type,
      refundedAmount: entity.refundedAmount,
      paymentIds: JSON.stringify(entity.paymentIds),
      receiptNumber: entity.receiptNumber,
      notes: entity.notes,
      completedAt: entity.completedAt,
      cancelledAt: entity.cancelledAt,
      cancellationReason: entity.cancellationReason,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
      deletedAt: json['deletedAt'] ? new Date(json['deletedAt'] as string) : undefined,
      deletedBy: json['deletedBy'] as string | undefined,
    };
  }

  /**
   * Find transactions by customer ID
   */
  async findByCustomerId(customerId: string): Promise<Transaction[]> {
    const records = await this.table
      .where('customerId')
      .equals(customerId)
      .and((record) => !record.deletedAt)
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Find transactions by status
   */
  async findByStatus(status: TransactionStatus): Promise<Transaction[]> {
    const records = await this.table
      .where('status')
      .equals(status)
      .and((record) => !record.deletedAt)
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Find transactions by type
   */
  async findByType(type: TransactionType): Promise<Transaction[]> {
    const records = await this.table
      .where('type')
      .equals(type)
      .and((record) => !record.deletedAt)
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Find transactions by date range
   */
  async findByDateRange(startDate: Date, endDate: Date): Promise<Transaction[]> {
    const records = await this.table
      .where('createdAt')
      .between(startDate, endDate, true, true)
      .and((record) => !record.deletedAt)
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Find transaction by receipt number
   */
  async findByReceiptNumber(receiptNumber: string): Promise<Transaction | null> {
    const records = await this.table
      .filter((record) => record.receiptNumber === receiptNumber && !record.deletedAt)
      .toArray();

    if (records.length === 0) return null;
    return this.mapToEntity(records[0]);
  }

  /**
   * Get total sales for a date range
   */
  async getTotalSales(startDate: Date, endDate: Date): Promise<number> {
    const records = await this.table
      .where('createdAt')
      .between(startDate, endDate, true, true)
      .and(
        (record) =>
          record.status === TransactionStatus.COMPLETED &&
          record.type === TransactionType.SALE &&
          !record.deletedAt
      )
      .toArray();

    return records.reduce((sum, record) => sum + record.total, 0);
  }

  /**
   * Get transaction count for a date range
   */
  async getTransactionCount(startDate: Date, endDate: Date): Promise<number> {
    return await this.table
      .where('createdAt')
      .between(startDate, endDate, true, true)
      .and((record) => !record.deletedAt)
      .count();
  }

  /**
   * Get average transaction value for a date range
   */
  async getAverageTransactionValue(startDate: Date, endDate: Date): Promise<number> {
    const records = await this.table
      .where('createdAt')
      .between(startDate, endDate, true, true)
      .and(
        (record) =>
          record.status === TransactionStatus.COMPLETED &&
          record.type === TransactionType.SALE &&
          !record.deletedAt
      )
      .toArray();

    if (records.length === 0) return 0;

    const total = records.reduce((sum, record) => sum + record.total, 0);
    return total / records.length;
  }

  /**
   * Get top selling products for a date range
   */
  async getTopProducts(
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
  > {
    const records = await this.table
      .where('createdAt')
      .between(startDate, endDate, true, true)
      .and(
        (record) =>
          record.status === TransactionStatus.COMPLETED &&
          record.type === TransactionType.SALE &&
          !record.deletedAt
      )
      .toArray();

    // Aggregate product sales
    const productMap = new Map<
      string,
      {
        productName: string;
        quantitySold: number;
        revenue: number;
        transactionCount: number;
      }
    >();

    for (const record of records) {
      const items: ITransactionItem[] = JSON.parse(record.items);

      for (const item of items) {
        const existing = productMap.get(item.productId);

        if (existing) {
          existing.quantitySold += item.quantity;
          existing.revenue += item.subtotal;
          existing.transactionCount += 1;
        } else {
          productMap.set(item.productId, {
            productName: item.productName,
            quantitySold: item.quantity,
            revenue: item.subtotal,
            transactionCount: 1,
          });
        }
      }
    }

    // Convert to array and sort by revenue
    const products = Array.from(productMap.entries()).map(([productId, data]) => ({
      productId,
      ...data,
    }));

    products.sort((a, b) => b.revenue - a.revenue);

    return products.slice(0, limit);
  }

  /**
   * Get sales by hour for a specific date
   */
  async getSalesByHour(date: Date): Promise<
    {
      hour: number;
      sales: number;
      transactions: number;
    }[]
  > {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const records = await this.table
      .where('createdAt')
      .between(startOfDay, endOfDay, true, true)
      .and(
        (record) =>
          record.status === TransactionStatus.COMPLETED &&
          record.type === TransactionType.SALE &&
          !record.deletedAt
      )
      .toArray();

    // Initialize hourly data
    const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      sales: 0,
      transactions: 0,
    }));

    // Aggregate by hour
    for (const record of records) {
      const hour = new Date(record.createdAt).getHours();
      hourlyData[hour].sales += record.total;
      hourlyData[hour].transactions += 1;
    }

    return hourlyData;
  }

  /**
   * Get refund statistics for a date range
   */
  async getRefundStats(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalRefunds: number;
    refundCount: number;
    refundRate: number;
  }> {
    const records = await this.table
      .where('createdAt')
      .between(startDate, endDate, true, true)
      .and((record) => !record.deletedAt)
      .toArray();

    const completedSales = records.filter(
      (r) => r.status === TransactionStatus.COMPLETED && r.type === TransactionType.SALE
    );

    const refundedTransactions = records.filter(
      (r) =>
        r.status === TransactionStatus.REFUNDED || r.status === TransactionStatus.PARTIALLY_REFUNDED
    );

    const totalRefunds = refundedTransactions.reduce((sum, r) => sum + r.refundedAmount, 0);
    const refundCount = refundedTransactions.length;
    const refundRate = completedSales.length > 0 ? refundCount / completedSales.length : 0;

    return {
      totalRefunds,
      refundCount,
      refundRate,
    };
  }

  /**
   * Find completed transactions
   */
  async findCompleted(limit?: number): Promise<Transaction[]> {
    let query = this.table
      .where('status')
      .equals(TransactionStatus.COMPLETED)
      .and((record) => !record.deletedAt)
      .reverse();

    if (limit) {
      query = query.limit(limit);
    }

    const records = await query.toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Find pending transactions
   */
  async findPending(): Promise<Transaction[]> {
    const records = await this.table
      .where('status')
      .equals(TransactionStatus.PENDING)
      .and((record) => !record.deletedAt)
      .toArray();
    return records.map((record) => this.mapToEntity(record));
  }

  /**
   * Update transaction status
   */
  async updateStatus(
    transactionId: string,
    status: TransactionStatus,
    updatedBy?: string
  ): Promise<Transaction> {
    const transaction = await this.findById(transactionId);
    if (!transaction) {
      throw new Error(`Transaction with id ${transactionId} not found`);
    }

    // Create updated transaction with new status
    const updateBuilder = new TransactionBuilder()
      .withId(transaction.id)
      .withItems(transaction.items)
      .withSubtotal(transaction.subtotal)
      .withTaxRate(transaction.taxRate)
      .withTaxAmount(transaction.taxAmount)
      .withDiscountAmount(transaction.discountAmount)
      .withTotal(transaction.total)
      .withStatus(status)
      .withType(transaction.type)
      .withRefundedAmount(transaction.refundedAmount)
      .withCreatedAt(transaction.createdAt)
      .withUpdatedAt(new Date())
      .withPaymentIds(transaction.paymentIds);

    if (transaction.customerId) {
      updateBuilder.withCustomerId(transaction.customerId);
    }
    if (transaction.createdBy) {
      updateBuilder.withCreatedBy(transaction.createdBy);
    }
    if (updatedBy) {
      updateBuilder.withUpdatedBy(updatedBy);
    }
    if (transaction.completedAt) {
      updateBuilder.withCompletedAt(transaction.completedAt);
    }
    if (transaction.cancelledAt) {
      updateBuilder.withCancelledAt(transaction.cancelledAt);
    }
    if (transaction.cancellationReason) {
      updateBuilder.withCancellationReason(transaction.cancellationReason);
    }
    if (transaction.receiptNumber) {
      updateBuilder.withReceiptNumber(transaction.receiptNumber);
    }
    if (transaction.notes) {
      updateBuilder.withNotes(transaction.notes);
    }

    const updated = updateBuilder.build();

    return await this.update(transactionId, updated);
  }

  /**
   * Add payment to transaction
   */
  async addPayment(
    transactionId: string,
    paymentId: string,
    updatedBy?: string
  ): Promise<Transaction> {
    const transaction = await this.findById(transactionId);
    if (!transaction) {
      throw new Error(`Transaction with id ${transactionId} not found`);
    }

    transaction.addPayment(paymentId, updatedBy);

    return await this.update(transactionId, transaction);
  }

  /**
   * Search transactions by product
   */
  async findByProduct(productId: string, startDate?: Date, endDate?: Date): Promise<Transaction[]> {
    const query = this.table.filter((record) => {
      if (record.deletedAt) return false;

      const items: ITransactionItem[] = JSON.parse(record.items);
      const hasProduct = items.some((item) => item.productId === productId);

      if (!hasProduct) return false;

      if (startDate && endDate) {
        const recordDate = new Date(record.createdAt);
        return recordDate >= startDate && recordDate <= endDate;
      }

      return true;
    });

    const records = await query.toArray();
    return records.map((record) => this.mapToEntity(record));
  }
}

// Made with Bob
