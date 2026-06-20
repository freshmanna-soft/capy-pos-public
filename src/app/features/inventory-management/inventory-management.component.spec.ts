import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryManagementComponent } from './inventory-management.component';
import { ProductSummaryDTO } from '@core/application/use-cases/manage-inventory.use-case';
import { InventoryFacade } from '@core/application/facades';
import { SyncService, PushFailedError } from '@core/infrastructure/sync';
import { AuditLogService, AuditAction, AuditStatus } from '@core/infrastructure/audit';
import { signal, computed } from '@angular/core';

describe('InventoryManagementComponent', () => {
  let component: InventoryManagementComponent;
  let fixture: ComponentFixture<InventoryManagementComponent>;
  let mockFacade: Partial<InventoryFacade>;

  const mockProducts: ProductSummaryDTO[] = [
    {
      id: 'p1',
      name: 'Coffee',
      sku: 'SKU-001',
      category: 'Beverages',
      price: 4.5,
      cost: 2,
      stock: 50,
      emoji: '☕',
      isActive: true,
      lowStockThreshold: 10,
      description: 'Fresh coffee',
      barcode: 'BAR-001',
    },
    {
      id: 'p2',
      name: 'Muffin',
      sku: 'SKU-002',
      category: 'Food',
      price: 3,
      cost: 1.5,
      stock: 3,
      emoji: '🧁',
      isActive: true,
      lowStockThreshold: 5,
      description: 'Blueberry muffin',
      barcode: 'BAR-002',
    },
    {
      id: 'p3',
      name: 'Tea',
      sku: 'SKU-003',
      category: 'Beverages',
      price: 3.5,
      cost: 1,
      stock: 15,
      emoji: '🍵',
      isActive: true,
      lowStockThreshold: 10,
      description: 'Green tea',
      barcode: 'BAR-003',
    },
  ];

  beforeEach(async () => {
    const productsSignal = signal<ProductSummaryDTO[]>(mockProducts);
    const categoriesSignal = signal<string[]>(['Beverages', 'Food']);
    const loadingSignal = signal<boolean>(false);
    const errorSignal = signal<string | null>(null);

    mockFacade = {
      products: computed(() => productsSignal()),
      categories: computed(() => categoriesSignal()),
      loading: computed(() => loadingSignal()),
      error: computed(() => errorSignal()),
      loadProducts: vi.fn().mockResolvedValue(undefined),
      createProduct: vi.fn().mockResolvedValue(mockProducts[0]),
      updateProduct: vi.fn().mockResolvedValue(mockProducts[0]),
      deleteProduct: vi.fn().mockResolvedValue(true),
      adjustStock: vi.fn().mockResolvedValue(mockProducts[0]),
    };

    await TestBed.configureTestingModule({
      imports: [InventoryManagementComponent],
      providers: [{ provide: InventoryFacade, useValue: mockFacade }],
    }).compileComponents();

    fixture = TestBed.createComponent(InventoryManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should call loadProducts on init', () => {
    expect(mockFacade.loadProducts).toHaveBeenCalledTimes(1);
  });

  describe('Filtering', () => {
    it('should display all products when no filter is applied', () => {
      expect(component.filteredProducts().length).toBe(3);
    });

    it('should filter products by search query (name)', () => {
      component.searchQuery.set('coffee');
      expect(component.filteredProducts().length).toBe(1);
      expect(component.filteredProducts()[0].name).toBe('Coffee');
    });

    it('should filter products by search query (SKU)', () => {
      component.searchQuery.set('SKU-002');
      expect(component.filteredProducts().length).toBe(1);
      expect(component.filteredProducts()[0].name).toBe('Muffin');
    });

    it('should filter products by category', () => {
      component.categoryFilter.set('Beverages');
      expect(component.filteredProducts().length).toBe(2);
    });

    it('should filter products by stock status (critical)', () => {
      component.stockFilter.set('critical');
      expect(component.filteredProducts().length).toBe(1);
      expect(component.filteredProducts()[0].name).toBe('Muffin');
    });

    it('should filter products by stock status (warning)', () => {
      component.stockFilter.set('warning');
      expect(component.filteredProducts().length).toBe(1);
      expect(component.filteredProducts()[0].name).toBe('Tea');
    });

    it('should filter products by stock status (healthy)', () => {
      component.stockFilter.set('healthy');
      expect(component.filteredProducts().length).toBe(1);
      expect(component.filteredProducts()[0].name).toBe('Coffee');
    });

    it('should combine search and category filters', () => {
      component.searchQuery.set('tea');
      component.categoryFilter.set('Beverages');
      expect(component.filteredProducts().length).toBe(1);
      expect(component.filteredProducts()[0].name).toBe('Tea');
    });
  });

  describe('Computed Values', () => {
    it('should compute low stock count correctly', () => {
      expect(component.lowStockCount()).toBe(1); // Muffin has 3 units
    });

    it('should compute warning count correctly', () => {
      expect(component.warningCount()).toBe(1); // Tea has 15 units
    });

    it('should compute healthy count correctly', () => {
      expect(component.healthyCount()).toBe(1); // Coffee has 50 units
    });

    it('should compute total stock correctly', () => {
      expect(component.totalStock()).toBe(68); // 50 + 3 + 15
    });
  });

  describe('Stock Status', () => {
    it('should return critical for stock < 5', () => {
      expect(component.getStockStatus(4)).toBe('critical');
      expect(component.getStockStatus(0)).toBe('critical');
    });

    it('should return warning for stock 5-20', () => {
      expect(component.getStockStatus(5)).toBe('warning');
      expect(component.getStockStatus(20)).toBe('warning');
    });

    it('should return healthy for stock > 20', () => {
      expect(component.getStockStatus(21)).toBe('healthy');
      expect(component.getStockStatus(100)).toBe('healthy');
    });

    it('should return correct labels', () => {
      expect(component.getStockLabel(2)).toBe('Critical');
      expect(component.getStockLabel(10)).toBe('Warning');
      expect(component.getStockLabel(50)).toBe('Healthy');
    });
  });

  describe('Form Operations', () => {
    it('should open create form with empty data', () => {
      component.openCreateForm();
      expect(component.formMode()).toBe('create');
      expect(component.editingProductId()).toBeNull();
      expect(component.formData().name).toBe('');
      expect(component.formData().sku).toBe('');
    });

    it('should open edit form with product data', () => {
      component.openEditForm(mockProducts[0]);
      expect(component.formMode()).toBe('edit');
      expect(component.editingProductId()).toBe('p1');
      expect(component.formData().name).toBe('Coffee');
      expect(component.formData().sku).toBe('SKU-001');
      expect(component.formData().price).toBe(4.5);
    });

    it('should close form and reset state', () => {
      component.openCreateForm();
      component.closeForm();
      expect(component.formMode()).toBe('closed');
      expect(component.editingProductId()).toBeNull();
      expect(component.formData().name).toBe('');
    });

    it('should update form field and clear error', () => {
      component.formErrors.set({ name: 'Required' });
      component.updateFormField('name', 'New Name');
      expect(component.formData().name).toBe('New Name');
      expect(component.formErrors()['name']).toBeUndefined();
    });

    it('should validate required fields on save', async () => {
      component.openCreateForm();
      await component.saveProduct();
      expect(component.formErrors()['name']).toBe('Product name is required');
      expect(component.formErrors()['sku']).toBe('SKU is required');
      expect(component.formErrors()['category']).toBe('Category is required');
    });

    it('should validate price is not negative', async () => {
      component.openCreateForm();
      component.updateFormField('name', 'Test');
      component.updateFormField('sku', 'SKU-T');
      component.updateFormField('category', 'Food');
      component.updateFormField('price', -1);
      await component.saveProduct();
      expect(component.formErrors()['price']).toBe('Price cannot be negative');
    });

    it('should validate stock is not negative', async () => {
      component.openCreateForm();
      component.updateFormField('name', 'Test');
      component.updateFormField('sku', 'SKU-T');
      component.updateFormField('category', 'Food');
      component.updateFormField('stock', -5);
      await component.saveProduct();
      expect(component.formErrors()['stock']).toBe('Stock cannot be negative');
    });

    it('should call createProduct on valid create form', async () => {
      component.openCreateForm();
      component.updateFormField('name', 'New Product');
      component.updateFormField('sku', 'SKU-NEW');
      component.updateFormField('category', 'Food');
      component.updateFormField('price', 5.99);
      component.updateFormField('stock', 25);

      await component.saveProduct();

      expect(mockFacade.createProduct).toHaveBeenCalledTimes(1);
      expect(component.formMode()).toBe('closed');
    });

    it('should call updateProduct on valid edit form', async () => {
      component.openEditForm(mockProducts[0]);
      component.updateFormField('name', 'Updated Coffee');

      await component.saveProduct();

      expect(mockFacade.updateProduct).toHaveBeenCalledTimes(1);
      expect(component.formMode()).toBe('closed');
    });
  });

  describe('Delete Operations', () => {
    it('should open delete confirmation', () => {
      component.requestDelete('p1');
      expect(component.deleteConfirmId()).toBe('p1');
    });

    it('should cancel delete', () => {
      component.requestDelete('p1');
      component.cancelDelete();
      expect(component.deleteConfirmId()).toBeNull();
    });

    it('should confirm delete and call use case', async () => {
      component.requestDelete('p1');
      await component.confirmDelete();
      expect(mockFacade.deleteProduct).toHaveBeenCalledWith('p1');
      expect(component.deleteConfirmId()).toBeNull();
    });

    it('should not call delete if no id set', async () => {
      await component.confirmDelete();
      expect(mockFacade.deleteProduct).not.toHaveBeenCalled();
    });

    it('surfaces the trace ref and audit-logs when remote soft-delete fails', async () => {
      const sync = TestBed.inject(SyncService);
      const audit = TestBed.inject(AuditLogService);
      const logSpy = vi.spyOn(audit, 'log').mockResolvedValue(undefined);
      vi.spyOn(sync, 'pushUpdateAsync').mockRejectedValue(
        new PushFailedError('HTTP 500: Internal server error', 'p1', 'trace-xyz', 500)
      );

      component.requestDelete('p1');
      await component.confirmDelete();

      // Tier 1: notice carries the trace ref for the user.
      expect(component.syncNotice()?.message).toContain('Removed locally');
      expect(component.syncNotice()?.traceId).toBe('trace-xyz');

      // Tier 2: a FAILURE entry is persisted with the trace in metadata.
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AuditStatus.FAILURE,
          action: AuditAction.DELETE,
          entityType: 'Product',
          entityId: 'p1',
          metadata: expect.objectContaining({ traceId: 'trace-xyz' }),
        })
      );
    });

    it('shows a notice without a trace ref when the failure carries none', async () => {
      const sync = TestBed.inject(SyncService);
      vi.spyOn(TestBed.inject(AuditLogService), 'log').mockResolvedValue(undefined);
      vi.spyOn(sync, 'pushUpdateAsync').mockRejectedValue(new Error('offline'));

      component.requestDelete('p1');
      await component.confirmDelete();

      expect(component.syncNotice()?.message).toContain('Removed locally');
      expect(component.syncNotice()?.traceId).toBeUndefined();
    });

    it('copyTrace copies the id and flips the copied flag', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      await component.copyTrace('trace-xyz');

      expect(writeText).toHaveBeenCalledWith('trace-xyz');
      expect(component.traceCopied()).toBe(true);
    });
  });

  describe('Stock Adjustment', () => {
    it('should call adjustStock with positive delta', () => {
      component.adjustStock('p1', 1);
      expect(mockFacade.adjustStock).toHaveBeenCalledWith('p1', 1);
    });

    it('should call adjustStock with negative delta', () => {
      component.adjustStock('p1', -1);
      expect(mockFacade.adjustStock).toHaveBeenCalledWith('p1', -1);
    });
  });

  describe('Filter Actions', () => {
    it('should set critical filter on filterLowStock', () => {
      component.searchQuery.set('something');
      component.categoryFilter.set('Food');
      component.filterLowStock();
      expect(component.stockFilter()).toBe('critical');
      expect(component.categoryFilter()).toBe('');
      expect(component.searchQuery()).toBe('');
    });
  });
});
