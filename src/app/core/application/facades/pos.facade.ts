import { Injectable, inject, signal } from '@angular/core';
import { CartService, MAX_QTY_PER_PRODUCT } from '@core/application/services/cart.service';
import {
  GenerateReceiptUseCase,
  ReceiptData,
} from '@core/application/use-cases/generate-receipt.use-case';
import {
  AdjustStockOnSaleUseCase,
  StockAdjustmentResult,
} from '@core/application/use-cases/adjust-stock-on-sale.use-case';
import { DexieDatabase } from '@core/infrastructure/database/dexie-database.service';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { EventSource, EventType, busEvent } from '@core/infrastructure/messaging/event-bus.events';
import {
  AuditLogService,
  AuditAction,
  AuditStatus,
} from '@core/infrastructure/audit/audit-log.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import { CustomerService } from '@core/application/services/customer.service';
import {
  AwardLoyaltyPointsUseCase,
  LoyaltyAwardResult,
} from '@core/application/use-cases/award-loyalty-points.use-case';
import { Product } from '@core/domain/entities/product.entity';
import { Customer, CustomerTier } from '@core/domain/entities/customer.entity';
import { PaymentResult } from '@core/application/dtos/payment.dto';
import { TransactionRemoteService } from '@core/application/services/transaction-remote.service';
import { PersistTransactionUseCase } from '@core/application/use-cases/persist-transaction.use-case';
import { generateUUID } from '@core/domain/utils/uuid';
import { ADJUST_STOCK_ON_SALE_HANDLER } from '@core/application/handlers/adjust-stock-on-sale.handler';

/**
 * The customer attached to the sale in progress.
 *
 * A flat snapshot rather than the `Customer` entity: the till needs a name to greet
 * them by and a tier to price their points at, and holding the whole entity would
 * invite the UI to mutate a customer through the cart.
 */
export interface AttachedCustomer {
  id: string;
  name: string;
  loyaltyPoints: number;
  tier: CustomerTier;
}

/** Reason an add-to-cart request was rejected. */
export type AddToCartRejection = 'out-of-stock' | 'max-stock-reached';

/** Outcome of an attempt to add a product to the cart. */
export type AddToCartResult = { added: true } | { added: false; reason: AddToCartRejection };

/**
 * PosFacade - Single point of access for POS Terminal operations.
 *
 * Orchestrates CartService, GenerateReceiptUseCase, AdjustStockOnSaleUseCase,
 * and DexieDatabase behind a simplified API for the PosTerminalComponent.
 *
 * Responsibilities:
 * - Cart state exposure (signals)
 * - Cart operations (add, remove, clear)
 * - Stock validation on add
 * - Checkout orchestration (receipt + stock adjustment + cart clear)
 * - Database initialization
 *
 * Does NOT contain business logic — delegates to use-cases and services.
 */
@Injectable({ providedIn: 'root' })
export class PosFacade {
  private readonly cartService = inject(CartService);
  private readonly generateReceipt = inject(GenerateReceiptUseCase);
  private readonly adjustStock = inject(AdjustStockOnSaleUseCase);
  private readonly db = inject(DexieDatabase);
  private readonly eventBus = inject(EventBusService);
  private readonly auditLog = inject(AuditLogService);
  private readonly telemetry = inject(TelemetryService);
  private readonly customers = inject(CustomerService);
  private readonly awardLoyaltyPoints = inject(AwardLoyaltyPointsUseCase);
  private readonly transactionRemote = inject(TransactionRemoteService);
  private readonly persistTransaction = inject(PersistTransactionUseCase);

  /** The customer attached to the sale in progress, if any. */
  private readonly _attachedCustomer = signal<AttachedCustomer | null>(null);

  // ─── Cart State (read-only signals) ───────────────────────────────────

  /** Current cart items */
  readonly cartItems = this.cartService.items;

  /** Total number of items in cart */
  readonly totalItems = this.cartService.totalItems;

  /** Cart subtotal before tax */
  readonly subtotal = this.cartService.subtotal;

  /** Tax amount */
  readonly tax = this.cartService.tax;

  /** Cart total including tax */
  readonly total = this.cartService.total;

  /** Whether the cart is empty */
  readonly isCartEmpty = this.cartService.isEmpty;

