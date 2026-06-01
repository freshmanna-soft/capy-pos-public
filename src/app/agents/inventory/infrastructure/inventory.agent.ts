import { Injectable, Inject } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { BaseAgent } from '../../base/base-agent';
import { IAgentMessage, IAgentResponse } from '../../base/base-agent.interface';
import {
  IInventoryAgent,
  InventoryMessageType,
  IStockCheckRequest,
  IStockUpdateRequest,
  IStockAdjustmentRequest,
  ILowStockAlert,
  IReorderSuggestion,
  IStockAuditResult,
  IBulkStockUpdate,
  IStockTransferRequest,
} from '../domain/inventory-agent.interface';
import { IProductRepository } from '../../../core/domain/interfaces/product.repository.interface';
import { Product } from '../../../core/domain/entities/product.entity';

/**
 * Inventory Agent Implementation
 * Handles all inventory management operations
 * Extends BaseAgent for lifecycle management
 */
@Injectable({
  providedIn: 'root',
})
export class InventoryAgent extends BaseAgent implements IInventoryAgent {
  private readonly _lowStockAlerts$ = new Subject<ILowStockAlert>();
  private readonly _reorderSuggestions$ = new Subject<IReorderSuggestion>();
  private _monitoringInterval?: number;

  constructor(
    @Inject('IProductRepository') private readonly productRepository: IProductRepository
  ) {
    super(
      'inventory-agent',
      'Inventory Agent',
      'Manages product catalog and stock levels'
    );
  }

  /**
   * Initialize the inventory agent
   */
  protected async onInitialize(): Promise<void> {
    console.log('Initializing Inventory Agent...');
    // Perform initial stock audit
    await this.performStockAudit();
  }

  /**
   * Start the inventory agent
   * Begin monitoring stock levels
   */
  protected async onStart(): Promise<void> {
    console.log('Starting Inventory Agent...');
    // Start monitoring stock levels every 5 minutes
    this._monitoringInterval = window.setInterval(
      () => this.monitorStockLevels(),
      5 * 60 * 1000
    );
  }

  /**
   * Stop the inventory agent
   * Cleanup monitoring
   */
  protected async onStop(): Promise<void> {
    console.log('Stopping Inventory Agent...');
    if (this._monitoringInterval) {
      clearInterval(this._monitoringInterval);
      this._monitoringInterval = undefined;
    }
  }

  /**
   * Handle incoming messages
   */
  protected async handleMessage(
    message: IAgentMessage
  ): Promise<IAgentResponse> {
    switch (message.type) {
      case InventoryMessageType.CHECK_STOCK:
        return this.checkStock(message.payload);

      case InventoryMessageType.UPDATE_STOCK:
        return this.updateStock(message.payload);

      case InventoryMessageType.ADJUST_STOCK:
        return this.adjustStock(message.payload);

      case InventoryMessageType.LOW_STOCK_ALERT:
        return this.getLowStockAlerts();

      case InventoryMessageType.REORDER_SUGGESTION:
        return this.getReorderSuggestions();

      case InventoryMessageType.STOCK_AUDIT:
        return this.performStockAudit();

      case InventoryMessageType.BULK_UPDATE:
        return this.bulkUpdateStock(message.payload);

      case InventoryMessageType.STOCK_TRANSFER:
        return this.transferStock(message.payload);

      default:
        return {
          success: false,
          error: `Unknown message type: ${message.type}`,
        };
    }
  }

