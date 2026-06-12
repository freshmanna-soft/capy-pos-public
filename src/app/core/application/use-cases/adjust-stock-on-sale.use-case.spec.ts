import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { AdjustStockOnSaleUseCase, StockAdjustmentItem } from './adjust-stock-on-sale.use-case';
import { Product } from '@core/domain/entities/product.entity';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';

describe('AdjustStockOnSaleUseCase', () => {
  let useCase: AdjustStockOnSaleUseCase;
  let mockRepository: Record<string, Mock>;

  const createMockProduct = (overrides: Partial<Product> = {}): Product => {
    return new Product(
      overrides.id ?? 'prod-1',
      overrides.name ?? 'Coffee Beans',
      overrides.price ?? 12.99,
      overrides.sku ?? 'SKU-001',
      overrides.category ?? 'Beverages',
      overrides.stock ?? 50,
      overrides.description ?? 'Premium coffee beans',
      overrides.imageUrl,
      overrides.barcode ?? 'BAR-001',
      overrides.emoji ?? '☕',
      overrides.lowStockThreshold ?? 10,
      overrides.reorderQuantity ?? 20,
      overrides.cost ?? 8.0,
      overrides.isActive ?? true
    );
  };

  beforeEach(() => {
    mockRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      count: vi.fn(),
      bulkCreate: vi.fn(),
      bulkUpdate: vi.fn(),
      findByCategory: vi.fn(),
      findActive: vi.fn(),
      search: vi.fn(),
      findLowStock: vi.fn(),
      updateStock: vi.fn(),
      adjustStock: vi.fn(),
      updatePrice: vi.fn(),
      getCategories: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        AdjustStockOnSaleUseCase,
        { provide: PRODUCT_REPOSITORY, useValue: mockRepository },
      ],
    });

    useCase = TestBed.inject(AdjustStockOnSaleUseCase);
  });

  describe('execute', () => {
    it('should decrease stock for a single product', async () => {
      const items: StockAdjustmentItem[] = [{ productId: 'prod-1', quantity: 3 }];

      const updatedProduct = createMockProduct({ stock: 47 });
      (mockRepository['adjustStock'] as Mock).mockResolvedValue(updatedProduct);

      const result = await useCase.execute(items);

      expect(result.success).toBe(true);
      expect(result.adjustedProducts).toHaveLength(1);
      expect(result.adjustedProducts[0].productId).toBe('prod-1');
      expect(result.adjustedProducts[0].newStock).toBe(47);
      expect(result.failedAdjustments).toHaveLength(0);
      expect(mockRepository['adjustStock']).toHaveBeenCalledWith('prod-1', -3);
    });

    it('should decrease stock for multiple products in a single transaction', async () => {
      const items: StockAdjustmentItem[] = [
        { productId: 'prod-1', quantity: 2 },
        { productId: 'prod-2', quantity: 1 },
      ];

      const updatedProductA = createMockProduct({ id: 'prod-1', stock: 18 });
      const updatedProductB = createMockProduct({ id: 'prod-2', stock: 14 });

      (mockRepository['adjustStock'] as Mock)
        .mockResolvedValueOnce(updatedProductA)
        .mockResolvedValueOnce(updatedProductB);

      const result = await useCase.execute(items);

      expect(result.success).toBe(true);
      expect(result.adjustedProducts).toHaveLength(2);
      expect(result.adjustedProducts[0].productId).toBe('prod-1');
      expect(result.adjustedProducts[0].newStock).toBe(18);
      expect(result.adjustedProducts[1].productId).toBe('prod-2');
      expect(result.adjustedProducts[1].newStock).toBe(14);
      expect(mockRepository['adjustStock']).toHaveBeenCalledWith('prod-1', -2);
      expect(mockRepository['adjustStock']).toHaveBeenCalledWith('prod-2', -1);
    });

    it('should handle partial failure gracefully', async () => {
      const items: StockAdjustmentItem[] = [
        { productId: 'prod-1', quantity: 2 },
        { productId: 'prod-2', quantity: 1 },
      ];

      const updatedProductA = createMockProduct({ id: 'prod-1', stock: 18 });
      (mockRepository['adjustStock'] as Mock)
        .mockResolvedValueOnce(updatedProductA)
        .mockRejectedValueOnce(new Error('Concurrent modification'));

      const result = await useCase.execute(items);

      expect(result.success).toBe(false);
      expect(result.adjustedProducts).toHaveLength(1);
      expect(result.failedAdjustments).toHaveLength(1);
      expect(result.failedAdjustments[0].productId).toBe('prod-2');
      expect(result.failedAdjustments[0].error).toBe('Concurrent modification');
    });

    it('should handle complete failure gracefully', async () => {
      const items: StockAdjustmentItem[] = [{ productId: 'prod-1', quantity: 5 }];

      (mockRepository['adjustStock'] as Mock).mockRejectedValue(new Error('Database error'));

      const result = await useCase.execute(items);

      expect(result.success).toBe(false);
      expect(result.adjustedProducts).toHaveLength(0);
      expect(result.failedAdjustments).toHaveLength(1);
      expect(result.failedAdjustments[0].productId).toBe('prod-1');
      expect(result.failedAdjustments[0].error).toBe('Database error');
    });

    it('should return success with empty arrays when no items provided', async () => {
      const result = await useCase.execute([]);

      expect(result.success).toBe(true);
      expect(result.adjustedProducts).toHaveLength(0);
      expect(result.failedAdjustments).toHaveLength(0);
      expect(mockRepository['adjustStock']).not.toHaveBeenCalled();
    });

    it('should pass negative adjustment values to repository', async () => {
      const items: StockAdjustmentItem[] = [{ productId: 'prod-1', quantity: 10 }];

      const updatedProduct = createMockProduct({ stock: 40 });
      (mockRepository['adjustStock'] as Mock).mockResolvedValue(updatedProduct);

      await useCase.execute(items);

      expect(mockRepository['adjustStock']).toHaveBeenCalledWith('prod-1', -10);
    });

    it('should handle stock going to zero', async () => {
      const items: StockAdjustmentItem[] = [{ productId: 'prod-1', quantity: 50 }];

      const updatedProduct = createMockProduct({ stock: 0 });
      (mockRepository['adjustStock'] as Mock).mockResolvedValue(updatedProduct);

      const result = await useCase.execute(items);

      expect(result.success).toBe(true);
      expect(result.adjustedProducts[0].newStock).toBe(0);
      expect(mockRepository['adjustStock']).toHaveBeenCalledWith('prod-1', -50);
    });

    it('should not modify items with zero quantity', async () => {
      const items: StockAdjustmentItem[] = [
        { productId: 'prod-1', quantity: 0 },
        { productId: 'prod-2', quantity: 3 },
      ];

      const updatedProduct = createMockProduct({ id: 'prod-2', stock: 12 });
      (mockRepository['adjustStock'] as Mock).mockResolvedValue(updatedProduct);

      const result = await useCase.execute(items);

      expect(result.success).toBe(true);
      expect(result.adjustedProducts).toHaveLength(1);
      expect(mockRepository['adjustStock']).toHaveBeenCalledTimes(1);
      expect(mockRepository['adjustStock']).toHaveBeenCalledWith('prod-2', -3);
    });

    it('should skip items with negative quantities', async () => {
      const items: StockAdjustmentItem[] = [{ productId: 'prod-1', quantity: -5 }];

      const result = await useCase.execute(items);

      expect(result.success).toBe(true);
      expect(result.adjustedProducts).toHaveLength(0);
      expect(result.failedAdjustments).toHaveLength(0);
      expect(mockRepository['adjustStock']).not.toHaveBeenCalled();
    });

    it('should include adjustment timestamp in result', async () => {
      const items: StockAdjustmentItem[] = [{ productId: 'prod-1', quantity: 1 }];

      const updatedProduct = createMockProduct({ stock: 49 });
      (mockRepository['adjustStock'] as Mock).mockResolvedValue(updatedProduct);

      const result = await useCase.execute(items);

      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should include quantitySold in adjusted product details', async () => {
      const items: StockAdjustmentItem[] = [{ productId: 'prod-1', quantity: 3 }];

      const updatedProduct = createMockProduct({ stock: 47 });
      (mockRepository['adjustStock'] as Mock).mockResolvedValue(updatedProduct);

      const result = await useCase.execute(items);

      expect(result.adjustedProducts[0].quantitySold).toBe(3);
    });
  });
});
