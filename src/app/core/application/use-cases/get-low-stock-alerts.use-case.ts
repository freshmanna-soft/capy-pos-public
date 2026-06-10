import { Injectable, inject, signal } from '@angular/core';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { IProductRepository } from '@core/domain/interfaces/product.repository.interface';

/**
 * Low Stock Alert DTO
 * Represents a single product alert with severity classification
 */
export interface LowStockAlertDTO {
  productId: string;
  productName: string;
  currentStock: number;
  threshold: number;
  category: string;
  severity: 'critical' | 'warning';
}

/**
 * Low Stock Alerts Result
 * Aggregated result from the use case execution
 */
export interface LowStockAlertsResult {
  alerts: LowStockAlertDTO[];
  totalCount: number;
  criticalCount: number;
  warningCount: number;
}

/**
 * GetLowStockAlertsUseCase
 *
 * Application layer use case that queries products below a configurable
 * stock threshold and returns classified alerts (critical/warning).
 *
 * Follows Clean Architecture: depends only on domain interfaces.
 * Uses Angular signals for reactive state management.
 */
@Injectable({
  providedIn: 'root',
})
export class GetLowStockAlertsUseCase {
  private readonly productRepository = inject<IProductRepository>(PRODUCT_REPOSITORY);

  private readonly DEFAULT_THRESHOLD = 10;

  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _alertCount = signal(0);

  /** Whether the use case is currently executing */
  readonly loading = this._loading.asReadonly();

  /** Error message from last execution, or null */
  readonly error = this._error.asReadonly();

  /** Cached alert count from last execution */
  readonly alertCount = this._alertCount.asReadonly();

  /**
   * Execute the use case to fetch low stock alerts
   * @param threshold - Stock level threshold (default: 10)
   * @returns Aggregated low stock alerts result
   */
  async execute(threshold?: number): Promise<LowStockAlertsResult> {
    const effectiveThreshold = threshold ?? this.DEFAULT_THRESHOLD;

    this._loading.set(true);
    this._error.set(null);

    try {
      const products = await this.productRepository.findLowStock(effectiveThreshold);

      const alerts: LowStockAlertDTO[] = products.map((product) => ({
        productId: product.id,
        productName: product.name,
        currentStock: product.stock,
        threshold: effectiveThreshold,
        category: product.category,
        severity: product.stock === 0 ? ('critical' as const) : ('warning' as const),
      }));

      // Sort: critical first, then by stock ascending
      alerts.sort((a, b) => {
        if (a.severity === 'critical' && b.severity !== 'critical') return -1;
        if (a.severity !== 'critical' && b.severity === 'critical') return 1;
        return a.currentStock - b.currentStock;
      });

      const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
      const warningCount = alerts.filter((a) => a.severity === 'warning').length;

      this._alertCount.set(alerts.length);
      this._loading.set(false);

      return {
        alerts,
        totalCount: alerts.length,
        criticalCount,
        warningCount,
      };
    } catch {
      this._error.set('Failed to fetch low stock alerts');
      this._loading.set(false);
      this._alertCount.set(0);

      return {
        alerts: [],
        totalCount: 0,
        criticalCount: 0,
        warningCount: 0,
      };
    }
  }
}
