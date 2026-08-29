import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryManagementComponent } from './inventory-management.component';
import { ProductSummaryDTO } from '@core/application/use-cases/manage-inventory.use-case';
import { InventoryFacade } from '@core/application/facades';
import { SyncService, PushFailedError } from '@core/infrastructure/sync';
import { AuditLogService, AuditAction, AuditStatus } from '@core/infrastructure/audit';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { EventType } from '@core/infrastructure/messaging/event-bus.events';
import { WritableSignal, signal, computed } from '@angular/core';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AuthorizationError } from '@core/application/auth/angular-authorization.service';

describe('InventoryManagementComponent', () => {
  let component: InventoryManagementComponent;
  let fixture: ComponentFixture<InventoryManagementComponent>;
  let mockFacade: Partial<InventoryFacade>;
  let mockEventBus: { publish: ReturnType<typeof vi.fn> };

  let productsSignal: WritableSignal<ProductSummaryDTO[]>;
  let errorSignal: WritableSignal<string | null>;

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
      reorderQuantity: 25,
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
      reorderQuantity: 12,
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
      reorderQuantity: 40,
    },
  ];

  beforeEach(async () => {
    // Hoisted so a test can change what the catalogue contains, or make the facade
    // report why a save was refused.
    productsSignal = signal<ProductSummaryDTO[]>(mockProducts);
    errorSignal = signal<string | null>(null);
    const categoriesSignal = signal<string[]>(['Beverages', 'Food']);
    const loadingSignal = signal<boolean>(false);

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

    mockEventBus = { publish: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [InventoryManagementComponent],
      providers: [
        { provide: InventoryFacade, useValue: mockFacade },
        { provide: EventBusService, useValue: mockEventBus },
        // Satisfies the *hasPermission directive's CurrentUserService -> AUTH_GATEWAY
        // dependency chain. Unauthenticated stub: gated controls simply stay hidden.
        {
          provide: AUTH_GATEWAY,
          useValue: {
            authenticate: vi.fn(),
            getActiveSession: vi.fn().mockResolvedValue(null),
            refresh: vi.fn(),
            signOut: vi.fn(),
            getAccessToken: vi.fn().mockReturnValue(null),
          },
        },
      ],
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
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: EventType.PRODUCT_CREATED, source: 'InventoryManagement' })
      );
    });

    it('should call updateProduct on valid edit form', async () => {
      component.openEditForm(mockProducts[0]);
      component.updateFormField('name', 'Updated Coffee');

      await component.saveProduct();

      expect(mockFacade.updateProduct).toHaveBeenCalledTimes(1);
      expect(component.formMode()).toBe('closed');
    });
  });

  describe('refusing a code that another product already owns', () => {
    // The till builds one flat lookup keyed on barcode AND sku, first-writer-wins. A
    // duplicate does not merely fail to scan: it rings up the other product at the
    // other price, at full confidence, with the fallback suppressed. Nothing
    // downstream can notice, so registration is the only place to stop it.
    it('blocks a barcode that belongs to another product', async () => {
      component.openCreateForm();
      component.updateFormField('name', 'New Thing');
      component.updateFormField('sku', 'SKU-FRESH');
      component.updateFormField('category', 'Food');
      component.updateFormField('barcode', 'BAR-001');

      await component.saveProduct();

      expect(component.duplicateConflict()?.product.name).toBe('Coffee');
      expect(mockFacade.createProduct).not.toHaveBeenCalled();
      expect(component.saveError()).toContain('Coffee');
    });

    it('blocks a SKU that belongs to another product', async () => {
      component.openCreateForm();
      component.updateFormField('name', 'New Thing');
      component.updateFormField('sku', 'SKU-002');
      component.updateFormField('category', 'Food');

      await component.saveProduct();

      expect(component.duplicateConflict()?.product.name).toBe('Muffin');
      expect(mockFacade.createProduct).not.toHaveBeenCalled();
    });

    it('catches a SKU that collides with another product\u2019s barcode', () => {
      // Cross-field, because the till indexes both into the same map — a SKU equal to
      // someone else's barcode shadows it just as completely.
      component.openCreateForm();
      component.updateFormField('sku', 'BAR-003');

      expect(component.duplicateConflict()?.field).toBe('sku');
    });

    it('ignores case when comparing SKUs', () => {
      component.openCreateForm();
      component.updateFormField('sku', 'sku-001');

      expect(component.duplicateConflict()?.product.name).toBe('Coffee');
    });

    it('does not flag a product against its own codes', () => {
      // The most likely false positive by far: renaming a product leaves its own SKU
      // and barcode in place, and they still belong to it.
      component.openEditForm(mockProducts[0]!);
      component.updateFormField('name', 'Renamed Coffee');

      expect(component.duplicateConflict()).toBeNull();
    });

    it('never treats an empty barcode as a collision', () => {
      // Most products legitimately have none; treating '' as a key would make every
      // one of them collide with every other.
      component.openCreateForm();
      component.updateFormField('sku', 'SKU-FRESH');
      component.updateFormField('barcode', '');

      expect(component.duplicateConflict()).toBeNull();
    });

    it('matches the same code entered in a different representation', async () => {
      // A UPC-E and the UPC-A it expands to are different strings and the same
      // article. A string comparison would let both into the catalogue.
      productsSignal.set([{ ...mockProducts[0]!, barcode: '012345000065' }]);
      component.openCreateForm();
      component.updateFormField('sku', 'SKU-FRESH');
      component.updateFormField('barcode', '01234565');

      expect(component.duplicateConflict()?.field).toBe('barcode');
      await component.saveProduct();
      expect(mockFacade.createProduct).not.toHaveBeenCalled();
    });

    it('offers the colliding product for editing instead', () => {
      component.openCreateForm();
      component.updateFormField('barcode', 'BAR-002');

      component.openConflictingProduct();

      expect(component.formMode()).toBe('edit');
      expect(component.editingProductId()).toBe('p2');
    });
  });

  describe('the reorder quantity that used to be silently 20', () => {
    it('loads the product\u2019s own value into the edit form', () => {
      component.openEditForm(mockProducts[0]!);
      expect(component.formData().reorderQuantity).toBe(25);
    });

    it('sends it back unchanged on save', async () => {
      component.openEditForm(mockProducts[1]!);

      await component.saveProduct();

      expect(mockFacade.updateProduct).toHaveBeenCalledWith(
        expect.objectContaining({ reorderQuantity: 12 })
      );
    });
  });

  describe('guarding unsaved work', () => {
    it('closes straight away when nothing was touched', () => {
      component.openCreateForm();
      component.requestCloseForm();

      expect(component.formMode()).toBe('closed');
      expect(component.confirmDiscard()).toBe(false);
    });

    it('asks before throwing away edits', () => {
      // Escape is easy to hit by accident, and reading small print off packaging
      // takes minutes.
      component.openCreateForm();
      component.updateFormField('name', 'Half typed');

      component.requestCloseForm();

      expect(component.confirmDiscard()).toBe(true);
      expect(component.formMode()).toBe('create');
    });

    it('backs out of the question when the dismissal gesture is repeated', () => {
      // Escape twice must not be the thing that discards, and ignoring the second
      // press makes the key feel broken. Escape cancels the innermost question.
      component.openCreateForm();
      component.updateFormField('name', 'Half typed');
      component.requestCloseForm();

      component.requestCloseForm();

      expect(component.confirmDiscard()).toBe(false);
      expect(component.formMode()).toBe('create');
      expect(component.formData().name).toBe('Half typed');
    });

    it('keeps the edits when the answer is no', () => {
      component.openCreateForm();
      component.updateFormField('name', 'Half typed');
      component.requestCloseForm();

      component.keepEditing();

      expect(component.formMode()).toBe('create');
      expect(component.formData().name).toBe('Half typed');
    });

    it('closes when the answer is yes', () => {
      component.openCreateForm();
      component.updateFormField('name', 'Half typed');
      component.requestCloseForm();

      component.discardAndClose();

      expect(component.formMode()).toBe('closed');
    });

    it('does not consider an untouched edit form dirty', () => {
      // It would be if the snapshot came from the DTO while the form defaulted a
      // field differently — which is exactly what the old hardcoded 20 did.
      component.openEditForm(mockProducts[0]!);
      expect(component.isDirty()).toBe(false);
    });
  });

  describe('validating what was typed', () => {
    it('requires a price rather than saving it as zero', async () => {
      // A cleared number field reports null, and Number(null) is 0 — so a
      // negative-only rule can never fire and the product saves priced at nothing.
      component.openCreateForm();
      component.updateFormField('name', 'Thing');
      component.updateFormField('sku', 'SKU-FRESH');
      component.updateFormField('category', 'Food');
      component.updateFormField('price', null);

      await component.saveProduct();

      expect(component.formErrors()['price']).toBe('Price is required');
      expect(mockFacade.createProduct).not.toHaveBeenCalled();
    });

    it('reports the margin the price and cost imply', () => {
      component.openCreateForm();
      component.updateFormField('price', 10);
      component.updateFormField('cost', 6);

      expect(component.margin()).toBe(40);
    });

    it('has no margin to report until both are set', () => {
      component.openCreateForm();
      component.updateFormField('price', 10);

      expect(component.margin()).toBeNull();
    });

    it('surfaces a refused save inside the dialog', async () => {
      // The facade's error banner renders behind the modal, where a rejected save
      // looks exactly like a Save button that does nothing.
      (mockFacade.createProduct as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      errorSignal.set('Barcode 123 already belongs to Coffee.');
      component.openCreateForm();
      component.updateFormField('name', 'Thing');
      component.updateFormField('sku', 'SKU-FRESH');
      component.updateFormField('category', 'Food');

      await component.saveProduct();

      expect(component.saveError()).toContain('already belongs to Coffee');
      expect(component.formMode()).toBe('create');
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

    it('publishes product.deleted after a local delete', async () => {
      // pushUpdateAsync rejects (no worker) → still a local success, event fires.
      vi.spyOn(TestBed.inject(AuditLogService), 'log').mockResolvedValue(undefined);
      component.requestDelete('p1');
      await component.confirmDelete();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EventType.PRODUCT_DELETED,
          source: 'InventoryManagement',
          payload: expect.objectContaining({ id: 'p1' }),
        })
      );
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

      // ...and a critical event hits the bus with the same trace.
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EventType.SYNC_PUSH_FAILED,
          priority: 'critical',
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

  describe('collisions the catalogue already contains', () => {
    it('names the first owner when two products share a code', () => {
      // The catalogue can already hold a collision — imported twice, or synced from a
      // till that had no check. Reporting the first owner is what makes the message
      // stable rather than dependent on load order.
      productsSignal.set([
        { ...mockProducts[0], id: 'p1', name: 'Coffee', barcode: '4006381333931' },
        { ...mockProducts[1], id: 'p2', name: 'Second Coffee', barcode: '4006381333931' },
      ]);

      component.openCreateForm();
      component.updateFormField('barcode', '4006381333931');

      expect(component.duplicateConflict()?.product.name).toBe('Coffee');
    });

    it('lets a product with no barcode collide with nothing', () => {
      // An absent code must never key the index, or every product without a barcode
      // would own the same empty key and collide with all the others.
      productsSignal.set([
        // '', not undefined: ProductSummaryDTO.barcode is a required string —
        // manage-inventory.use-case.ts maps an absent domain barcode to '' (see
        // its `product.barcode ?? ''`), so that's the real shape of "no barcode".
        { ...mockProducts[0], id: 'p1', barcode: '' },
        { ...mockProducts[1], id: 'p2', barcode: '' },
      ]);

      component.openCreateForm();
      component.updateFormField('barcode', '4006381333931');

      expect(component.duplicateConflict()).toBeNull();
    });

    it('catches a code that no arithmetic can canonicalise', () => {
      // A shelf code is not a GTIN, so there is no canonical form to compare — only
      // the raw string, case-insensitively.
      productsSignal.set([{ ...mockProducts[0], id: 'p1', name: 'Coffee', barcode: 'SHELF-A12' }]);

      component.openCreateForm();
      component.updateFormField('barcode', 'shelf-a12');

      expect(component.duplicateConflict()).toMatchObject({ field: 'barcode' });
      expect(component.duplicateConflict()?.product.name).toBe('Coffee');
    });

    it('does nothing when asked to open a conflict that is no longer there', () => {
      // The button is only rendered with a conflict showing, but the handler is the
      // one place a stale click would reopen the form on nothing.
      component.openCreateForm();

      component.openConflictingProduct();

      expect(component.formMode()).toBe('create');
      expect(component.editingProductId()).toBeNull();
    });
  });

  describe('when a save or a delete does not land', () => {
    it('reports a refused update inside the dialog, not just behind it', async () => {
      (mockFacade.updateProduct as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      errorSignal.set(null);
      component.openEditForm(mockProducts[0]);
      component.updateFormField('name', 'Coffee Beans');

      await component.saveProduct();

      // No reason from the facade, so it has to supply its own rather than showing
      // an empty banner.
      expect(component.saveError()).toContain("didn't save");
      expect(component.formMode()).toBe('edit');
    });

    it('does not publish anything when the local delete itself fails', async () => {
      (mockFacade.deleteProduct as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      mockEventBus.publish.mockClear();

      component.requestDelete('p1');
      await component.confirmDelete();

      expect(mockEventBus.publish).not.toHaveBeenCalled();
      expect(component.deleteConfirmId()).toBeNull();
    });

    it('survives a sync failure that was not thrown as an Error', async () => {
      // A worker can reject with a plain string, and a message-building step that
      // assumed `error.message` would fail inside the failure handler itself.
      const sync = TestBed.inject(SyncService);
      vi.spyOn(TestBed.inject(AuditLogService), 'log').mockResolvedValue(undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(sync, 'pushUpdateAsync').mockRejectedValue('worker gone');

      component.requestDelete('p1');
      await component.confirmDelete();

      expect(component.syncNotice()?.message).toContain('Removed locally');
    });

    it('says which product the delete dialog is about, and copes when it has gone', () => {
      component.requestDelete('p1');
      expect(component.deletingProductName()).toBe('Coffee');

      // Deleted on another till and synced away while the dialog was open.
      productsSignal.set([]);
      expect(component.deletingProductName()).toBe('This product');
    });
  });

  describe('validating the numbers', () => {
    it('requires a stock level rather than saving it as zero', async () => {
      // A cleared number field reports null, and `Number(null)` is 0 — so a
      // negative-only rule would let a blank field through as "none in stock".
      component.openCreateForm();
      component.updateFormField('name', 'Thing');
      component.updateFormField('sku', 'SKU-NEW');
      component.updateFormField('category', 'Food');
      component.updateFormField('price', 3);
      component.updateFormField('stock', null);

      await component.saveProduct();

      expect(component.formErrors()['stock']).toContain('required');
      expect(mockFacade.createProduct).not.toHaveBeenCalled();
    });

    it('refuses a negative cost', async () => {
      component.openCreateForm();
      component.updateFormField('name', 'Thing');
      component.updateFormField('sku', 'SKU-NEW');
      component.updateFormField('category', 'Food');
      component.updateFormField('price', 3);
      component.updateFormField('stock', 1);
      component.updateFormField('cost', -1);

      await component.saveProduct();

      expect(component.formErrors()['cost']).toContain('negative');
      expect(mockFacade.createProduct).not.toHaveBeenCalled();
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

    it('says it is a permission problem when that is what it is', async () => {
      // "Failed, try again" invites the operator to keep pressing a button that is
      // never going to work for them.
      const toast = vi.spyOn(TestBed.inject(ToastService), 'error').mockImplementation(() => 0);
      (mockFacade.adjustStock as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AuthorizationError('inventory:adjust_stock' as never)
      );

      await component.adjustStock('p1', 1);

      expect(toast).toHaveBeenCalledWith(expect.stringContaining('permission'));
    });

    it('asks for a retry when the failure is not about permission', async () => {
      const toast = vi.spyOn(TestBed.inject(ToastService), 'error').mockImplementation(() => 0);
      (mockFacade.adjustStock as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));

      await component.adjustStock('p1', 1);

      expect(toast).toHaveBeenCalledWith(expect.stringContaining('try again'));
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