  /**
   * Monotonic revision of the cart's contents, for callers that need to know the
   * cart moved rather than what it now holds.
   *
   * Sourced straight from `CartService` and deliberately not derived from this
   * facade's own methods: `shopping-cart.component.ts` and `checkout.component.ts`
   * inject `CartService` directly, so a facade-level counter would miss every
   * mutation made from `/pos` — which is precisely the "foreign" mutation a
   * `/clerk` caller needs to see.
   *
   * Consumers: the agentic clerk's `context.cartChangedThisTurn`, and the
   * foreign-mutation abort that stops a batch part-way through.
   */
  readonly cartRevision = this.cartService.revision;

  /**
   * The customer this sale belongs to, or null for an anonymous sale.
   *
   * Anonymous is the normal case and stays fully supported: nothing about checkout
   * changes when this is null.
   */
  readonly attachedCustomer = this._attachedCustomer.asReadonly();

  // ─── Cart Operations ──────────────────────────────────────────────────

  /**
   * Adds a product to the cart with stock validation, returning a structured
   * result so callers can surface *why* an add was rejected (out of stock vs.
   * all available stock already in the cart).
   */
  tryAddToCart(product: Product): AddToCartResult {
    if (product.isOutOfStock()) {
      return { added: false, reason: 'out-of-stock' };
    }

    const currentQuantity = this.cartService.getQuantity(product.id);
    if (currentQuantity >= product.stock || currentQuantity >= MAX_QTY_PER_PRODUCT) {
      return { added: false, reason: 'max-stock-reached' };
    }

    this.cartService.addProduct(product);
    this.eventBus.publish(
      busEvent(
        EventType.CART_ITEM_ADDED,
        EventSource.POS_FACADE,
        { productId: product.id, name: product.name, price: product.price },
        { priority: 'normal' }
      )
    );
    return { added: true };
  }

  /**
   * Adds a product to the cart with stock validation.
   * @returns true if product was added, false if rejected (out of stock or exceeds available)
   */
  addToCart(product: Product): boolean {
    return this.tryAddToCart(product).added;
  }

  /** Increase quantity of a product in cart */
  increaseQuantity(productId: string): void {
    this.cartService.increaseQuantity(productId);
  }

  /** Decrease quantity of a product in cart */
  decreaseQuantity(productId: string): void {
    this.cartService.decreaseQuantity(productId);
  }

  /** Remove a product from cart entirely */
  removeFromCart(productId: string): void {
    this.cartService.removeItem(productId);
    this.eventBus.publish(
      busEvent(
        EventType.CART_ITEM_REMOVED,
        EventSource.POS_FACADE,
        { productId },
        { priority: 'normal' }
      )
    );
  }

  /**
   * Voids the sale in progress: empties the cart and releases the loyalty card.
   *
   * The two belong together. Clearing the cart is how a cashier abandons a sale,
   * and a card left attached across that boundary silently awards the walked-away
   * shopper's points to whoever steps up next.
   */
  clearCart(): void {
    this.cartService.clearCart();
    this.detachCustomer();
  }

  /** Get current quantity of a product in cart */
  getQuantity(productId: string): number {
    return this.cartService.getQuantity(productId);
  }

  // ─── Customer Identity ────────────────────────────────────────────────

  /**
   * Attaches the customer holding a loyalty card to the sale in progress, so the
   * sale can earn them points.
   *
   * The code arrives from the scanner (`qr_code` is already in the scanner's format
   * list) or from the keypad; the repository normalises either spelling.
   *
   * @param code - The code on the card, in any spelling `normalizeLoyaltyCode` accepts
   * @returns The attached customer, or null if the code matched nobody
   */
  async attachCustomerByLoyaltyCode(code: string): Promise<AttachedCustomer | null> {
    // A lookup that fails leaves the sale anonymous rather than blocking it: the
    // queue must keep moving whatever IndexedDB is doing.
    const found = await this.customers.getCustomerByLoyaltyCode(code).catch((error: unknown) => {
      console.error('[PosFacade] Loyalty code lookup failed:', error);
      return null;
    });

    if (!found) {
      return null;
    }

    const attached: AttachedCustomer = {
      id: found.id,
      name: found.name,
      loyaltyPoints: found.loyaltyPoints,
      tier: found.tier,
    };
    this._attachedCustomer.set(attached);

    this.eventBus.publish(
      busEvent(
        EventType.CUSTOMER_ATTACHED,
        EventSource.POS_FACADE,
        { customerId: attached.id, tier: attached.tier },
        { priority: 'normal' }
      )
    );

    return attached;
  }

