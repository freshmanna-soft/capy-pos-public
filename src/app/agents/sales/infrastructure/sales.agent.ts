/**
 * Sales Agent Implementation
 * Handles all sales transaction operations and analytics
 * Extends BaseAgent with sales-specific functionality
 */

import { Injectable, Inject } from '@angular/core';
import { Observable, Subject, interval, Subscription } from 'rxjs';
import { BaseAgent } from '../../base/base-agent';
import { IAgentMessage, IAgentResponse } from '../../base/base-agent.interface';
import {
  ISalesAgent,
  SalesMessageType,
  IRecordSaleRequest,
  IProcessReturnRequest,
  IVoidTransactionRequest,
  ISalesMetrics,
  IDailySummary,
  ITopProduct,
  ISalesByPeriodRequest,
  ISalesByPeriod,
  ISalesReportRequest,
} from '../domain/sales-agent.interface';
import { ITransactionRepository } from '../../../core/domain/interfaces/transaction.repository.interface';
import { IProductRepository } from '../../../core/domain/interfaces/product.repository.interface';
import { 
  Transaction, 
  TransactionStatus, 
  TransactionType,
  ITransactionItem 
} from '../../../core/domain/entities/transaction.entity';

/**
 * SalesAgent
 * Concrete implementation of ISalesAgent
 * Manages sales transactions, returns, analytics, and reporting
 */
@Injectable({ providedIn: 'root' })
export class SalesAgent extends BaseAgent implements ISalesAgent {
  private readonly salesEvents$ = new Subject<Transaction>();
  private readonly dailySummaries$ = new Subject<IDailySummary>();
  private monitoringSubscription?: Subscription;

  constructor(
    @Inject('ITransactionRepository') private readonly transactionRepository: ITransactionRepository,
    @Inject('IProductRepository') private readonly productRepository: IProductRepository
  ) {
    super('sales-agent', 'Sales Agent', 'Manages sales transactions and analytics');
  }

  /**
   * Initialize the agent
   */
  protected async onInitialize(): Promise<void> {
    console.log('SalesAgent: Initializing...');
    // Verify repository connections
    const transactionCount = await this.transactionRepository.count();
    console.log(`SalesAgent: Found ${transactionCount} transactions in database`);
  }

