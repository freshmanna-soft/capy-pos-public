import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { InventoryFacade } from './inventory.facade';
import { ManageInventoryUseCase } from '@core/application/use-cases/manage-inventory.use-case';
import { GetLowStockAlertsUseCase } from '@core/application/use-cases/get-low-stock-alerts.use-case';

describe('InventoryFacade', () => {
  let facade: InventoryFacade;
  let mockInventoryUseCase: {
    products: ReturnType<typeof signal>;
    loading: ReturnType<typeof signal>;
    error: ReturnType<typeof signal>;
    loadProducts: ReturnType<typeof vi.fn>;
    createProduct: ReturnType<typeof vi.fn>;
    updateProduct: ReturnType<typeof vi.fn>;
    deleteProduct: ReturnType<typeof vi.fn>;
    adjustStock: ReturnType<typeof vi.fn>;
  };
  let mockLowStockUseCase: {
    execute: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockInventoryUseCase = {
      products: signal([]),
      loading: signal(false),
      error: signal(null),
      loadProducts: vi.fn().mockResolvedValue([]),
      createProduct: vi.fn().mockResolvedValue({ id: 'new-1', name: 'New Product' }),
      updateProduct: vi.fn().mockResolvedValue({ id: 'prod-1', name: 'Updated' }),
      deleteProduct: vi.fn().mockResolvedValue(true),
      adjustStock: vi.fn().mockResolvedValue({ id: 'prod-1', stock: 15 }),
    };

    mockLowStockUseCase = {
      execute: vi.fn().mockResolvedValue({
        alerts: [],
        totalCount: 0,
        criticalCount: 0,
        warningCount: 0,
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        InventoryFacade,
        { provide: ManageInventoryUseCase, useValue: mockInventoryUseCase },
        { provide: GetLowStockAlertsUseCase, useValue: mockLowStockUseCase },
      ],
    });

    facade = TestBed.inject(InventoryFacade);
  });

  describe('creation', () => {
    it('should be created', () => {
      expect(facade).toBeTruthy();
    });
  });

  describe('state delegation', () => {
    it('should expose products from ManageInventoryUseCase', () => {
      expect(facade.products()).toEqual([]);
    });

    it('should expose loading from ManageInventoryUseCase', () => {
      expect(facade.loading()).toBe(false);
    });

    it('should expose error from ManageInventoryUseCase', () => {
      expect(facade.error()).toBeNull();
    });
  });

  describe('product CRUD operations', () => {
    it('should delegate loadProducts to use case', async () => {
      await facade.loadProducts();
      expect(mockInventoryUseCase.loadProducts).toHaveBeenCalled();
    });

    it('should delegate createProduct to use case', async () => {
      const request = {
        name: 'Test Product',
        sku: 'TST-001',
        category: 'Test',
        price: 9.99,
        cost: 5.0,
        stock: 100,
      };
      await facade.createProduct(request);
      expect(mockInventoryUseCase.createProduct).toHaveBeenCalledWith(request);
    });

    it('should delegate updateProduct to use case', async () => {
      const request = { id: 'prod-1', name: 'Updated Name', price: 12.99 };
      await facade.updateProduct(request);
      expect(mockInventoryUseCase.updateProduct).toHaveBeenCalledWith(request);
    });

    it('should delegate deleteProduct to use case', async () => {
      await facade.deleteProduct('prod-1');
      expect(mockInventoryUseCase.deleteProduct).toHaveBeenCalledWith('prod-1');
    });

    it('should delegate adjustStock to use case', async () => {
      await facade.adjustStock('prod-1', 5);
      expect(mockInventoryUseCase.adjustStock).toHaveBeenCalledWith('prod-1', 5);
    });

    it('should delegate adjustStock with negative adjustment', async () => {
      await facade.adjustStock('prod-1', -3);
      expect(mockInventoryUseCase.adjustStock).toHaveBeenCalledWith('prod-1', -3);
    });
  });

  describe('low stock alerts', () => {
    it('should delegate getLowStockAlerts to GetLowStockAlertsUseCase', async () => {
      const result = await facade.getLowStockAlerts();
      expect(mockLowStockUseCase.execute).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({
        alerts: [],
        totalCount: 0,
        criticalCount: 0,
        warningCount: 0,
      });
    });

    it('should pass custom threshold to getLowStockAlerts', async () => {
      await facade.getLowStockAlerts(15);
      expect(mockLowStockUseCase.execute).toHaveBeenCalledWith(15);
    });

    it('should return alerts when products are below threshold', async () => {
      const mockResult = {
        alerts: [
          {
            productId: 'p1',
            productName: 'Low Item',
            currentStock: 2,
            threshold: 10,
            category: 'Food',
            severity: 'critical' as const,
          },
        ],
        totalCount: 1,
        criticalCount: 1,
        warningCount: 0,
      };
      mockLowStockUseCase.execute.mockResolvedValue(mockResult);

      const result = await facade.getLowStockAlerts(10);
      expect(result).toEqual(mockResult);
    });
  });
});
