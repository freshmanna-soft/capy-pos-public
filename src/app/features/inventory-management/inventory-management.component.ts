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
import { BadgeComponent } from '@shared/ui/atoms/badge/badge.component';
import { ButtonComponent } from '@shared/ui/atoms/button/button.component';
import { InputComponent } from '@shared/ui/atoms/input/input.component';
import { ModalComponent } from '@shared/ui/molecules/modal/modal.component';
import { BarcodeScanFieldComponent } from './components/barcode-scan-field.component';
import { barcodeKey } from '@core/domain/utils/barcode';
import { ToastService } from '@shared/ui/toast/toast.service';
import { AuthorizationError } from '@core/application/auth/angular-authorization.service';

type StockStatus = 'healthy' | 'warning' | 'critical';
type FormMode = 'closed' | 'create' | 'edit';

/** A code in the form that already identifies a different product. */
interface DuplicateConflict {
  field: 'barcode' | 'sku';
  product: ProductSummaryDTO;
}

/**
 * Fields in the order they appear on screen.
 *
 * Used to decide which problem to send focus to first. Iterating `formErrors`
 * instead would follow the order validation happened to record them in, which is
 * not the order anyone reads the form in.
 */
const FIELD_ORDER: readonly (keyof ProductFormData)[] = [
  'name',
  'sku',
  'category',
  'barcode',
  'price',
  'cost',
  'stock',
  'lowStockThreshold',
  'reorderQuantity',
  'description',
];

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
  imports: [
    CommonModule,
    FormsModule,
    HasPermissionDirective,
    BadgeComponent,
    ButtonComponent,
    InputComponent,
    ModalComponent,
    BarcodeScanFieldComponent,
  ],
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
  /**
   * Messages by field name.
   *
   * The value type admits `undefined` because indexing a record for a key that was
   * never set returns exactly that — typing it as plain `string` told the compiler a
   * missing error was a present empty one, so every `?? ''` at a call site read as
   * dead code while being the only thing preventing `undefined` reaching a template.
   */
  readonly formErrors = signal<Record<string, string | undefined>>({});
  /**
   * What the form looked like when it opened, for the discard guard.
   *
   * Snapshotted from the `formData` actually written rather than from the DTO, so a
   * field the form defaults differently from storage cannot make an untouched form
   * look edited.
   */
  private readonly pristineFormData = signal<ProductFormData>(this.getEmptyFormData());
  /** Set when the save itself was refused, e.g. a code taken between load and save. */
  readonly saveError = signal<string | null>(null);
  /** Shown when a dismissal would throw away edits. */
  readonly confirmDiscard = signal(false);

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

  /**
   * Every code in the catalogue, exactly as the till collides on them.
   *
   * One map keyed on barcodes *and* SKUs together, mirroring `buildCodeIndex` in the
   * clerk — which means a numeric SKU that happens to equal another product's
   * barcode is just as destructive as two identical barcodes, and has to be caught
   * here too.
   *
   * Rebuilt only when the catalogue changes, so the per-keystroke check below stays a
   * map lookup rather than a scan of every product.
   */
  private readonly rawCodeOwners = computed(() => {
    const owners = new Map<string, ProductSummaryDTO>();
    for (const product of this.inventoryFacade.products()) {
      for (const code of [product.barcode, product.sku]) {
        const key = code?.trim().toUpperCase() ?? '';
        // An absent code must never key anything, or every product without a
        // barcode would collide with every other one.
        if (key.length > 0 && !owners.has(key)) {
          owners.set(key, product);
        }
      }
    }
    return owners;
  });

  /**
   * Barcodes again, but keyed on their canonical form.
   *
   * Catches the duplicate a string comparison cannot see: the same article entered
   * once as a UPC-E and once as the UPC-A it expands to, or as a UPC-A and its
   * equivalent EAN-13. Different characters, one product.
   */
  private readonly canonicalBarcodeOwners = computed(() => {
    const owners = new Map<string, ProductSummaryDTO>();
    for (const product of this.inventoryFacade.products()) {
      const key = barcodeKey(product.barcode ?? '');
      if (key.length > 0 && !owners.has(key)) {
        owners.set(key, product);
      }
    }
    return owners;
  });

  /**
   * The collision currently in the form, if any.
   *
   * A `computed` rather than an entry in `formErrors` on purpose. `updateFormField`
   * clears errors by deleting the edited field's key, so a conflict recorded under
   * one field would survive an edit to the *other* field that resolved it — and a
   * synthetic key like 'duplicate' could never be cleared at all, leaving the form
   * permanently unsavable.
   */
  readonly duplicateConflict = computed<DuplicateConflict | null>(() => {
    const data = this.formData();
    const selfId = this.editingProductId();
    const isOther = (product: ProductSummaryDTO | undefined): product is ProductSummaryDTO =>
      product !== undefined && product.id !== selfId;

    const barcode = data.barcode.trim();
    if (barcode.length > 0) {
      const canonical = this.canonicalBarcodeOwners().get(barcodeKey(barcode));
      if (isOther(canonical)) {
        return { field: 'barcode', product: canonical };
      }
      const raw = this.rawCodeOwners().get(barcode.toUpperCase());
      if (isOther(raw)) {
        return { field: 'barcode', product: raw };
      }
    }

    const sku = data.sku.trim();
    if (sku.length > 0) {
      const raw = this.rawCodeOwners().get(sku.toUpperCase());
      if (isOther(raw)) {
        return { field: 'sku', product: raw };
      }
    }

    return null;
  });

  /** The colliding product's name, for the barcode field's own status line. */
  readonly barcodeDuplicateName = computed(() => {
    const conflict = this.duplicateConflict();
    return conflict?.field === 'barcode' ? conflict.product.name : null;
  });

  /**
   * Field-level messages, merging the validation record with the live conflict.
   *
   * The two sources are separate by design — validation is recorded on save, a
   * conflict is derived continuously — but a field can only show one message, and
   * the conflict is the more specific of the two.
   */
  readonly skuError = computed(() => this.errorFor('sku'));
  readonly barcodeError = computed(() => this.errorFor('barcode'));

  private errorFor(field: 'sku' | 'barcode'): string {
    const conflict = this.duplicateConflict();
    if (conflict?.field === field) {
      return `Already used by ${conflict.product.name}`;
    }
    return this.formErrors()[field] ?? '';
  }

  /**
   * Margin as a percentage of price, or null when there is nothing to compute.
   *
   * Shown live because cost and price are entered next to each other and a
   * transposed pair is otherwise invisible until someone reads a report.
   */
  readonly margin = computed(() => {
    const price = Number(this.formData().price);
    const cost = Number(this.formData().cost);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost <= 0) {
      return null;
    }
    return Math.round(((price - cost) / price) * 100);
  });

  /** True once anything in the form differs from what it opened with. */
  readonly isDirty = computed(
    () => JSON.stringify(this.formData()) !== JSON.stringify(this.pristineFormData())
  );

  /** The product the delete dialog is about, so it can say which one. */
  readonly deletingProductName = computed(() => {
    const id = this.deleteConfirmId();
    return (
      this.inventoryFacade.products().find((product) => product.id === id)?.name ?? 'This product'
    );
  });

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

  // `getStockStatusClasses` lived here and hand-rolled the same pill styling the
  // badge atom already defines, twice over in the template. Replaced by
  // `getStockBadgeVariant` below, which names the meaning and lets the atom own the
  // colour.

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
    this.resetForm(this.getEmptyFormData());
  }

  openEditForm(product: ProductSummaryDTO): void {
    this.formMode.set('edit');
    this.editingProductId.set(product.id);
    this.resetForm({
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
      // Read from the product rather than hardcoded. It used to be pinned at 20,
      // which meant every product saved through this form had its configured
      // reorder quantity silently replaced.
      reorderQuantity: product.reorderQuantity,
    });
  }

  /**
   * Load the form and take the snapshot the discard guard compares against.
   *
   * One place, so the snapshot can never drift from what was loaded — which is what
   * would make an untouched form report itself as edited.
   */
  private resetForm(data: ProductFormData): void {
    this.formData.set(data);
    this.pristineFormData.set(data);
    this.formErrors.set({});
    this.saveError.set(null);
    this.confirmDiscard.set(false);
  }

  /**
   * A dismissal was requested. Ask first if it would lose work.
   *
   * Escape is easy to hit by accident, and a half-registered product is a couple of
   * minutes of reading small print off packaging.
   */
  requestCloseForm(): void {
    // Already asking: a second Escape backs out of the question rather than doing
    // nothing. Repeating a dismissal gesture should never be the thing that
    // discards, and silently ignoring it makes the key feel broken.
    if (this.confirmDiscard()) {
      this.keepEditing();
      return;
    }
    if (this.isDirty()) {
      this.confirmDiscard.set(true);
      return;
    }
    this.closeForm();
  }

  keepEditing(): void {
    this.confirmDiscard.set(false);
  }

  discardAndClose(): void {
    this.confirmDiscard.set(false);
    this.closeForm();
  }

  /** Jump from a collision straight to the product that already owns the code. */
  openConflictingProduct(): void {
    const conflict = this.duplicateConflict();
    if (!conflict) {
      return;
    }
    // Loaded fresh, so the form is pristine again and the discard guard stays quiet.
    this.openEditForm(conflict.product);
  }

  closeForm(): void {
    this.formMode.set('closed');
    this.editingProductId.set(null);
    this.resetForm(this.getEmptyFormData());
  }

  /**
   * @param value Widened to include null because a cleared number field reports null
   *   rather than 0 — the difference between "priced at nothing" and "not filled in".
   */
  updateFormField(field: keyof ProductFormData, value: string | number | null): void {
    this.formData.update((current) => ({ ...current, [field]: value }));
    // Clear error for this field
    this.formErrors.update((current) => {
      const updated = { ...current };
      delete updated[field];
      return updated;
    });
  }

  async saveProduct(): Promise<void> {
    this.saveError.set(null);

    const errors = this.validateForm();
    if (Object.keys(errors).length > 0) {
      this.formErrors.set(errors);
      this.focusFirstInvalidField();
      return;
    }

    // Checked separately because a conflict lives in a computed, not in
    // `formErrors` — see the note on `duplicateConflict`. Without this gate the
    // warning would be visible and the save would go through anyway.
    const conflict = this.duplicateConflict();
    if (conflict) {
      this.saveError.set(
        `That ${conflict.field} already belongs to ${conflict.product.name}. Codes have to be unique — the till looks products up by them.`
      );
      this.focusFirstInvalidField();
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
      } else {
        this.reportSaveFailure();
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
      } else {
        this.reportSaveFailure();
      }
    }
  }

  /**
   * Put the reason a save was refused where the person can actually read it.
   *
   * The facade's error signal renders in a banner on the page, which sits *behind*
   * this modal — so a rejected save otherwise looks exactly like a Save button that
   * does nothing at all.
   */
  private reportSaveFailure(): void {
    this.saveError.set(
      this.inventoryFacade.error() ?? "That didn't save. Check the fields and try again."
    );
  }

  /**
   * Move focus to the first field with a problem.
   *
   * In visual order rather than the order errors happen to have been recorded in,
   * because scrolling someone to a field below the one they should fix first reads
   * as the form losing its place. Ids match the fields the atoms render.
   */
  private focusFirstInvalidField(): void {
    const errors = this.formErrors();
    const conflict = this.duplicateConflict();
    const firstBad = FIELD_ORDER.find(
      (field) => errors[field] !== undefined || conflict?.field === field
    );
    if (!firstBad) {
      return;
    }
    document.getElementById(firstBad)?.focus();
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

    // Checked for emptiness before sign, because a cleared number field reports null
    // and `Number(null)` is 0 — so a negative-only rule can never fire for a blank
    // one, and the product would save priced at nothing.
    if (data.price === null || data.price === undefined || !Number.isFinite(Number(data.price))) {
      errors['price'] = 'Price is required';
    } else if (Number(data.price) < 0) {
      errors['price'] = 'Price cannot be negative';
    }

    if (data.stock === null || data.stock === undefined || !Number.isFinite(Number(data.stock))) {
      errors['stock'] = 'Stock is required';
    } else if (Number(data.stock) < 0) {
      errors['stock'] = 'Stock cannot be negative';
    }

    if (Number(data.cost) < 0) {
      errors['cost'] = 'Cost cannot be negative';
    }

    return errors;
  }

  /** Badge variant for a stock level — the colours the badge atom already defines. */
  getStockBadgeVariant(stock: number): 'success' | 'warning' | 'danger' {
    switch (this.getStockStatus(stock)) {
      case 'healthy':
        return 'success';
      case 'warning':
        return 'warning';
      default:
        return 'danger';
    }
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