  /**
   * Start the agent
   * Begin monitoring for daily summaries
   */
  protected async onStart(): Promise<void> {
    console.log('SalesAgent: Starting...');
    
    // Start daily summary monitoring (every hour)
    this.monitoringSubscription = interval(60 * 60 * 1000).subscribe(async () => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const summary = await this.generateDailySummary(today);
        this.dailySummaries$.next(summary);
      } catch (error) {
        console.error('SalesAgent: Error generating daily summary:', error);
      }
    });

    console.log('SalesAgent: Started successfully');
  }

  /**
   * Stop the agent
   */
  protected async onStop(): Promise<void> {
    console.log('SalesAgent: Stopping...');
    
    // Stop monitoring
    if (this.monitoringSubscription) {
      this.monitoringSubscription.unsubscribe();
      this.monitoringSubscription = undefined;
    }

    console.log('SalesAgent: Stopped successfully');
  }

  /**
   * Handle incoming messages
   */
  protected async handleMessage(message: IAgentMessage): Promise<IAgentResponse> {
    switch (message.type) {
      case SalesMessageType.RECORD_SALE:
        return this.recordSale(message.payload);
      
      case SalesMessageType.PROCESS_RETURN:
        return this.processReturn(message.payload);
      
      case SalesMessageType.VOID_TRANSACTION:
        return this.voidTransaction(message.payload);
      
      case SalesMessageType.GET_SALES_METRICS:
        return this.getSalesMetrics(message.payload.startDate, message.payload.endDate);
      
      case SalesMessageType.GENERATE_REPORT:
        return this.generateReport(message.payload);
      
      case SalesMessageType.GET_DAILY_SUMMARY:
        return this.getDailySummary(message.payload.date);
      
      case SalesMessageType.GET_TOP_PRODUCTS:
        return this.getTopProducts(
          message.payload.limit,
          message.payload.startDate,
          message.payload.endDate
        );
      
      case SalesMessageType.GET_SALES_BY_PERIOD:
        return this.getSalesByPeriod(message.payload);
      
      default:
        return {
          success: false,
          error: `Unknown message type: ${message.type}`,
        };
    }
  }

  /**
   * Record a new sale transaction
   */
  async recordSale(request: IRecordSaleRequest): Promise<IAgentResponse<Transaction>> {
    try {
      // Validate request
      if (!request.transactionId) {
        throw new Error('Transaction ID is required');
      }
      if (!request.items || request.items.length === 0) {
        throw new Error('Transaction must have at least one item');
      }
      if (request.subtotal < 0) {
        throw new Error('Subtotal cannot be negative');
      }

      // Calculate amounts
      const taxAmount = (request.subtotal - (request.discountAmount || 0)) * request.taxRate;
      const total = request.subtotal - (request.discountAmount || 0) + taxAmount;

      // Create transaction items
      const items: ITransactionItem[] = request.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.quantity * item.unitPrice,
      }));

      // Create transaction
      const transaction = new Transaction(
        request.transactionId,
        request.customerId,
        items,
        request.subtotal,
        request.taxRate,
        taxAmount,
        request.discountAmount || 0,
        total,
        TransactionStatus.PENDING,
        TransactionType.SALE,
        0,
        new Date(),
        new Date(),
        request.createdBy,
        undefined,
        undefined,
        undefined,
        undefined,
        request.paymentIds,
        request.receiptNumber,
        request.notes
      );

      // Save transaction
      const savedTransaction = await this.transactionRepository.create(transaction);

      // Mark as processing
      savedTransaction.markAsProcessing(request.createdBy);
      await this.transactionRepository.update(savedTransaction.id, savedTransaction);

      // Mark as completed
      savedTransaction.markAsCompleted(request.createdBy);
      const completedTransaction = await this.transactionRepository.update(
        savedTransaction.id,
        savedTransaction
      );

      // Update product stock
      for (const item of request.items) {
        await this.productRepository.adjustStock(item.productId, -item.quantity);
      }

      // Emit sales event
      this.salesEvents$.next(completedTransaction);

      return {
        success: true,
        data: completedTransaction,
        metadata: {
          transactionId: completedTransaction.id,
          total: completedTransaction.total,
          itemCount: completedTransaction.getTotalItems(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to record sale: ${errorMessage}`,
      };
    }
  }

  /**
   * Process a return transaction
   */
  async processReturn(request: IProcessReturnRequest): Promise<IAgentResponse<Transaction>> {
    try {
      // Validate request
      if (!request.originalTransactionId) {
        throw new Error('Original transaction ID is required');
      }
      if (!request.returnTransactionId) {
        throw new Error('Return transaction ID is required');
      }
      if (!request.items || request.items.length === 0) {
        throw new Error('Return must have at least one item');
      }

      // Get original transaction
      const originalTransaction = await this.transactionRepository.findById(
        request.originalTransactionId
      );
      if (!originalTransaction) {
        throw new Error('Original transaction not found');
      }

      // Validate original transaction can be returned
      if (!originalTransaction.isCompleted()) {
        throw new Error('Can only return completed transactions');
      }

      // Calculate return amounts
      const returnSubtotal = request.items.reduce((sum, item) => sum + item.refundAmount, 0);
      const returnTaxAmount = returnSubtotal * originalTransaction.taxRate;
      const returnTotal = returnSubtotal + returnTaxAmount;

      // Create return transaction items
      const returnItems: ITransactionItem[] = request.items.map(item => {
        const originalItem = originalTransaction.getItem(item.productId);
        if (!originalItem) {
          throw new Error(`Product ${item.productId} not found in original transaction`);
        }
        return {
          productId: item.productId,
          productName: originalItem.productName,
          quantity: -item.quantity, // Negative quantity for returns
          unitPrice: originalItem.unitPrice,
          subtotal: -item.refundAmount,
        };
      });

      // Create return transaction
      const returnTransaction = new Transaction(
        request.returnTransactionId,
        originalTransaction.customerId,
        returnItems,
        -returnSubtotal,
        originalTransaction.taxRate,
        -returnTaxAmount,
        0,
        -returnTotal,
        TransactionStatus.PENDING,
        TransactionType.RETURN,
        0,
        new Date(),
        new Date(),
        request.processedBy,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        `Return for transaction ${request.originalTransactionId}. Reason: ${request.reason}`
      );

      // Save return transaction
      const savedReturn = await this.transactionRepository.create(returnTransaction);

      // Mark as completed
      savedReturn.markAsProcessing(request.processedBy);
      savedReturn.markAsCompleted(request.processedBy);
      const completedReturn = await this.transactionRepository.update(savedReturn.id, savedReturn);

      // Process refund on original transaction
      originalTransaction.refund(returnTotal, request.processedBy);
      await this.transactionRepository.update(originalTransaction.id, originalTransaction);

      // Restore product stock
      for (const item of request.items) {
        await this.productRepository.adjustStock(item.productId, item.quantity);
      }

      // Emit sales event
      this.salesEvents$.next(completedReturn);

      return {
        success: true,
        data: completedReturn,
        metadata: {
          returnTransactionId: completedReturn.id,
          originalTransactionId: request.originalTransactionId,
          refundAmount: returnTotal,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to process return: ${errorMessage}`,
      };
    }
  }

  /**
   * Void a transaction
   */
  async voidTransaction(request: IVoidTransactionRequest): Promise<IAgentResponse<Transaction>> {
    try {
      // Validate request
      if (!request.transactionId) {
        throw new Error('Transaction ID is required');
      }
      if (!request.reason) {
        throw new Error('Void reason is required');
      }

      // Get transaction
      const transaction = await this.transactionRepository.findById(request.transactionId);
      if (!transaction) {
        throw new Error('Transaction not found');
      }

      // Void transaction
      transaction.cancel(request.reason, request.voidedBy);
      const voidedTransaction = await this.transactionRepository.update(
        transaction.id,
        transaction
      );

      // Restore product stock if transaction was completed
      if (transaction.type === TransactionType.SALE) {
        for (const item of transaction.items) {
          await this.productRepository.adjustStock(item.productId, item.quantity);
        }
      }

      return {
        success: true,
        data: voidedTransaction,
        metadata: {
          transactionId: voidedTransaction.id,
          reason: request.reason,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to void transaction: ${errorMessage}`,
      };
    }
  }

  /**
   * Get sales metrics for a period
   */
  async getSalesMetrics(startDate: Date, endDate: Date): Promise<IAgentResponse<ISalesMetrics>> {
    try {
      // Get transactions for period
      const transactions = await this.transactionRepository.findByDateRange(startDate, endDate);
      
      // Filter completed sales
      const completedSales = transactions.filter(
        t => t.status === TransactionStatus.COMPLETED && t.type === TransactionType.SALE
      );

      // Calculate metrics
      const totalSales = completedSales.length;
      const totalRevenue = completedSales.reduce((sum, t) => sum + t.total, 0);
      const totalTransactions = transactions.length;
      const averageTransactionValue = totalSales > 0 ? totalRevenue / totalSales : 0;

      // Calculate refund metrics
      const refundedTransactions = transactions.filter(
        t => t.status === TransactionStatus.REFUNDED || t.status === TransactionStatus.PARTIALLY_REFUNDED
      );
      const totalRefunds = refundedTransactions.reduce((sum, t) => sum + t.refundedAmount, 0);
      const refundRate = totalSales > 0 ? refundedTransactions.length / totalSales : 0;

      // Calculate item metrics
      const totalItems = completedSales.reduce((sum, t) => sum + t.getTotalItems(), 0);
      const averageItemsPerTransaction = totalSales > 0 ? totalItems / totalSales : 0;

      const metrics: ISalesMetrics = {
        totalSales,
        totalRevenue,
        totalTransactions,
        averageTransactionValue,
        totalRefunds,
        refundRate,
        totalItems,
        averageItemsPerTransaction,
        period: {
          start: startDate,
          end: endDate,
        },
      };

      return {
        success: true,
        data: metrics,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to get sales metrics: ${errorMessage}`,
      };
    }
  }

  /**
   * Generate a sales report
   */
  async generateReport(request: ISalesReportRequest): Promise<IAgentResponse<any>> {
    try {
      // Get metrics for the period
      const metricsResponse = await this.getSalesMetrics(request.startDate, request.endDate);
      if (!metricsResponse.success || !metricsResponse.data) {
        throw new Error('Failed to get sales metrics');
      }

      // Get top products
      const topProductsResponse = await this.getTopProducts(10, request.startDate, request.endDate);
      if (!topProductsResponse.success || !topProductsResponse.data) {
        throw new Error('Failed to get top products');
      }

      const report = {
        reportType: request.reportType,
        period: {
          start: request.startDate,
          end: request.endDate,
        },
        metrics: metricsResponse.data,
        topProducts: topProductsResponse.data,
        generatedAt: new Date(),
      };

      return {
        success: true,
        data: report,
        metadata: {
          format: request.format || 'JSON',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to generate report: ${errorMessage}`,
      };
    }
  }

  /**
   * Get daily summary
   */
  async getDailySummary(date: Date): Promise<IAgentResponse<IDailySummary>> {
    try {
      const summary = await this.generateDailySummary(date);
      return {
        success: true,
        data: summary,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to get daily summary: ${errorMessage}`,
      };
    }
  }

  /**
   * Generate daily summary (internal helper)
   */
  private async generateDailySummary(date: Date): Promise<IDailySummary> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Get transactions for the day
    const transactions = await this.transactionRepository.findByDateRange(startOfDay, endOfDay);
    
    // Filter completed sales
    const completedSales = transactions.filter(
      t => t.status === TransactionStatus.COMPLETED && t.type === TransactionType.SALE
    );

    // Calculate totals
    const totalSales = completedSales.length;
    const totalRevenue = completedSales.reduce((sum, t) => sum + t.total, 0);
    const refundCount = transactions.filter(
      t => t.status === TransactionStatus.REFUNDED || t.status === TransactionStatus.PARTIALLY_REFUNDED
    ).length;
    const totalRefunds = transactions.reduce((sum, t) => sum + t.refundedAmount, 0);
    const netRevenue = totalRevenue - totalRefunds;

    // Get top products for the day
    const topProductsData = await this.transactionRepository.getTopProducts(startOfDay, endOfDay, 5);
    const topProducts = topProductsData.map(p => ({
      productId: p.productId,
      productName: p.productName,
      quantitySold: p.quantitySold,
      revenue: p.revenue,
    }));

    // Get hourly breakdown
    const hourlyData = await this.transactionRepository.getSalesByHour(date);
    const hourlyBreakdown = hourlyData.map(h => ({
      hour: h.hour,
      sales: h.sales,
      transactions: h.transactions,
    }));

    return {
      date,
      totalSales,
      totalRevenue,
      transactionCount: transactions.length,
      refundCount,
      netRevenue,
      topProducts,
      hourlyBreakdown,
    };
  }

  /**
   * Get top selling products
   */
  async getTopProducts(
    limit: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<IAgentResponse<ITopProduct[]>> {
    try {
      const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
      const end = endDate || new Date();

      const topProductsData = await this.transactionRepository.getTopProducts(start, end, limit);
      
      const topProducts: ITopProduct[] = topProductsData.map(p => ({
        productId: p.productId,
        productName: p.productName,
        quantitySold: p.quantitySold,
        revenue: p.revenue,
        transactionCount: p.transactionCount,
        averagePrice: p.quantitySold > 0 ? p.revenue / p.quantitySold : 0,
      }));

      return {
        success: true,
        data: topProducts,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to get top products: ${errorMessage}`,
      };
    }
  }

  /**
   * Get sales by period
   */
  async getSalesByPeriod(request: ISalesByPeriodRequest): Promise<IAgentResponse<ISalesByPeriod[]>> {
    try {
      // Get transactions for period
      const transactions = await this.transactionRepository.findByDateRange(
        request.startDate,
        request.endDate
      );

      // Group by period
      const grouped = new Map<string, ISalesByPeriod>();

      for (const transaction of transactions) {
        if (transaction.status !== TransactionStatus.COMPLETED) continue;

        const periodKey = this.getPeriodKey(transaction.createdAt, request.groupBy);
        
        if (!grouped.has(periodKey)) {
          grouped.set(periodKey, {
            period: periodKey,
            sales: 0,
            revenue: 0,
            transactions: 0,
            refunds: 0,
            netRevenue: 0,
          });
        }

        const periodData = grouped.get(periodKey)!;
        
        if (transaction.type === TransactionType.SALE) {
          periodData.sales++;
          periodData.revenue += transaction.total;
          periodData.transactions++;
        }
        
        if (request.includeRefunds && transaction.refundedAmount > 0) {
          periodData.refunds += transaction.refundedAmount;
        }
        
        periodData.netRevenue = periodData.revenue - periodData.refunds;
      }

      const salesByPeriod = Array.from(grouped.values()).sort((a, b) => 
        a.period.localeCompare(b.period)
      );

      return {
        success: true,
        data: salesByPeriod,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Failed to get sales by period: ${errorMessage}`,
      };
    }
  }

  /**
   * Get period key for grouping
   */
  private getPeriodKey(date: Date, groupBy: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH'): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');

    switch (groupBy) {
      case 'HOUR':
        return `${year}-${month}-${day} ${hour}:00`;
      case 'DAY':
        return `${year}-${month}-${day}`;
      case 'WEEK':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        return `${weekStart.getFullYear()}-W${this.getWeekNumber(weekStart)}`;
      case 'MONTH':
        return `${year}-${month}`;
      default:
        return `${year}-${month}-${day}`;
    }
  }

  /**
   * Get ISO week number
   */
  private getWeekNumber(date: Date): string {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return String(weekNo).padStart(2, '0');
  }

  /**
   * Subscribe to real-time sales events
   */
  subscribeSalesEvents(): Observable<Transaction> {
    return this.salesEvents$.asObservable();
  }

  /**
   * Subscribe to daily summaries
   */
  subscribeDailySummaries(): Observable<IDailySummary> {
    return this.dailySummaries$.asObservable();
  }
}

// Made with Bob