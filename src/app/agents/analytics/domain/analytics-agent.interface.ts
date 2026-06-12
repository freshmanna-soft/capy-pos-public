import { Observable } from 'rxjs';
import { IBaseAgent } from '@app/agents/base/base-agent.interface';

/**
 * Analytics Agent Interface
 * Handles data analytics, reporting, and insights generation
 */
export interface IAnalyticsAgent extends IBaseAgent {
  /**
   * Generate sales analytics
   */
  generateSalesAnalytics(request: SalesAnalyticsRequest): Promise<SalesAnalyticsResponse>;

  /**
   * Generate inventory analytics
   */
  generateInventoryAnalytics(
    request: InventoryAnalyticsRequest
  ): Promise<InventoryAnalyticsResponse>;

  /**
   * Generate customer analytics
   */
  generateCustomerAnalytics(request: CustomerAnalyticsRequest): Promise<CustomerAnalyticsResponse>;

  /**
   * Get real-time metrics
   */
  getRealTimeMetrics(): Promise<RealTimeMetricsResponse>;

  /**
   * Observable stream of analytics events
   */
  analyticsEvents$: Observable<AnalyticsEvent>;
}

export interface SalesAnalyticsRequest {
  startDate: Date;
  endDate: Date;
  groupBy?: 'day' | 'week' | 'month';
}

export interface SalesAnalyticsResponse {
  totalSales: number;
  totalRevenue: number;
  averageOrderValue: number;
  trends: { date: Date; sales: number; revenue: number }[];
}

export interface InventoryAnalyticsRequest {
  includeOutOfStock?: boolean;
  includeLowStock?: boolean;
}

export interface InventoryAnalyticsResponse {
  totalProducts: number;
  outOfStock: number;
  lowStock: number;
  topSellingProducts: { productId: string; name: string; quantity: number }[];
}

export interface CustomerAnalyticsRequest {
  startDate?: Date;
  endDate?: Date;
}

export interface CustomerAnalyticsResponse {
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  topCustomers: { customerId: string; name: string; totalSpent: number }[];
}

export interface RealTimeMetricsResponse {
  currentSales: number;
  todayRevenue: number;
  activeTransactions: number;
  lowStockAlerts: number;
}

export interface AnalyticsEvent {
  type: 'metric_updated' | 'alert_triggered' | 'report_generated';
  timestamp: Date;
  data: unknown;
}

// Made with Bob
