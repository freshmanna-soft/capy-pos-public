/**
 * Sales Agent Interface
 * Defines the contract for sales transaction management operations
 */

import { Observable } from 'rxjs';
import { IBaseAgent, IAgentResponse } from '@app/agents/base';
import { Transaction } from '@core/domain/entities/transaction.entity';

/**
 * Sales-specific message types
 */
export enum SalesMessageType {
  RECORD_SALE = 'RECORD_SALE',
  PROCESS_RETURN = 'PROCESS_RETURN',
  VOID_TRANSACTION = 'VOID_TRANSACTION',
  GET_SALES_METRICS = 'GET_SALES_METRICS',
  GENERATE_REPORT = 'GENERATE_REPORT',
  GET_DAILY_SUMMARY = 'GET_DAILY_SUMMARY',
  GET_TOP_PRODUCTS = 'GET_TOP_PRODUCTS',
  GET_SALES_BY_PERIOD = 'GET_SALES_BY_PERIOD',
}

/**
 * Record sale request
 */
export interface IRecordSaleRequest {
  transactionId: string;
  customerId?: string;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }[];
  subtotal: number;
  taxRate: number;
  discountAmount?: number;
  paymentIds: string[];
  receiptNumber?: string;
  notes?: string;
  createdBy?: string;
}

/**
 * Process return request
 */
export interface IProcessReturnRequest {
  originalTransactionId: string;
  returnTransactionId: string;
  items: {
    productId: string;
    quantity: number;
    refundAmount: number;
  }[];
  reason: string;
  refundMethod: 'ORIGINAL' | 'CASH' | 'STORE_CREDIT';
  processedBy?: string;
}

/**
 * Void transaction request
 */
export interface IVoidTransactionRequest {
  transactionId: string;
  reason: string;
  voidedBy?: string;
}

/**
 * Sales metrics response
 */
export interface ISalesMetrics {
  totalSales: number;
  totalRevenue: number;
  totalTransactions: number;
  averageTransactionValue: number;
  totalRefunds: number;
  refundRate: number;
  totalItems: number;
  averageItemsPerTransaction: number;
  period: {
    start: Date;
    end: Date;
  };
}

/**
 * Daily summary response
 */
export interface IDailySummary {
  date: Date;
  totalSales: number;
  totalRevenue: number;
  transactionCount: number;
  refundCount: number;
  netRevenue: number;
  topProducts: {
    productId: string;
    productName: string;
    quantitySold: number;
    revenue: number;
  }[];
  hourlyBreakdown: {
    hour: number;
    sales: number;
    transactions: number;
  }[];
}

/**
 * Top products response
 */
export interface ITopProduct {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  transactionCount: number;
  averagePrice: number;
}

/**
 * Sales by period request
 */
export interface ISalesByPeriodRequest {
  startDate: Date;
  endDate: Date;
  groupBy: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';
  includeRefunds?: boolean;
}

/**
 * Sales by period response
 */
export interface ISalesByPeriod {
  period: string;
  sales: number;
  revenue: number;
  transactions: number;
  refunds: number;
  netRevenue: number;
}

/**
 * Sales report request
 */
export interface ISalesReportRequest {
  startDate: Date;
  endDate: Date;
  reportType: 'SUMMARY' | 'DETAILED' | 'BY_PRODUCT' | 'BY_CUSTOMER' | 'BY_PAYMENT_METHOD';
  format?: 'JSON' | 'CSV' | 'PDF';
  includeCharts?: boolean;
}

/**
 * Sales Agent Interface
 * Extends base agent with sales-specific operations
 */
export interface ISalesAgent extends IBaseAgent {
  /**
   * Record a new sale transaction
   */
  recordSale(request: IRecordSaleRequest): Promise<IAgentResponse<Transaction>>;

  /**
   * Process a return transaction
   */
  processReturn(request: IProcessReturnRequest): Promise<IAgentResponse<Transaction>>;

  /**
   * Void a transaction
   */
  voidTransaction(request: IVoidTransactionRequest): Promise<IAgentResponse<Transaction>>;

  /**
   * Get sales metrics for a period
   */
  getSalesMetrics(startDate: Date, endDate: Date): Promise<IAgentResponse<ISalesMetrics>>;

  /**
   * Generate a sales report
   */
  generateReport(request: ISalesReportRequest): Promise<IAgentResponse<unknown>>;

  /**
   * Get daily summary
   */
  getDailySummary(date: Date): Promise<IAgentResponse<IDailySummary>>;

  /**
   * Get top selling products
   */
  getTopProducts(
    limit: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<IAgentResponse<ITopProduct[]>>;

  /**
   * Get sales by period
   */
  getSalesByPeriod(request: ISalesByPeriodRequest): Promise<IAgentResponse<ISalesByPeriod[]>>;

  /**
   * Subscribe to real-time sales events
   */
  subscribeSalesEvents(): Observable<Transaction>;

  /**
   * Subscribe to daily summaries
   */
  subscribeDailySummaries(): Observable<IDailySummary>;
}

// Made with Bob