  /**
   * Attaches a `Customer` entity directly to the current sale.
   *
   * Used by the kiosk shop, which resolves the customer through
   * `KioskCustomerService` before checkout rather than through a loyalty-code scan.
   * Fires the same `CUSTOMER_ATTACHED` event so downstream listeners (loyalty,
   * event-bus monitors) behave identically to the POS path.
   */
  attachCustomerDirectly(customer: Customer): void {
    const attached: AttachedCustomer = {
      id: customer.id,
      name: customer.name,
      loyaltyPoints: customer.loyaltyPoints,
      tier: customer.tier,
    };
    this._attachedCustomer.set(attached);

    this.eventBus.publish(
      busEvent(
        EventType.CUSTOMER_ATTACHED,
        EventSource.POS_FACADE,
        { customerId: attached.id, tier: attached.tier },
        { priority: 'normal' }
      )
    );
  }

  /** Drops the attached customer, leaving the sale anonymous. */
  detachCustomer(): void {
    this._attachedCustomer.set(null);
  }

  // ─── Checkout Operations ──────────────────────────────────────────────

  /**
   * Complete a sale.
   *
   * @param paymentResult  Payment result from CheckoutComponent.
   * @param remoteToken    Optional Bearer token for the remote-first write:
   *                       - Kiosk terminal: device token from KioskSettingsService.
   *                       - Customer phone (/shop): session token from sessionStorage.
   *                       - POS terminal (no kiosk): omit — remote write is skipped.
   *
   * When `remoteToken` is supplied, `POST /api/transactions` is called BEFORE the
   * cart is cleared. If that call fails, this method throws `RemoteTransactionFailedError`
   * and the cart is left intact so the customer can retry.
   */
  async checkout(paymentResult: PaymentResult, remoteToken?: string): Promise<ReceiptData> {
    // Remote-first write: must succeed before we touch the cart.
    if (remoteToken) {
      const customer = this._attachedCustomer();
      await this.transactionRemote.persistTransaction(
        paymentResult,
        remoteToken,
        customer?.id,
        undefined // customerEmail not available at facade level
      );
    }

    // Capture the attached customer BEFORE the sale ends and detaches them
    const attachedCustomer = this._attachedCustomer();

    // Capture cart items BEFORE clearing for stock adjustment
    const cartItems = this.cartService.items();
    const stockAdjustmentItems = cartItems.map(
      (item: { product: { id: string }; quantity: number }) => ({
        productId: item.product.id,
        quantity: item.quantity,
      })
    );

    // Generate receipt from current cart state BEFORE clearing
    const receipt = this.generateReceipt.execute(paymentResult);

    // One id for everything this sale causes: its outbox event and its bus events.
    const correlationId = generateUUID();

    // The local record and its SaleCompleted event, written together (#352). After
    // the remote write, so a sale the server refused is never recorded here, and
    // before the cart is cleared, because the record is built from it.
    const recorded = await this.recordSale(paymentResult, attachedCustomer, correlationId);

    // Stock is the SaleCompleted handler's job now (#354), and it has run once by the
    // time `recordSale` resolves. Only a sale with no event behind it — the local
    // write deferred or refused — still takes stock off inline, so the till never
    // shows sold items as available.
    if (!recorded) {
      try {
        const result: StockAdjustmentResult = await this.adjustStock.execute(stockAdjustmentItems);
        if (!result.success) {
          console.error('[PosFacade] Stock adjustment partially failed:', result.failedAdjustments);
        }
      } catch (error) {
        console.error('[PosFacade] Stock adjustment failed entirely:', error);
      }
    }

    // Clear cart after checkout
    this.cartService.clearCart();

    this.eventBus.publish(
      busEvent(
        EventType.TRANSACTION_COMPLETED,
        EventSource.POS_FACADE,
        {
          itemCount: stockAdjustmentItems.length,
          amount: paymentResult.amount,
          method: paymentResult.method,
        },
        { priority: 'high', correlationId }
      )
    );

    // Observability (fire-and-forget): feed the audit log + telemetry so the
    // agent-monitor dashboard reflects real POS activity. Deliberately NOT
    // awaited — checkout must never block or fail on logging.
    this.auditLog
      .log({
        agentName: 'PaymentAgent',
        operation: 'processPayment',
        entityType: 'Transaction',
        entityId: paymentResult.transactionId,
        action: AuditAction.EXECUTE,
        status: AuditStatus.SUCCESS,
        metadata: { method: paymentResult.method, amount: paymentResult.amount },
      })
      .catch((error) => console.error('[PosFacade] Audit log failed:', error));
    try {
      this.telemetry.recordCounter('payments.processed', 1, { method: paymentResult.method });
      this.telemetry.recordGauge('payment.amount', paymentResult.amount, {
        method: paymentResult.method,
      });
    } catch (error) {
      console.error('[PosFacade] Telemetry failed:', error);
    }

    // Loyalty (fire-and-forget): the sale is already paid for, so a points write is
    // not allowed to fail it or to hold the queue up behind an IndexedDB round trip.
    if (attachedCustomer) {
      this.awardPointsForSale(attachedCustomer, paymentResult.amount);
    }

    // The sale ends the customer's session. Without this the next shopper inherits
    // the last one's card and silently earns their points.
    this.detachCustomer();

    return receipt;
  }

