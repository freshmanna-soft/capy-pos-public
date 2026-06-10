import { TestBed } from '@angular/core/testing';
import { GetLowStockAlertsUseCase, LowStockAlertDTO } from './get-low-stock-alerts.use-case';
import { PRODUCT_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { IProductRepository } from '@core/domain/interfaces/product.repository.interface';
import { IProduct } from '@core/domain/entities/product.entity';

describe('GetLowStockAlertsUseCase', () => {
  let useCase: GetLowStockAlertsUseCase;
  let mockProductRepository: Partial<Record<keyof IProductRepository, ReturnType<typeof vi.fn>>>;

  const createMockProduct = (overrides: Partial<IProduct> = {}): IProduct => ({
    id: 'prod-1',
    name: 'Test Product',
    description: 'A test product',
    sku: 'TST-001',
    barcode: '123456789',
    category: 'Electronics',
    price: 29.99,
    cost: 15.0,
    stock: 5,
    lowStockThreshold: 10,
    reorderQuantity: 20,
    isActive: true,
    imageUrl: '',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });

  beforeEach(() => {
    mockProductRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
        GetLowStockAlertsUseCase,
        { provide: PRODUCT_REPOSITORY, useValue: mockProductRepository },
      ],
    });

    useCase = TestBed.inject(GetLowStockAlertsUseCase);
  });

  describe('execute', () => {
    it('should return low stock products using default threshold when none provided', async () => {
      const lowStockProducts = [
        createMockProduct({ id: 'p1', name: 'Low Item 1', stock: 3 }),
        createMockProduct({ id: 'p2', name: 'Low Item 2', stock: 7 }),
      ];
      mockProductRepository['findLowStock']!.mockResolvedValue(lowStockProducts);

      await useCase.execute();

      expect(mockProductRepository['findLowStock']).toHaveBeenCalledWith(10);
    });

    it('should return low stock products using custom threshold', async () => {
      const lowStockProducts = [createMockProduct({ id: 'p1', name: 'Low Item', stock: 15 })];
      mockProductRepository['findLowStock']!.mockResolvedValue(lowStockProducts);

      await useCase.execute(20);

      expect(mockProductRepository['findLowStock']).toHaveBeenCalledWith(20);
    });

    it('should map products to LowStockAlertDTO', async () => {
      const lowStockProducts = [
        createMockProduct({ id: 'p1', name: 'Widget', stock: 3, category: 'Tools' }),
        createMockProduct({ id: 'p2', name: 'Gadget', stock: 0, category: 'Electronics' }),
      ];
      mockProductRepository['findLowStock']!.mockResolvedValue(lowStockProducts);

      const result = await useCase.execute(10);

      expect(result.alerts).toHaveLength(2);
      expect(result.alerts[0]).toEqual<LowStockAlertDTO>({
        productId: 'p2',
        productName: 'Gadget',
        currentStock: 0,
        threshold: 10,
        category: 'Electronics',
        severity: 'critical',
      });
      expect(result.alerts[1]).toEqual<LowStockAlertDTO>({
        productId: 'p1',
        productName: 'Widget',
        currentStock: 3,
        threshold: 10,
        category: 'Tools',
        severity: 'warning',
      });
    });

    it('should classify severity as critical when stock is 0', async () => {
      const products = [createMockProduct({ stock: 0 })];
      mockProductRepository['findLowStock']!.mockResolvedValue(products);

      const result = await useCase.execute(10);

      expect(result.alerts[0].severity).toBe('critical');
    });

    it('should classify severity as warning when stock is above 0 but below threshold', async () => {
      const products = [createMockProduct({ stock: 5 })];
      mockProductRepository['findLowStock']!.mockResolvedValue(products);

      const result = await useCase.execute(10);

      expect(result.alerts[0].severity).toBe('warning');
    });

    it('should return total count of low stock items', async () => {
      const products = [
        createMockProduct({ id: 'p1', stock: 2 }),
        createMockProduct({ id: 'p2', stock: 5 }),
        createMockProduct({ id: 'p3', stock: 0 }),
      ];
      mockProductRepository['findLowStock']!.mockResolvedValue(products);

      const result = await useCase.execute(10);

      expect(result.totalCount).toBe(3);
    });

    it('should return critical count (out of stock items)', async () => {
      const products = [
        createMockProduct({ id: 'p1', stock: 2 }),
        createMockProduct({ id: 'p2', stock: 0 }),
        createMockProduct({ id: 'p3', stock: 0 }),
      ];
      mockProductRepository['findLowStock']!.mockResolvedValue(products);

      const result = await useCase.execute(10);

      expect(result.criticalCount).toBe(2);
    });

    it('should return warning count (low but not zero)', async () => {
      const products = [
        createMockProduct({ id: 'p1', stock: 2 }),
        createMockProduct({ id: 'p2', stock: 0 }),
        createMockProduct({ id: 'p3', stock: 5 }),
      ];
      mockProductRepository['findLowStock']!.mockResolvedValue(products);

      const result = await useCase.execute(10);

      expect(result.warningCount).toBe(2);
    });

    it('should return empty result when no products are below threshold', async () => {
      mockProductRepository['findLowStock']!.mockResolvedValue([]);

      const result = await useCase.execute(10);

      expect(result.alerts).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.criticalCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });

    it('should set loading state while executing', async () => {
      mockProductRepository['findLowStock']!.mockResolvedValue([]);

      expect(useCase.loading()).toBe(false);

      const promise = useCase.execute(10);
      expect(useCase.loading()).toBe(true);

      await promise;
      expect(useCase.loading()).toBe(false);
    });

    it('should set error state on failure', async () => {
      mockProductRepository['findLowStock']!.mockRejectedValue(new Error('DB connection failed'));

      const result = await useCase.execute(10);

      expect(useCase.error()).toBe('Failed to fetch low stock alerts');
      expect(result.alerts).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('should clear error on successful execution', async () => {
      mockProductRepository['findLowStock']!.mockRejectedValueOnce(new Error('fail'));
      await useCase.execute(10);
      expect(useCase.error()).toBeTruthy();

      mockProductRepository['findLowStock']!.mockResolvedValueOnce([]);
      await useCase.execute(10);
      expect(useCase.error()).toBeNull();
    });

    it('should sort alerts by severity (critical first, then by stock ascending)', async () => {
      const products = [
        createMockProduct({ id: 'p1', name: 'A', stock: 5 }),
        createMockProduct({ id: 'p2', name: 'B', stock: 0 }),
        createMockProduct({ id: 'p3', name: 'C', stock: 2 }),
      ];
      mockProductRepository['findLowStock']!.mockResolvedValue(products);

      const result = await useCase.execute(10);

      expect(result.alerts[0].productName).toBe('B'); // critical (0)
      expect(result.alerts[1].productName).toBe('C'); // warning (2)
      expect(result.alerts[2].productName).toBe('A'); // warning (5)
    });
  });

  describe('alertCount', () => {
    it('should return cached count from last execution', async () => {
      const products = [
        createMockProduct({ id: 'p1', stock: 2 }),
        createMockProduct({ id: 'p2', stock: 5 }),
      ];
      mockProductRepository['findLowStock']!.mockResolvedValue(products);

      await useCase.execute(10);

      expect(useCase.alertCount()).toBe(2);
    });

    it('should return 0 before first execution', () => {
      expect(useCase.alertCount()).toBe(0);
    });
  });
});
