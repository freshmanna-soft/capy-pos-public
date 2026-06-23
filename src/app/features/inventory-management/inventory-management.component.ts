import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ProductSummaryDTO,
  CreateProductRequest,
  UpdateProductRequest,
} from '@core/application/use-cases/manage-inventory.use-case';
import { InventoryFacade } from '@core/application/facades';
import { SyncService, PushFailedError } from '@core/infrastructure/sync';
import { AuditLogService, AuditAction, AuditStatus } from '@core/infrastructure/audit';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { EventSource, EventType, busEvent } from '@core/infrastructure/messaging/event-bus.events';
import { HasPermissionDirective } from '@shared/ui/directives/has-permission.directive';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AuthorizationError } from '@core/application/auth/angular-authorization.service';

type StockStatus = 'healthy' | 'warning' | 'critical';
type FormMode = 'closed' | 'create' | 'edit';

/**
 * Product form data interface for create/edit operations
 */
interface ProductFormData {
  name: string;
  sku: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  description: string;
  emoji: string;
  barcode: string;
  lowStockThreshold: number;
  reorderQuantity: number;
}

/**
 * Inventory Management Component
 *
 * Full CRUD interface for managing product inventory with
 * persistent storage via IndexedDB (Dexie).
 *
 * Features:
 * - Product table with stock levels
 * - Search/filter by name, SKU, category, stock status
 * - Create new products with form validation
 * - Edit existing products inline
 * - Delete products with confirmation
 * - Stock adjustment (+/-) buttons
 * - Low stock alert banner
 * - Persistent storage via ManageInventoryUseCase
 */
