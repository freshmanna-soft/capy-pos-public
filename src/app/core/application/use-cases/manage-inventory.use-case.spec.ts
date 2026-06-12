import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import {
  ManageInventoryUseCase,
  CreateProductRequest,
  UpdateProductRequest,
} from './manage-inventory.use-case';
import { Product } from '@core/domain/entities/product.entity';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';

describe('ManageInventoryUseCase', () => {
  let useCase: ManageInventoryUseCase;
  let mockRepository: Record<string, Mock>;

  const createMockProduct = (overrides: Partial<Product> = {}): Product => {
    return new Product(
      overrides.id ?? 'prod-1',
      overrides.name ?? 'Test Coffee',
      overrides.price ?? 4.5,
      overrides.sku ?? 'SKU-001',
      overrides.category ?? 'Beverages',
      overrides.stock ?? 50,
      overrides.description ?? 'A test product',
      overrides.imageUrl,
      overrides.barcode ?? 'BAR-001',
      overrides.emoji ?? '☕',
      overrides.lowStockThreshold ?? 10,
      overrides.reorderQuantity ?? 20,
      overrides.cost ?? 2.0,
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
        ManageInventoryUseCase,
        { provide: PRODUCT_REPOSITORY, useValue: mockRepository },
      ],
    });

    useCase = TestBed.inject(ManageInventoryUseCase);
  });

  describe('loadProducts', () => {
    it('should load all active products and set state', async () => {
      const products = [
        createMockProduct({ id: 'p1', name: 'Coffee' }),
        createMockProduct({ id: 'p2', name: 'Tea', category: 'Beverages' }),
      ];
      mockRepository['findActive'].mockResolvedValue(products);
      mockRepository['getCategories'].mockResolvedValue(['Beverages']);

      const result = await useCase.loadProducts();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Coffee');
      expect(result[1].name).toBe('Tea');
      expect(useCase.products()).toHaveLength(2);
      expect(useCase.categories()).toEqual(['Beverages']);
      expect(useCase.loading()).toBe(false);
      expect(useCase.error()).toBeNull();
    });

    it('should set loading state during execution', async () => {
      mockRepository['findActive'].mockImplementation(async () => {
        expect(useCase.loading()).toBe(true);
        return [];
      });
      mockRepository['getCategories'].mockResolvedValue([]);

      await useCase.loadProducts();

      expect(useCase.loading()).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      mockRepository['findActive'].mockRejectedValue(new Error('DB connection failed'));

      const result = await useCase.loadProducts();

      expect(result).toEqual([]);
      expect(useCase.error()).toBe('DB connection failed');
      expect(useCase.loading()).toBe(false);
    });

    it('should handle non-Error exceptions', async () => {
      mockRepository['findActive'].mockRejectedValue('unknown error');

      const result = await useCase.loadProducts();

      expect(result).toEqual([]);
      expect(useCase.error()).toBe('Failed to load products');
    });
  });

  describe('createProduct', () => {
    const validRequest: CreateProductRequest = {
      name: 'New Product',
      sku: 'SKU-NEW',
      category: 'Food',
      price: 9.99,
      cost: 5.0,
      stock: 100,
      description: 'A new product',
      emoji: '🍕',
      barcode: 'BAR-NEW',
    };

    it('should create a product and add to state', async () => {
      const createdProduct = createMockProduct({
        id: 'new-id',
        name: 'New Product',
        sku: 'SKU-NEW',
        category: 'Food',
        price: 9.99,
        stock: 100,
      });
      mockRepository['create'].mockResolvedValue(createdProduct);
      mockRepository['getCategories'].mockResolvedValue(['Beverages', 'Food']);

      const result = await useCase.createProduct(validRequest);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('New Product');
      expect(result?.sku).toBe('SKU-NEW');
      expect(mockRepository['create']).toHaveBeenCalledTimes(1);
      expect(useCase.products()).toHaveLength(1);
      expect(useCase.categories()).toEqual(['Beverages', 'Food']);
    });

    it('should use default lowStockThreshold and reorderQuantity', async () => {
      const requestWithoutDefaults: CreateProductRequest = {
        name: 'Simple',
        sku: 'SKU-S',
        category: 'Food',
        price: 5.0,
        cost: 2.0,
        stock: 10,
      };
      mockRepository['create'].mockImplementation(async (product: Product) => {
        expect(product.lowStockThreshold).toBe(10);
        expect(product.reorderQuantity).toBe(20);
        return product;
      });
      mockRepository['getCategories'].mockResolvedValue(['Food']);

      await useCase.createProduct(requestWithoutDefaults);

      expect(mockRepository['create']).toHaveBeenCalledTimes(1);
    });

    it('should handle validation errors from Product entity', async () => {
      const invalidRequest: CreateProductRequest = {
        name: '',
        sku: 'SKU-X',
        category: 'Food',
        price: 5.0,
        cost: 2.0,
        stock: 10,
      };

      const result = await useCase.createProduct(invalidRequest);

      expect(result).toBeNull();
      expect(useCase.error()).toBe('Product name is required');
    });

    it('should handle repository errors', async () => {
      mockRepository['create'].mockRejectedValue(new Error('Duplicate SKU'));

      const result = await useCase.createProduct(validRequest);

      expect(result).toBeNull();
      expect(useCase.error()).toBe('Duplicate SKU');
      expect(useCase.loading()).toBe(false);
    });
  });

  describe('updateProduct', () => {
    it('should update a product and refresh state', async () => {
      const existing = createMockProduct({ id: 'p1', name: 'Old Name', price: 5.0 });
      const updatedProduct = createMockProduct({ id: 'p1', name: 'New Name', price: 7.0 });

      mockRepository['findById'].mockResolvedValue(existing);
      mockRepository['update'].mockResolvedValue(updatedProduct);
      mockRepository['getCategories'].mockResolvedValue(['Beverages']);

      // Pre-populate state
      mockRepository['findActive'].mockResolvedValue([existing]);
      await useCase.loadProducts();

      const request: UpdateProductRequest = { id: 'p1', name: 'New Name', price: 7.0 };
      const result = await useCase.updateProduct(request);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('New Name');
      expect(result?.price).toBe(7.0);
      expect(useCase.products()[0].name).toBe('New Name');
    });

    it('should return null if product not found', async () => {
      mockRepository['findById'].mockResolvedValue(null);

      const request: UpdateProductRequest = { id: 'nonexistent', name: 'X' };
      const result = await useCase.updateProduct(request);

      expect(result).toBeNull();
      expect(useCase.error()).toBe("Product with id 'nonexistent' not found");
    });

    it('should only update provided fields', async () => {
      const existing = createMockProduct({ id: 'p1', name: 'Coffee', price: 4.5, stock: 50 });
      mockRepository['findById'].mockResolvedValue(existing);
      mockRepository['update'].mockImplementation(async (_id: string, data: Partial<Product>) => {
        return data as Product;
      });
      mockRepository['getCategories'].mockResolvedValue(['Beverages']);

      const request: UpdateProductRequest = { id: 'p1', price: 6.0 };
      await useCase.updateProduct(request);

      const updateCall = mockRepository['update'].mock.calls[0];
      expect(updateCall[0]).toBe('p1');
      const updatedEntity = updateCall[1] as Product;
      expect(updatedEntity.name).toBe('Coffee');
      expect(updatedEntity.price).toBe(6.0);
      expect(updatedEntity.stock).toBe(50);
    });

    it('should handle repository errors', async () => {
      mockRepository['findById'].mockRejectedValue(new Error('Connection lost'));

      const result = await useCase.updateProduct({ id: 'p1', name: 'X' });

      expect(result).toBeNull();
      expect(useCase.error()).toBe('Connection lost');
    });
  });

  describe('deleteProduct', () => {
    it('should delete a product and remove from state', async () => {
      const product = createMockProduct({ id: 'p1' });
      mockRepository['findActive'].mockResolvedValue([product]);
      mockRepository['getCategories'].mockResolvedValue(['Beverages']);
      await useCase.loadProducts();

      mockRepository['delete'].mockResolvedValue(undefined);

      const result = await useCase.deleteProduct('p1');

      expect(result).toBe(true);
      expect(useCase.products()).toHaveLength(0);
      expect(mockRepository['delete']).toHaveBeenCalledWith('p1');
    });

    it('should handle errors during deletion', async () => {
      mockRepository['delete'].mockRejectedValue(new Error('Cannot delete'));
      mockRepository['getCategories'].mockResolvedValue([]);

      const result = await useCase.deleteProduct('p1');

      expect(result).toBe(false);
      expect(useCase.error()).toBe('Cannot delete');
    });
  });

  describe('adjustStock', () => {
    it('should increment stock for a product', async () => {
      const updatedProduct = createMockProduct({ id: 'p1', stock: 55 });
      mockRepository['adjustStock'].mockResolvedValue(updatedProduct);

      // Pre-populate state
      const original = createMockProduct({ id: 'p1', stock: 50 });
      mockRepository['findActive'].mockResolvedValue([original]);
      mockRepository['getCategories'].mockResolvedValue(['Beverages']);
      await useCase.loadProducts();

      const result = await useCase.adjustStock('p1', 5);

      expect(result).not.toBeNull();
      expect(result?.stock).toBe(55);
      expect(useCase.products()[0].stock).toBe(55);
      expect(mockRepository['adjustStock']).toHaveBeenCalledWith('p1', 5);
    });

    it('should decrement stock for a product', async () => {
      const updatedProduct = createMockProduct({ id: 'p1', stock: 45 });
      mockRepository['adjustStock'].mockResolvedValue(updatedProduct);

      const original = createMockProduct({ id: 'p1', stock: 50 });
      mockRepository['findActive'].mockResolvedValue([original]);
      mockRepository['getCategories'].mockResolvedValue(['Beverages']);
      await useCase.loadProducts();

      const result = await useCase.adjustStock('p1', -5);

      expect(result).not.toBeNull();
      expect(result?.stock).toBe(45);
    });

    it('should handle insufficient stock error', async () => {
      mockRepository['adjustStock'].mockRejectedValue(new Error('Insufficient stock'));

      const result = await useCase.adjustStock('p1', -100);

      expect(result).toBeNull();
      expect(useCase.error()).toBe('Insufficient stock');
    });
  });
});
