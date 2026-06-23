import { Injectable, inject, signal, computed } from '@angular/core';
import { IProductRepository } from '@core/domain/interfaces/product.repository.interface';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { Product } from '@core/domain/entities/product.entity';
import { generateUUID } from '@core/domain/utils/uuid';
import { EntityNotFoundException } from '@core/domain/exceptions';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import { Permission } from '@core/domain/auth/permission.constants';

/**
 * DTO for creating a new product
 */
export interface CreateProductRequest {
  name: string;
  sku: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  description?: string;
  emoji?: string;
  barcode?: string;
  lowStockThreshold?: number;
  reorderQuantity?: number;
}

/**
 * DTO for updating an existing product
 */
export interface UpdateProductRequest {
  id: string;
  name?: string;
  sku?: string;
  category?: string;
  price?: number;
  cost?: number;
  stock?: number;
  description?: string;
  emoji?: string;
  barcode?: string;
  lowStockThreshold?: number;
  reorderQuantity?: number;
  isActive?: boolean;
}

/**
 * DTO for product list filtering
 */
export interface ProductFilterRequest {
  searchQuery?: string;
  category?: string;
  stockStatus?: 'critical' | 'warning' | 'healthy' | '';
}

/**
 * Product summary DTO for the inventory list
 */
export interface ProductSummaryDTO {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  emoji: string;
  isActive: boolean;
  lowStockThreshold: number;
  description: string;
  barcode: string;
}

/**
 * Manage Inventory Use Case
 *
 * Application layer use case responsible for full CRUD operations
 * on the product inventory. Provides reactive state via signals.
 *
 * Operations:
 * - loadProducts: Fetch all active products from repository
 * - createProduct: Add a new product to inventory
 * - updateProduct: Modify an existing product
 * - deleteProduct: Soft-delete a product
 * - adjustStock: Increment/decrement stock for a product
 *
 * @example
 * ```typescript
 * const useCase = inject(ManageInventoryUseCase);
 * await useCase.loadProducts();
 * const products = useCase.products();
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class ManageInventoryUseCase {
  private readonly productRepository: IProductRepository =
    inject<IProductRepository>(PRODUCT_REPOSITORY);
  private readonly authz = inject(AngularAuthorizationService);

  /** Loading state signal */
  private readonly _loading = signal<boolean>(false);

  /** Error state signal */
  private readonly _error = signal<string | null>(null);

  /** Products state signal */
  private readonly _products = signal<ProductSummaryDTO[]>([]);

  /** Categories state signal */
  private readonly _categories = signal<string[]>([]);

  /** Public readonly signals */
  readonly loading = computed(() => this._loading());
  readonly error = computed(() => this._error());
  readonly products = computed(() => this._products());
  readonly categories = computed(() => this._categories());

  /**
   * Loads all active products from the repository
   */
  async loadProducts(): Promise<ProductSummaryDTO[]> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const products = await this.productRepository.findActive();
      const summaries = products.map((p) => this.mapToSummary(p));
      this._products.set(summaries);

      const categories = await this.productRepository.getCategories();
      this._categories.set(categories);

      this._loading.set(false);
      return summaries;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load products';
      this._error.set(message);
      this._loading.set(false);
      return [];
    }
  }

  /**
   * Creates a new product in the inventory
   */
  async createProduct(request: CreateProductRequest): Promise<ProductSummaryDTO | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const id = generateUUID();
      const product = new Product(
        id,
        request.name,
        request.price,
        request.sku,
        request.category,
        request.stock,
        request.description,
        undefined,
        request.barcode,
        request.emoji,
        request.lowStockThreshold ?? 10,
        request.reorderQuantity ?? 20,
        request.cost,
        true
      );

      const created = await this.productRepository.create(product);
      const summary = this.mapToSummary(created);

      this._products.update((current) => [...current, summary]);

      // Refresh categories in case a new one was added
      const categories = await this.productRepository.getCategories();
      this._categories.set(categories);

      this._loading.set(false);
      return summary;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create product';
      this._error.set(message);
      this._loading.set(false);
      return null;
    }
  }

  /**
   * Updates an existing product
   */
  async updateProduct(request: UpdateProductRequest): Promise<ProductSummaryDTO | null> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const existing = await this.productRepository.findById(request.id);
      if (!existing) {
        throw new EntityNotFoundException('Product', request.id);
      }

      // Apply updates using field mapping to reduce complexity
      this.applyProductUpdates(existing, request);

      existing.updatedAt = new Date();

      const updated = await this.productRepository.update(request.id, existing);
      const summary = this.mapToSummary(updated);

      this._products.update((current) => current.map((p) => (p.id === summary.id ? summary : p)));

      // Refresh categories
      const categories = await this.productRepository.getCategories();
      this._categories.set(categories);

      this._loading.set(false);
      return summary;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update product';
      this._error.set(message);
      this._loading.set(false);
      return null;
    }
  }

  /**
   * Deletes a product (soft delete)
   */
  async deleteProduct(productId: string): Promise<boolean> {
    this._loading.set(true);
    this._error.set(null);

    try {
      await this.productRepository.delete(productId);
      this._products.update((current) => current.filter((p) => p.id !== productId));

      // Refresh categories
      const categories = await this.productRepository.getCategories();
      this._categories.set(categories);

      this._loading.set(false);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to delete product';
      this._error.set(message);
      this._loading.set(false);
      return false;
    }
  }

  /**
   * Adjusts stock for a product (increment/decrement).
   *
   * Authorization: requires ADJUST_STOCK permission (Manager/Admin only).
   * Throws AuthorizationError when an Operator attempts this operation.
   * The caller (InventoryFacade / component) is responsible for surfacing
   * the error to the user via ToastService.
   */
  async adjustStock(productId: string, adjustment: number): Promise<ProductSummaryDTO | null> {
    // Enforce at the use-case layer — will throw AuthorizationError for Operators
    this.authz.assert(Permission.ADJUST_STOCK);

    this._error.set(null);

    try {
      const updated = await this.productRepository.adjustStock(productId, adjustment);
      const summary = this.mapToSummary(updated);

      this._products.update((current) => current.map((p) => (p.id === summary.id ? summary : p)));

      return summary;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to adjust stock';
      this._error.set(message);
      return null;
    }
  }

  /**
   * Applies partial updates from the request to the existing product entity
   */
  private applyProductUpdates(existing: Product, request: UpdateProductRequest): void {
    const updatableFields: (keyof UpdateProductRequest)[] = [
      'name',
      'sku',
      'category',
      'price',
      'cost',
      'stock',
      'description',
      'emoji',
      'barcode',
      'lowStockThreshold',
      'reorderQuantity',
      'isActive',
    ];
    for (const field of updatableFields) {
      if (request[field] !== undefined) {
        (existing as unknown as Record<string, unknown>)[field] = request[field];
      }
    }
  }

  /**
   * Maps a Product entity to a ProductSummaryDTO
   */
  private mapToSummary(product: Product): ProductSummaryDTO {
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      price: product.price,
      cost: product.cost,
      stock: product.stock,
      emoji: product.emoji ?? '📦',
      isActive: product.isActive,
      lowStockThreshold: product.lowStockThreshold,
      description: product.description ?? '',
      barcode: product.barcode ?? '',
    };
  }
}