@Component({
  selector: 'app-inventory-management',
  standalone: true,
  imports: [CommonModule, FormsModule, HasPermissionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory-management.component.html',
  styleUrl: './inventory-management.component.scss',
})
export class InventoryManagementComponent implements OnInit {
  protected readonly inventoryFacade = inject(InventoryFacade);
  private readonly syncService = inject(SyncService);
  private readonly auditLog = inject(AuditLogService);
  private readonly eventBus = inject(EventBusService);
  private readonly toast = inject(ToastService);

  // Filter signals
  readonly searchQuery = signal('');
  readonly categoryFilter = signal('');
  readonly stockFilter = signal<'' | StockStatus>('');

  // Form state
  readonly formMode = signal<FormMode>('closed');
  readonly editingProductId = signal<string | null>(null);
  readonly formData = signal<ProductFormData>(this.getEmptyFormData());
  readonly formErrors = signal<Record<string, string>>({});

  // Delete confirmation
  readonly deleteConfirmId = signal<string | null>(null);

  // Non-blocking notice when a remote sync didn't confirm (offline / circuit open).
  // When the failure came back from the server it carries a traceId so the user
  // can quote it for support and we can match it in CloudWatch/X-Ray.
  readonly syncNotice = signal<{ message: string; traceId?: string } | null>(null);

  // Transient confirmation shown after the trace ref is copied to the clipboard.
  readonly traceCopied = signal(false);

  // Computed values
  readonly filteredProducts = computed(() => {
    let result = this.inventoryFacade.products();
    const query = this.searchQuery().toLowerCase().trim();
    const category = this.categoryFilter();
    const stockStatus = this.stockFilter();

    if (query) {
      result = result.filter(
        (p) => p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query)
      );
    }

    if (category) {
      result = result.filter((p) => p.category === category);
    }

    if (stockStatus) {
      result = result.filter((p) => this.getStockStatus(p.stock) === stockStatus);
    }

    return result;
  });

  readonly lowStockCount = computed(
    () => this.inventoryFacade.products().filter((p) => p.stock < 5).length
  );

  readonly warningCount = computed(
    () => this.inventoryFacade.products().filter((p) => p.stock >= 5 && p.stock <= 20).length
  );

  readonly healthyCount = computed(
    () => this.inventoryFacade.products().filter((p) => p.stock > 20).length
  );

  readonly totalStock = computed(() =>
    this.inventoryFacade.products().reduce((sum, p) => sum + p.stock, 0)
  );

  ngOnInit(): void {
    this.inventoryFacade.loadProducts();
  }

  // Stock status helpers
  getStockStatus(stock: number): StockStatus {
    if (stock < 5) return 'critical';
    if (stock <= 20) return 'warning';
    return 'healthy';
  }

  getStockLabel(stock: number): string {
    if (stock < 5) return 'Critical';
    if (stock <= 20) return 'Warning';
    return 'Healthy';
  }

  getStockStatusClasses(stock: number): string {
    const base = 'inline-block px-2.5 py-1 rounded-full font-semibold uppercase tracking-wide';
    const status = this.getStockStatus(stock);
    switch (status) {
      case 'healthy':
        return `${base} bg-green-100 text-green-800`;
      case 'warning':
        return `${base} bg-yellow-100 text-yellow-800`;
      case 'critical':
        return `${base} bg-red-100 text-red-800`;
      default:
        return `${base} bg-gray-100 text-gray-600`;
    }
  }

  // Stock adjustment — the use-case enforces ADJUST_STOCK permission
  async adjustStock(productId: string, delta: number): Promise<void> {
    try {
      await this.inventoryFacade.adjustStock(productId, delta);
    } catch (err) {
      if (err instanceof AuthorizationError) {
        this.toast.error('You do not have permission to adjust stock.');
      } else {
        this.toast.error('Failed to adjust stock. Please try again.');
      }
    }
  }

  // Filter actions
  filterLowStock(): void {
    this.stockFilter.set('critical');
    this.categoryFilter.set('');
    this.searchQuery.set('');
  }

  dismissError(): void {
    // Clear error by reloading
    this.inventoryFacade.loadProducts();
  }

  // Form operations
  openCreateForm(): void {
    this.formMode.set('create');
    this.editingProductId.set(null);
    this.formData.set(this.getEmptyFormData());
    this.formErrors.set({});
  }

  openEditForm(product: ProductSummaryDTO): void {
    this.formMode.set('edit');
    this.editingProductId.set(product.id);
    this.formData.set({
      name: product.name,
      sku: product.sku,
      category: product.category,
      price: product.price,
      cost: product.cost,
      stock: product.stock,
      description: product.description,
      emoji: product.emoji,
      barcode: product.barcode,
      lowStockThreshold: product.lowStockThreshold,
      reorderQuantity: 20,
    });
    this.formErrors.set({});
  }

  closeForm(): void {
    this.formMode.set('closed');
    this.editingProductId.set(null);
    this.formData.set(this.getEmptyFormData());
    this.formErrors.set({});
  }

  updateFormField(field: keyof ProductFormData, value: string | number): void {
    this.formData.update((current) => ({ ...current, [field]: value }));
    // Clear error for this field
    this.formErrors.update((current) => {
      const updated = { ...current };
      delete updated[field];
      return updated;
    });
  }

  async saveProduct(): Promise<void> {
    const errors = this.validateForm();
    if (Object.keys(errors).length > 0) {
      this.formErrors.set(errors);
      return;
    }

    const data = this.formData();

    if (this.formMode() === 'create') {
      const request: CreateProductRequest = {
        name: data.name.trim(),
        sku: data.sku.trim(),
        category: data.category.trim(),
        price: Number(data.price),
        cost: Number(data.cost),
        stock: Number(data.stock),
        description: data.description.trim() || undefined,
        emoji: data.emoji.trim() || undefined,
        barcode: data.barcode.trim() || undefined,
        lowStockThreshold: Number(data.lowStockThreshold),
        reorderQuantity: Number(data.reorderQuantity),
      };

      const result = await this.inventoryFacade.createProduct(request);
      if (result) {
        this.eventBus.publish(
          busEvent(
            EventType.PRODUCT_CREATED,
            EventSource.INVENTORY,
            { id: result.id, name: result.name },
            'normal'
          )
        );
        this.closeForm();
      }
    } else {
      const productId = this.editingProductId();
      if (!productId) return;

      const request: UpdateProductRequest = {
        id: productId,
        name: data.name.trim(),
        sku: data.sku.trim(),
        category: data.category.trim(),
        price: Number(data.price),
        cost: Number(data.cost),
        stock: Number(data.stock),
        description: data.description.trim(),
        emoji: data.emoji.trim(),
        barcode: data.barcode.trim(),
        lowStockThreshold: Number(data.lowStockThreshold),
        reorderQuantity: Number(data.reorderQuantity),
      };

      const result = await this.inventoryFacade.updateProduct(request);
      if (result) {
        this.eventBus.publish(
          busEvent(
            EventType.PRODUCT_UPDATED,
            EventSource.INVENTORY,
            { id: productId, name: request.name },
            'normal'
          )
        );
        this.closeForm();
      }
    }
  }

  // Delete operations
  requestDelete(productId: string): void {
    this.deleteConfirmId.set(productId);
  }

  cancelDelete(): void {
    this.deleteConfirmId.set(null);
  }

  async confirmDelete(): Promise<void> {
    const id = this.deleteConfirmId();
    if (!id) return;

    const product = this.inventoryFacade.products().find((p) => p.id === id);

    // Soft-delete locally first (offline-first — always succeeds against IndexedDB).
    const deleted = await this.inventoryFacade.deleteProduct(id);
    this.deleteConfirmId.set(null);
    if (!deleted || !product) return;

    this.eventBus.publish(
      busEvent(
        EventType.PRODUCT_DELETED,
        EventSource.INVENTORY,
        { id, name: product.name },
        'normal'
      )
    );

    // Mirror the removal to the remote API as a soft-delete (isActive: false)
    // rather than a destructive DELETE, so transaction history that references
    // this product stays intact. Await confirmation; if it doesn't land
    // (offline / circuit open), the local delete still applied and the next
    // background sync will reconcile.
    const startTime = Date.now();
    try {
      this.syncNotice.set(null);
      await this.syncService.pushUpdateAsync({
        id: product.id,
        name: product.name,
        price: product.price,
        category: product.category,
        stock: product.stock,
        isActive: false,
      });
    } catch (error) {
      const traceId = error instanceof PushFailedError ? error.traceId : undefined;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Inventory] Remote soft-delete for ${id} did not confirm:`, error);

      // Tier 1 — tell the user now (local delete already applied; this is a sync hiccup).
      this.syncNotice.set({
        message: 'Removed locally — will sync to the server when back online.',
        traceId,
      });

      // Tier 2 — persist the failure so it shows up in the agent monitor for
      // later triage, with the trace ID to follow into CloudWatch/X-Ray.
      void this.auditLog.log({
        agentName: 'SyncService',
        operation: 'pushUpdate (soft-delete)',
        entityType: 'Product',
        entityId: id,
        action: AuditAction.DELETE,
        status: AuditStatus.FAILURE,
        errorMessage: message,
        duration: Date.now() - startTime,
        metadata: { traceId, productName: product.name },
      });

      // Also surface the failure on the event bus (agent-monitor "Event Bus Activity").
      this.eventBus.publish(
        busEvent(
          EventType.SYNC_PUSH_FAILED,
          EventSource.INVENTORY,
          { productId: id, operation: 'soft-delete' },
          'critical',
          { traceId }
        )
      );
    }
  }

  /** Copy the failure's trace ID so the user can quote it in a support request. */
  async copyTrace(traceId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(traceId);
      this.traceCopied.set(true);
      setTimeout(() => this.traceCopied.set(false), 2000);
    } catch {
      // Clipboard can be unavailable (no permission / insecure context); ignore.
    }
  }

  dismissSyncNotice(): void {
    this.syncNotice.set(null);
    this.traceCopied.set(false);
  }

  // Form validation
  private validateForm(): Record<string, string> {
    const errors: Record<string, string> = {};
    const data = this.formData();

    if (!data.name.trim()) {
      errors['name'] = 'Product name is required';
    }

    if (!data.sku.trim()) {
      errors['sku'] = 'SKU is required';
    }

    if (!data.category.trim()) {
      errors['category'] = 'Category is required';
    }

    if (Number(data.price) < 0) {
      errors['price'] = 'Price cannot be negative';
    }

    if (Number(data.stock) < 0) {
      errors['stock'] = 'Stock cannot be negative';
    }

    return errors;
  }

  private getEmptyFormData(): ProductFormData {
    return {
      name: '',
      sku: '',
      category: '',
      price: 0,
      cost: 0,
      stock: 0,
      description: '',
      emoji: '',
      barcode: '',
      lowStockThreshold: 10,
      reorderQuantity: 20,
    };
  }
}