  /**
   * Records the sale locally with its `SaleCompleted` event. Never throws: the sale
   * has been paid for, so a failed local write is logged, retried in the background
   * by the sale outbox, and kept out of what the cashier sees.
   *
   * @returns whether an event now stands behind this sale, i.e. its handlers own the
   *   side effects. False means the caller must apply them inline.
   */
  private async recordSale(
    paymentResult: PaymentResult,
    customer: AttachedCustomer | null,
    correlationId: string
  ): Promise<boolean> {
    try {
      const result = await this.persistTransaction.execute({
        paymentMethod: paymentResult.method,
        transactionId: paymentResult.transactionId,
        ...(customer ? { customerId: customer.id } : {}),
        sale: {
          correlationId,
          amount: paymentResult.amount,
          // Loyalty, audit and telemetry still run inline but have no SaleCompleted
          // handler yet (#355, #356), so nothing is listed as applied.
          appliedInline: [],
          // Stock runs inline only if this record is deferred; see checkout().
          fallbackInline: [ADJUST_STOCK_ON_SALE_HANDLER],
        },
      });
      if (!result.success) {
        console.warn(
          `[PosFacade] Sale ${paymentResult.transactionId} not recorded locally yet:`,
          result.error ?? result.outcome
        );
      }
      return result.outcome === 'recorded' || result.outcome === 'already-recorded';
    } catch (error) {
      console.error('[PosFacade] Recording the sale locally failed:', error);
      return false;
    }
  }

  /**
   * Awards the points earned by a completed sale, without waiting for the write.
   *
   * The use case reports every failure as a result rather than throwing, so the
   * `.catch` here is a backstop for an unexpected one.
   */
  private awardPointsForSale(customer: AttachedCustomer, amount: number): void {
    this.awardLoyaltyPoints
      .execute({ customerId: customer.id, purchaseAmount: amount })
      .then((result) => this.onPointsAwarded(customer, result))
      .catch((error) => console.error('[PosFacade] Loyalty award failed:', error));
  }

  /** Publishes the award, or logs why the sale earned nothing. */
  private onPointsAwarded(customer: AttachedCustomer, result: LoyaltyAwardResult): void {
    if (!result.awarded) {
      console.warn(
        `[PosFacade] Sale awarded no loyalty points (${result.reason}):`,
        result.error ?? ''
      );
      return;
    }

    this.eventBus.publish(
      busEvent(
        EventType.LOYALTY_POINTS_AWARDED,
        EventSource.POS_FACADE,
        {
          customerId: customer.id,
          points: result.points,
          balance: result.balance,
          tier: result.tier,
          promoted: result.previousTier !== result.tier,
        },
        { priority: 'normal' }
      )
    );
  }

  // ─── Database Operations ──────────────────────────────────────────────

  /** Initialize local bootstrap data when enabled */
  async initializeDatabase(): Promise<void> {
    await this.db.initializeWithSeedData();
  }
}
