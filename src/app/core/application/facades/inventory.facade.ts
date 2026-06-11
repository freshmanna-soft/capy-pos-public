import { Injectable, inject, Signal } from '@angular/core';
import {
  ManageInventoryUseCase,
  ProductSummaryDTO,
  CreateProductRequest,
  UpdateProductRequest,
} from '@core/application/use-cases/manage-inventory.use-case';
import {
  GetLowStockAlertsUseCase,
  LowStockAlertsResult,
} from '@core/application/use-cases/get-low-stock-alerts.use-case';

/**
 * InventoryFacade - Single point of access for Inventory Management operations.
 *
 * Orchestrates ManageInventoryUseCase and GetLowStockAlertsUseCase behind
 * a simplified API for the InventoryManagementComponent.
 *
 * Does NOT contain business logic — delegates to use-cases.
 */
@Injectable({ providedIn: 'root' })
export class InventoryFacade {
  private readonly inventoryUseCase = inject(ManageInventoryUseCase);
  private readonly lowStockUseCase = inject(GetLowStockAlertsUseCase);

  // ─── State (read-only signals) ────────────────────────────────────────

  /** All products */
  readonly products: Signal<ProductSummaryDTO[]> = this.inventoryUseCase.products;

  /** Product categories */
  readonly categories: Signal<string[]> = this.inventoryUseCase.categories;

  /** Loading state */
  readonly loading: Signal<boolean> = this.inventoryUseCase.loading;

  /** Error state */
  readonly error: Signal<string | null> = this.inventoryUseCase.error;

  // ─── Product CRUD Operations ──────────────────────────────────────────

  /** Load all products */
  async loadProducts(): Promise<void> {
    await this.inventoryUseCase.loadProducts();
  }

  /** Create a new product */
  async createProduct(request: CreateProductRequest): Promise<ProductSummaryDTO | null> {
    return await this.inventoryUseCase.createProduct(request);
  }

  /** Update an existing product */
  async updateProduct(request: UpdateProductRequest): Promise<ProductSummaryDTO | null> {
    return await this.inventoryUseCase.updateProduct(request);
  }

  /** Delete a product by ID */
  async deleteProduct(id: string): Promise<boolean> {
    return await this.inventoryUseCase.deleteProduct(id);
  }

  /** Adjust stock for a product */
  async adjustStock(productId: string, adjustment: number): Promise<ProductSummaryDTO | null> {
    return await this.inventoryUseCase.adjustStock(productId, adjustment);
  }

  // ─── Low Stock Alerts ─────────────────────────────────────────────────

  /** Get products with low stock levels */
  async getLowStockAlerts(threshold?: number): Promise<LowStockAlertsResult> {
    return await this.lowStockUseCase.execute(threshold);
  }
}