  /**
   * Check stock level for a product
   */
  async checkStock(request: IStockCheckRequest): Promise<IAgentResponse> {
    try {
      const product = await this.productRepository.findById(request.productId);

      if (!product) {
        return {
          success: false,
          error: `Product not found: ${request.productId}`,
        };
      }

      return {
        success: true,
        data: {
          productId: product.id,
          productName: product.name,
          currentStock: product.stock,
          lowStockThreshold: product.lowStockThreshold,
          isLowStock: product.stock <= product.lowStockThreshold,
          isOutOfStock: product.stock === 0,
        },
        metadata: {
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update stock quantity
   */
  async updateStock(request: IStockUpdateRequest): Promise<IAgentResponse> {
    try {
      const product = await this.productRepository.findById(request.productId);

      if (!product) {
        return {
          success: false,
          error: `Product not found: ${request.productId}`,
        };
      }

      // Update stock
      await this.productRepository.updateStock(
        request.productId,
        request.quantity
      );

      // Check if low stock alert needed
      if (request.quantity <= product.lowStockThreshold) {
        this._lowStockAlerts$.next({
          productId: product.id,
          currentStock: request.quantity,
          threshold: product.lowStockThreshold,
          reorderQuantity: product.reorderQuantity || 0,
        });
      }

      return {
        success: true,
        data: {
          productId: request.productId,
          previousStock: product.stock,
          newStock: request.quantity,
          reason: request.reason,
        },
        metadata: {
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Adjust stock with reason
   */
  async adjustStock(
    request: IStockAdjustmentRequest
  ): Promise<IAgentResponse> {
    try {
      const product = await this.productRepository.findById(request.productId);

      if (!product) {
        return {
          success: false,
          error: `Product not found: ${request.productId}`,
        };
      }

      // Adjust stock
      await this.productRepository.adjustStock(
        request.productId,
        request.adjustment
      );

      const newStock = product.stock + request.adjustment;

      // Check if low stock alert needed
      if (newStock <= product.lowStockThreshold) {
        this._lowStockAlerts$.next({
          productId: product.id,
          currentStock: newStock,
          threshold: product.lowStockThreshold,
          reorderQuantity: product.reorderQuantity || 0,
        });
      }

      return {
        success: true,
        data: {
          productId: request.productId,
          previousStock: product.stock,
          adjustment: request.adjustment,
          newStock,
          reason: request.reason,
        },
        metadata: {
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get low stock alerts
   */
  async getLowStockAlerts(): Promise<IAgentResponse> {
    try {
      const lowStockProducts = await this.productRepository.findLowStock();

      const alerts: ILowStockAlert[] = lowStockProducts.map((product) => ({
        productId: product.id,
        currentStock: product.stock,
        threshold: product.lowStockThreshold,
        reorderQuantity: product.reorderQuantity || 0,
      }));

      return {
        success: true,
        data: alerts,
        metadata: {
          count: alerts.length,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get reorder suggestions
   */
  async getReorderSuggestions(): Promise<IAgentResponse> {
    try {
      const lowStockProducts = await this.productRepository.findLowStock();

      const suggestions: IReorderSuggestion[] = lowStockProducts.map(
        (product) => {
          const stockRatio = product.stock / product.lowStockThreshold;
          let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

          if (product.stock === 0) {
            priority = 'HIGH';
          } else if (stockRatio < 0.5) {
            priority = 'HIGH';
          } else if (stockRatio < 1) {
            priority = 'MEDIUM';
          }

          return {
            productId: product.id,
            productName: product.name,
            currentStock: product.stock,
            averageDailySales: 0, // TODO: Calculate from transaction history
            suggestedQuantity: product.reorderQuantity || product.lowStockThreshold * 2,
            priority,
          };
        }
      );

      // Sort by priority
      suggestions.sort((a, b) => {
        const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      return {
        success: true,
        data: suggestions,
        metadata: {
          count: suggestions.length,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Perform stock audit
   */
  async performStockAudit(): Promise<IAgentResponse> {
    try {
      const allProducts = await this.productRepository.findAll();
      const lowStockProducts = await this.productRepository.findLowStock();

      const outOfStockProducts = allProducts.filter((p) => p.stock === 0);

      const totalValue = allProducts.reduce(
        (sum, product) => sum + product.price * product.stock,
        0
      );

      const alerts: ILowStockAlert[] = lowStockProducts.map((product) => ({
        productId: product.id,
        currentStock: product.stock,
        threshold: product.lowStockThreshold,
        reorderQuantity: product.reorderQuantity || 0,
      }));

      const suggestions: IReorderSuggestion[] = lowStockProducts.map(
        (product) => ({
          productId: product.id,
          productName: product.name,
          currentStock: product.stock,
          averageDailySales: 0,
          suggestedQuantity: product.reorderQuantity || product.lowStockThreshold * 2,
          priority: product.stock === 0 ? 'HIGH' : 'MEDIUM',
        })
      );

      const auditResult: IStockAuditResult = {
        totalProducts: allProducts.length,
        lowStockProducts: lowStockProducts.length,
        outOfStockProducts: outOfStockProducts.length,
        totalValue,
        alerts,
        suggestions,
      };

      return {
        success: true,
        data: auditResult,
        metadata: {
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Bulk update stock levels
   */
  async bulkUpdateStock(request: IBulkStockUpdate): Promise<IAgentResponse> {
    try {
      const results = [];

      for (const update of request.updates) {
        const result = await this.updateStock({
          productId: update.productId,
          quantity: update.quantity,
          reason: update.reason,
        });
        results.push(result);
      }

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;

      return {
        success: failureCount === 0,
        data: {
          total: results.length,
          successful: successCount,
          failed: failureCount,
          results,
        },
        metadata: {
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Transfer stock between locations
   */
  async transferStock(
    request: IStockTransferRequest
  ): Promise<IAgentResponse> {
    try {
      // For now, just adjust the stock
      // In a multi-location system, this would transfer between locations
      const result = await this.adjustStock({
        productId: request.productId,
        adjustment: 0, // No net change in single-location system
        reason: `Transfer from ${request.fromLocation} to ${request.toLocation}`,
        reference: request.reference,
      });

      return {
        success: result.success,
        data: {
          ...result.data,
          fromLocation: request.fromLocation,
          toLocation: request.toLocation,
          quantity: request.quantity,
        },
        metadata: {
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Subscribe to low stock alerts
   */
  subscribeLowStockAlerts(): Observable<ILowStockAlert> {
    return this._lowStockAlerts$.asObservable();
  }

  /**
   * Subscribe to reorder suggestions
   */
  subscribeReorderSuggestions(): Observable<IReorderSuggestion> {
    return this._reorderSuggestions$.asObservable();
  }

  /**
   * Monitor stock levels periodically
   */
  private async monitorStockLevels(): Promise<void> {
    try {
      const lowStockProducts = await this.productRepository.findLowStock();

      for (const product of lowStockProducts) {
        this._lowStockAlerts$.next({
          productId: product.id,
          currentStock: product.stock,
          threshold: product.lowStockThreshold,
          reorderQuantity: product.reorderQuantity || 0,
        });

        // Generate reorder suggestion for critical items
        if (product.stock <= product.lowStockThreshold * 0.5) {
          this._reorderSuggestions$.next({
            productId: product.id,
            productName: product.name,
            currentStock: product.stock,
            averageDailySales: 0,
            suggestedQuantity: product.reorderQuantity || product.lowStockThreshold * 2,
            priority: product.stock === 0 ? 'HIGH' : 'MEDIUM',
          });
        }
      }
    } catch (error) {
      console.error('Error monitoring stock levels:', error);
    }
  }
}

// Made with Bob