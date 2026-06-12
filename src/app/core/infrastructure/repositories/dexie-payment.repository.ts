import { Injectable, inject } from '@angular/core';
import { BaseDexieRepository } from '@core/infrastructure/repositories/base-dexie.repository';
import { IPaymentRepository } from '@core/domain/interfaces/payment.repository.interface';
import { Payment, PaymentStatus, PaymentMethod } from '@core/domain/entities/payment.entity';
import { PaymentBuilder } from '@core/domain/entities/payment.builder';
import { DexieDatabase, IPaymentDB } from '@core/infrastructure/database/dexie-database.service';

/**
 * Dexie Payment Repository
 * Implements payment repository using Dexie.js (IndexedDB)
 */
@Injectable({
  providedIn: 'root',
})
export class DexiePaymentRepository
  extends BaseDexieRepository<Payment, IPaymentDB>
  implements IPaymentRepository
{
  constructor() {
    const db = inject(DexieDatabase);

    super(db.payments);
  }

  /**
   * Map database record to domain entity
   */
  protected mapToDomain(record: IPaymentDB): Payment {
    const builder = new PaymentBuilder()
      .withId(record.id)
      .withOrderId(record.orderId)
      .withAmount(record.amount)
      .withMethod(record.method as PaymentMethod)
      .withStatus(record.status as PaymentStatus)
      .withCurrency(record.currency)
      .withRefundedAmount(record.refundedAmount)
      .withCreatedAt(record.createdAt)
      .withUpdatedAt(record.updatedAt);

    if (record.createdBy) builder.withCreatedBy(record.createdBy);
    if (record.updatedBy) builder.withUpdatedBy(record.updatedBy);
    if (record.completedAt) builder.withCompletedAt(record.completedAt);
    if (record.failureReason) builder.withFailureReason(record.failureReason);
    if (record.transactionId) builder.withTransactionId(record.transactionId);
    if (record.cardLast4) builder.withCardLast4(record.cardLast4);
    if (record.cardBrand) builder.withCardBrand(record.cardBrand);
    if (record.receiptNumber) builder.withReceiptNumber(record.receiptNumber);

    return builder.build();
  }

  /**
   * Map database record to entity (alias for mapToDomain)
   */
  protected mapToEntity(record: IPaymentDB): Payment {
    return this.mapToDomain(record);
  }

  /**
   * Map domain entity to database record
   */
  protected mapToDatabase(entity: Payment): IPaymentDB {
    return {
      id: entity.id,
      orderId: entity.orderId,
      amount: entity.amount,
      method: entity.method,
      status: entity.status,
      currency: entity.currency,
      refundedAmount: entity.refundedAmount,
      completedAt: entity.completedAt,
      failureReason: entity.failureReason,
      transactionId: entity.transactionId,
      cardLast4: entity.cardLast4,
      cardBrand: entity.cardBrand,
      receiptNumber: entity.receiptNumber,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
    };
  }

  /**
   * Find payments by transaction/order ID
   */
  async findByTransactionId(transactionId: string): Promise<Payment[]> {
    const records = await this.table.where('orderId').equals(transactionId).toArray();
    return records.map((r) => this.mapToDomain(r));
  }

  /**
   * Find payments by customer ID
   * Note: This requires joining with transactions table or storing customerId
   */
  async findByCustomerId(_customerId: string): Promise<Payment[]> {
    // For now, return empty array as we'd need to join with transactions
    // In a real implementation, you'd either:
    // 1. Store customerId in payments table
    // 2. Query transactions first, then filter payments
    return [];
  }

  /**
   * Find payments by status
   */
  async findByStatus(status: PaymentStatus): Promise<Payment[]> {
    const records = await this.table.where('status').equals(status).toArray();
    return records.map((r) => this.mapToDomain(r));
  }

  /**
   * Find payments by method
   */
  async findByMethod(method: PaymentMethod): Promise<Payment[]> {
    const records = await this.table.where('method').equals(method).toArray();
    return records.map((r) => this.mapToDomain(r));
  }

  /**
   * Find payments by date range
   */
  async findByDateRange(startDate: Date, endDate: Date): Promise<Payment[]> {
    const records = await this.table
      .where('createdAt')
      .between(startDate, endDate, true, true)
      .toArray();
    return records.map((r) => this.mapToDomain(r));
  }

  /**
   * Get total payment amount for a transaction
   */
  async getTotalByTransaction(transactionId: string): Promise<number> {
    const payments = await this.findByTransactionId(transactionId);
    return payments
      .filter((p) => p.status === PaymentStatus.COMPLETED)
      .reduce((sum, p) => sum + p.amount, 0);
  }

  /**
   * Get total payment amount for a customer
   */
  async getTotalByCustomer(customerId: string): Promise<number> {
    const payments = await this.findByCustomerId(customerId);
    return payments
      .filter((p) => p.status === PaymentStatus.COMPLETED)
      .reduce((sum, p) => sum + p.amount, 0);
  }

  /**
   * Get payment statistics for a date range
   */
  async getStatsByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalAmount: number;
    totalCount: number;
    byMethod: Record<PaymentMethod, { count: number; amount: number }>;
    byStatus: Record<PaymentStatus, { count: number; amount: number }>;
  }> {
    const payments = await this.findByDateRange(startDate, endDate);

    const byMethod: Record<PaymentMethod, { count: number; amount: number }> = {
      [PaymentMethod.CASH]: { count: 0, amount: 0 },
      [PaymentMethod.CREDIT_CARD]: { count: 0, amount: 0 },
      [PaymentMethod.DEBIT_CARD]: { count: 0, amount: 0 },
      [PaymentMethod.DIGITAL_WALLET]: { count: 0, amount: 0 },
      [PaymentMethod.GIFT_CARD]: { count: 0, amount: 0 },
    };

    const byStatus: Record<PaymentStatus, { count: number; amount: number }> = {
      [PaymentStatus.PENDING]: { count: 0, amount: 0 },
      [PaymentStatus.PROCESSING]: { count: 0, amount: 0 },
      [PaymentStatus.COMPLETED]: { count: 0, amount: 0 },
      [PaymentStatus.FAILED]: { count: 0, amount: 0 },
      [PaymentStatus.REFUNDED]: { count: 0, amount: 0 },
      [PaymentStatus.PARTIALLY_REFUNDED]: { count: 0, amount: 0 },
    };

    let totalAmount = 0;
    let totalCount = 0;

    for (const payment of payments) {
      totalCount++;
      totalAmount += payment.amount;

      byMethod[payment.method].count++;
      byMethod[payment.method].amount += payment.amount;

      byStatus[payment.status].count++;
      byStatus[payment.status].amount += payment.amount;
    }

    return {
      totalAmount,
      totalCount,
      byMethod,
      byStatus,
    };
  }

  /**
   * Get refunded payments
   */
  async getRefundedPayments(startDate?: Date, endDate?: Date): Promise<Payment[]> {
    const query = this.table
      .where('status')
      .anyOf([PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED]);

    let records = await query.toArray();

    if (startDate && endDate) {
      records = records.filter((r) => r.createdAt >= startDate && r.createdAt <= endDate);
    }

    return records.map((r) => this.mapToDomain(r));
  }

  /**
   * Get failed payments
   */
  async getFailedPayments(startDate?: Date, endDate?: Date): Promise<Payment[]> {
    const query = this.table.where('status').equals(PaymentStatus.FAILED);
    let records = await query.toArray();

    if (startDate && endDate) {
      records = records.filter((r) => r.createdAt >= startDate && r.createdAt <= endDate);
    }

    return records.map((r) => this.mapToDomain(r));
  }
}

// Made with Bob
