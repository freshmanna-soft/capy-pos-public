/**
 * Inventory Agent Interface
 * Defines the contract for inventory management operations
 */

import { Observable } from 'rxjs';
import { IBaseAgent, IAgentResponse } from '@app/agents/base';

/**
 * Inventory-specific message types
 */
export enum InventoryMessageType {
  CHECK_STOCK = 'CHECK_STOCK',
  UPDATE_STOCK = 'UPDATE_STOCK',
  ADJUST_STOCK = 'ADJUST_STOCK',
  LOW_STOCK_ALERT = 'LOW_STOCK_ALERT',
  REORDER_SUGGESTION = 'REORDER_SUGGESTION',
  STOCK_AUDIT = 'STOCK_AUDIT',
  BULK_UPDATE = 'BULK_UPDATE',
  STOCK_TRANSFER = 'STOCK_TRANSFER',
}

/**
 * Stock check request
 */
export interface IStockCheckRequest {
  productId: string;
  includeHistory?: boolean;
}

/**
 * Stock update request
 */
export interface IStockUpdateRequest {
  productId: string;
  quantity: number;
  reason?: string;
  reference?: string;
}

/**
 * Stock adjustment request
 */
export interface IStockAdjustmentRequest {
  productId: string;
  adjustment: number;
  reason: string;
  reference?: string;
}

/**
 * Low stock alert configuration
 */
export interface ILowStockAlert {
  productId: string;
  currentStock: number;
  threshold: number;
  reorderQuantity: number;
}

/**
 * Reorder suggestion
 */
export interface IReorderSuggestion {
  productId: string;
  productName: string;
  currentStock: number;
  averageDailySales: number;
  suggestedQuantity: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Stock audit result
 */
export interface IStockAuditResult {
  totalProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  totalValue: number;
  alerts: ILowStockAlert[];
  suggestions: IReorderSuggestion[];
}

/**
 * Bulk stock update request
 */
export interface IBulkStockUpdate {
  updates: {
    productId: string;
    quantity: number;
    reason?: string;
  }[];
}

/**
 * Stock transfer request
 */
export interface IStockTransferRequest {
  productId: string;
  fromLocation: string;
  toLocation: string;
  quantity: number;
  reference?: string;
}

/**
 * Inventory Agent Interface
 * Extends base agent with inventory-specific operations
 */
export interface IInventoryAgent extends IBaseAgent {
  /**
   * Check stock level for a product
   */
  checkStock(request: IStockCheckRequest): Promise<IAgentResponse>;

  /**
   * Update stock quantity
   */
  updateStock(request: IStockUpdateRequest): Promise<IAgentResponse>;

  /**
   * Adjust stock with reason
   */
  adjustStock(request: IStockAdjustmentRequest): Promise<IAgentResponse>;

  /**
   * Get low stock alerts
   */
  getLowStockAlerts(): Promise<IAgentResponse>;

  /**
   * Get reorder suggestions
   */
  getReorderSuggestions(): Promise<IAgentResponse>;

  /**
   * Perform stock audit
   */
  performStockAudit(): Promise<IAgentResponse>;

  /**
   * Bulk update stock levels
   */
  bulkUpdateStock(request: IBulkStockUpdate): Promise<IAgentResponse>;

  /**
   * Transfer stock between locations
   */
  transferStock(request: IStockTransferRequest): Promise<IAgentResponse>;

  /**
   * Subscribe to low stock alerts
   */
  subscribeLowStockAlerts(): Observable<ILowStockAlert>;

  /**
   * Subscribe to reorder suggestions
   */
  subscribeReorderSuggestions(): Observable<IReorderSuggestion>;
}

// Made with Bob
