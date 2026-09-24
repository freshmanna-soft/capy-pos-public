import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  ElementRef,
  Injector,
  ViewChild,
  afterNextRender,
  effect,
  DestroyRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CartService, MAX_QTY_PER_PRODUCT } from '@core/application/services/cart.service';
import { ProductService } from '@core/application/services/product.service';
import { KioskSettingsService } from '@core/application/services/kiosk-settings.service';
import { GeofencingService } from '@core/application/services/geofencing.service';
import { KioskCustomerService } from '@features/kiosk/kiosk-customer.service';
import { PosFacade } from '@core/application/facades';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { pickPresentedCode } from '@core/infrastructure/media/barcode-gate';
import { Product } from '@core/domain/entities/product.entity';
import {
  CheckoutComponent,
  PaymentResult,
} from '@features/pos-terminal/components/checkout/checkout.component';
import { ReceiptComponent } from '@features/pos-terminal/components/receipt/receipt.component';
import { ReceiptData } from '@core/application/use-cases/generate-receipt.use-case';
import { CustomerBuilder } from '@core/domain/entities/customer.builder';
import { CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { environment } from '../../../environments/environment';

const MAX_QTY = MAX_QTY_PER_PRODUCT;

/** sessionStorage key for the shop-session JWT. */
const SESSION_TOKEN_KEY = 'shop-session-token';

/** How often the barcode decoder is polled while the sheet is open. */
const SCAN_POLL_MS = 150;

/** Close the sheet automatically after this long with no successful scan. */
const SCAN_TIMEOUT_MS = 25_000;

/** How long the success / error toast stays visible before auto-close (success only). */
const TOAST_DURATION_MS = 1_500;

type ShopView = 'resolving' | 'store-picker' | 'acquiring-session' | 'session-error' | 'shopping';

type ScanState = 'idle' | 'starting' | 'scanning' | 'failed';

/**
 * ShopComponent
 *
 * Dedicated route for the customer-phone scan-and-go flow (`/shop`).
 * No URL params, no QR scan, no staff setup needed.
 *
 * Boot sequence:
 *  1. Load KioskSettingsService — resolves store from Dexie or defaults.
 *  2. If exactly one store or GPS confirms location → use it.
 *     If multiple stores and GPS denied → show store picker.
 *  3. Call POST /api/shop/session { storeId } → store token in sessionStorage.
 *  4. Show the full shopping UI (mirrors KioskShopComponent).
 *
 * Remote-first: checkout POSTs the basket to /api/transactions with the
 * session token before showing a receipt. On failure → error banner,
 * cart preserved.
 */
@Component({
  selector: 'app-shop',
  standalone: true,
  imports: [CheckoutComponent, ReceiptComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CameraService],
  template: `
    <!-- ── Resolving / loading ──────────────────────────────────────────── -->
    @if (view() === 'resolving') {
      <div
        class="fixed inset-0 flex items-center justify-center bg-onsen-deep"
        data-testid="shop-resolving"
      >
        <div class="flex flex-col items-center gap-4 text-center px-8">
          <span class="text-5xl animate-pulse" aria-hidden="true">🛒</span>
          <p class="text-steam font-display text-xl font-bold">Setting up your session…</p>
          <p class="text-kelp/70 text-sm">Just a moment.</p>
        </div>
      </div>
    }

    <!-- ── Store picker ─────────────────────────────────────────────────── -->
    @if (view() === 'store-picker') {
      <div
        class="fixed inset-0 flex items-center justify-center bg-onsen-deep px-6"
        data-testid="shop-store-picker"
      >
        <div class="flex flex-col items-center gap-5 w-full max-w-sm text-center">
          <span class="text-5xl" aria-hidden="true">🏪</span>
          <h1 class="font-display text-2xl font-bold text-steam">Which store are you in?</h1>
          <p class="text-kelp/70 text-sm leading-relaxed">
            Location access was unavailable. Tap your store to continue.
          </p>
          @for (store of kioskSettings.stores(); track store.storeId) {
            <button
              class="w-full px-5 py-4 rounded-2xl border border-onsen-surface/60 bg-onsen-surface/20
                     text-left flex flex-col gap-0.5 active:bg-onsen-surface/50 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60"
              (click)="pickStore(store.storeId)"
              [attr.data-testid]="'shop-store-pick-' + store.storeId"
            >
              <span class="text-steam font-semibold text-sm">{{
                store.name || store.storeId
              }}</span>
              @if (store.address) {
                <span class="text-kelp/60 text-xs">📍 {{ store.address }}</span>
              }
            </button>
          }
        </div>
      </div>
    }

    <!-- ── Session error ─────────────────────────────────────────────────── -->
    @if (view() === 'session-error') {
      <div
        class="fixed inset-0 flex items-center justify-center bg-onsen-deep px-6"
        data-testid="shop-session-error"
      >
        <div class="flex flex-col items-center gap-5 w-full max-w-sm text-center">
          <span class="text-5xl" aria-hidden="true">⚠️</span>
          <h1 class="font-display text-xl font-bold text-steam">Could not start session</h1>
          <p class="text-kelp/70 text-sm leading-relaxed">
            {{
              sessionError() ||
                'A network error occurred. Please check your connection and try again.'
            }}
          </p>
          <button
            class="w-full min-h-[56px] rounded-2xl bg-yuzu text-onsen-deep font-display font-bold text-lg
                   active:scale-95 transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-yuzu/60"
            (click)="retrySession()"
            data-testid="shop-session-retry"
          >
            🔄 Try Again
          </button>
        </div>
      </div>
    }

    <!-- ── Shopping UI ───────────────────────────────────────────────────── -->
    @if (view() === 'shopping') {
      <div
        class="fixed inset-0 flex flex-col lg:flex-row bg-onsen-deep overflow-hidden"
        data-testid="shop-shell"
        role="presentation"
        tabindex="-1"
        (click)="resetIdleTimer()"
        (keydown)="resetIdleTimer()"
      >
        <!-- Idle countdown banner -->
        @if (idleCountdown() > 0) {
          <div
            class="absolute inset-x-0 bottom-0 z-[200] flex items-center justify-between gap-4
                   bg-onsen-deep/95 border-t border-onsen-surface/60 px-6 py-4"
            data-testid="shop-idle-hint"
          >
            <p class="text-steam/80 text-sm font-medium">
              🕐 No activity — session resets in
              <strong class="text-yuzu">{{ idleCountdown() }}s</strong>
            </p>
            <button
              class="px-4 py-2 rounded-xl bg-yuzu text-onsen-deep text-sm font-bold active:scale-95 transition-transform"
              (click)="resetIdleTimer()"
              data-testid="shop-idle-keep-shopping"
            >
              Keep shopping
            </button>
          </div>
        }

        <!-- Product catalogue -->
        <main class="flex flex-col flex-1 min-h-0 overflow-hidden">
          <!-- Top bar -->
          <div class="flex items-center gap-3 px-4 pt-4 pb-3 flex-shrink-0 lg:px-6 lg:pt-5">
            <div class="flex flex-col flex-1 min-w-0">
              <h1 class="font-display text-lg font-bold text-steam truncate lg:text-xl">
                {{ kioskSettings.storeName() || 'Browse & Add Items' }}
              </h1>
              @if (kioskSettings.storeName() && kioskSettings.storeAddress()) {
                <p class="text-kelp/60 text-xs truncate">📍 {{ kioskSettings.storeAddress() }}</p>
              }
            </div>

            <!-- Account button -->
            <button
              class="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-onsen-surface/40 border border-onsen-surface/60
                     text-steam/80 active:bg-onsen-surface/70 transition-colors text-sm font-medium min-h-[44px]
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-steam/40"
              (click)="showAuthModal.set(true)"
              aria-label="Your account"
              data-testid="shop-account-btn"
            >
              {{
                kioskCustomer.customer()
                  ? '👤 ' + (kioskCustomer.customer()?.name ?? 'You')
                  : '👤 Account'
              }}
            </button>

            <!-- Scan button — shown only when BarcodeDetector is available -->
            @if (canScan()) {
              <button
                class="flex items-center justify-center rounded-xl bg-onsen-surface/40 border border-onsen-surface/60
                       text-steam/80 active:bg-onsen-surface/70 transition-colors min-h-[44px] min-w-[44px]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-steam/40"
                (click)="toggleScan()"
                [attr.aria-label]="showScanSheet() ? 'Close scanner' : 'Scan a barcode'"
                data-testid="shop-scan-btn"
              >
                📷
              </button>
            }
          </div>

          <!-- Category chips -->
          <div
            class="flex items-center gap-2 overflow-x-auto px-4 pb-3 flex-shrink-0 lg:px-6"
            style="-webkit-overflow-scrolling: touch; scrollbar-width: none;"
          >
            <button
              class="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60 min-h-[40px]"
              [class]="
                selectedCategory() === null
                  ? 'bg-yuzu text-onsen-deep'
                  : 'bg-onsen-surface/50 text-steam/70'
              "
              (click)="selectCategory(null)"
              data-testid="shop-cat-all"
            >
              All
            </button>
            @for (cat of categories(); track cat) {
              <button
                class="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60 min-h-[40px]"
                [class]="
                  selectedCategory() === cat
                    ? 'bg-yuzu text-onsen-deep'
                    : 'bg-onsen-surface/50 text-steam/70'
                "
                (click)="selectCategory(cat)"
                [attr.data-testid]="'shop-cat-' + cat"
              >
                {{ cat }}
              </button>
            }
          </div>

          <!-- Product grid -->
          <div
            class="flex-1 min-h-0 overflow-y-auto px-4 pb-4 lg:px-6"
            data-testid="shop-product-grid"
          >
            @if (isLoading()) {
              <div class="flex items-center justify-center h-full">
                <p class="text-steam/50 text-lg">Loading products…</p>
              </div>
            } @else if (filteredProducts().length === 0) {
              <div class="flex items-center justify-center h-full">
                <p class="text-steam/50 text-lg">No products found.</p>
              </div>
            } @else {
              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                @for (product of filteredProducts(); track product.id) {
                  <button
                    class="group flex flex-col items-center gap-2 p-3 rounded-2xl bg-onsen-water
                           border border-onsen-surface/60 active:scale-95 transition-transform
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60
                           disabled:opacity-40 disabled:cursor-not-allowed min-h-[140px]"
                    [disabled]="product.stock === 0"
                    (click)="addToCart(product)"
                    [attr.aria-label]="'Add ' + product.name"
                    [attr.data-testid]="'shop-product-' + product.id"
                  >
                    <div class="w-full rounded-xl overflow-hidden" style="height:70px;">
                      @if (product.imageUrl) {
                        <img
                          class="w-full h-full object-cover"
                          [src]="product.imageUrl"
                          [alt]="product.name"
                          loading="lazy"
                        />
                      } @else {
                        <div
                          class="w-full h-full"
                          [style.background]="productGradient(product.id)"
                        ></div>
                      }
                    </div>
                    <p class="w-full text-steam text-xs font-semibold text-center line-clamp-2">
                      {{ product.name }}
                    </p>
                    <p class="text-yuzu text-sm font-bold">\${{ product.price.toFixed(2) }}</p>
                    @if (product.stock === 0) {
                      <span
                        class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-tsuba text-white text-[10px] font-bold uppercase"
                        >Out</span
                      >
                    }
                  </button>
                }
              </div>
            }
          </div>
        </main>

        <!-- Order summary sidebar (desktop) -->
        <aside
          class="hidden lg:flex flex-col w-[340px] xl:w-[380px] bg-onsen-water border-l border-onsen-surface/60 flex-shrink-0 overflow-hidden"
          data-testid="shop-order-summary"
        >
          <div class="px-6 py-5 border-b border-onsen-surface/60 flex-shrink-0">
            <h2 class="font-display text-lg font-bold text-steam">Your Order</h2>
          </div>
          <div class="flex-1 overflow-y-auto px-6 py-4" #shopCartItems>
            @if (cartService.isEmpty()) {
              <div class="flex items-center justify-center h-full">
                <p class="text-kelp/60 text-sm text-center">
                  Your cart is empty.<br />Tap a product to add it.
                </p>
              </div>
            } @else {
              <div class="flex flex-col gap-3">
                @for (item of cartService.items(); track item.product.id) {
                  <div class="flex items-center gap-3">
                    <div class="flex-1 min-w-0">
                      <p class="text-steam text-sm font-semibold truncate">
                        {{ item.product.name }}
                      </p>
                      <p class="text-kelp/70 text-xs">\${{ item.product.price.toFixed(2) }} each</p>
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        class="w-7 h-7 rounded-lg bg-onsen-surface/60 text-steam text-sm font-bold active:bg-onsen-surface"
                        (click)="decrementItem(item.product.id)"
                      >
                        −
                      </button>
                      <span class="text-steam text-sm w-5 text-center font-semibold">{{
                        item.quantity
                      }}</span>
                      <button
                        class="w-7 h-7 rounded-lg bg-onsen-surface/60 text-steam text-sm font-bold active:bg-onsen-surface disabled:opacity-40"
                        (click)="incrementItem(item.product.id)"
                        [disabled]="item.quantity >= maxQty"
                      >
                        +
                      </button>
                    </div>
                    <p class="text-yuzu text-sm font-bold w-14 text-right">
                      \${{ (item.product.price * item.quantity).toFixed(2) }}
                    </p>
                  </div>
                }
              </div>
            }
          </div>
          <div class="px-6 py-5 border-t border-onsen-surface/60 flex-shrink-0 flex flex-col gap-3">
            <div class="flex justify-between text-steam/70 text-sm">
              <span>Subtotal</span><span>\${{ cartService.subtotal().toFixed(2) }}</span>
            </div>
            <div class="flex justify-between text-steam/70 text-sm">
              <span>Tax</span><span>\${{ cartService.tax().toFixed(2) }}</span>
            </div>
            <div class="flex justify-between text-steam font-display text-lg font-bold">
              <span>Total</span
              ><span data-testid="shop-total">\${{ cartService.total().toFixed(2) }}</span>
            </div>
            <button
              class="w-full min-h-[56px] rounded-2xl bg-yuzu text-onsen-deep font-display font-bold text-lg
                     active:scale-95 transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-yuzu/60
                     disabled:opacity-40 disabled:cursor-not-allowed"
              [disabled]="cartService.isEmpty()"
              (click)="openCheckout()"
              data-testid="shop-pay-now"
            >
              🛒 Pay Now · \${{ cartService.total().toFixed(2) }}
            </button>
          </div>
        </aside>

        <!-- Mobile pay FAB -->
        @if (!cartService.isEmpty()) {
          <div class="lg:hidden fixed bottom-6 inset-x-4 z-50" data-testid="shop-cart-fab">
            <button
              class="w-full min-h-[60px] rounded-2xl bg-yuzu text-onsen-deep font-display font-bold text-lg shadow-lg shadow-yuzu/30 active:scale-95 transition-transform"
              (click)="openCheckout()"
            >
              🛒 Pay · \${{ cartService.total().toFixed(2) }} ({{ cartService.totalItems() }} items)
            </button>
          </div>
        }

        <!-- Checkout overlay -->
        @if (showCheckout()) {
          <app-checkout
            [kioskMode]="true"
            (paymentComplete)="handlePaymentComplete($event)"
            (checkoutCancelled)="closeCheckout()"
            data-testid="shop-checkout"
          />
        }

        <!-- Checkout error banner -->
        @if (checkoutError()) {
          <div
            class="fixed inset-x-0 bottom-0 z-[1050] flex items-center justify-between gap-4
                   bg-red-900/95 border-t border-red-700/60 px-6 py-5"
            role="alert"
            data-testid="shop-checkout-error"
          >
            <p class="text-white text-sm font-medium leading-snug">⚠️ {{ checkoutError() }}</p>
            <button
              class="flex-shrink-0 px-5 py-2.5 rounded-xl bg-white text-red-900 font-display font-bold text-sm active:scale-95"
              (click)="checkoutError.set(null); showCheckout.set(true)"
              data-testid="shop-checkout-error-retry"
            >
              Try Again
            </button>
          </div>
        }

        <!-- Barcode scan bottom sheet — z-[600]: above Pay FAB (z-50), below checkout error (z-[1050]) -->
        @if (showScanSheet()) {
          <div
            class="fixed inset-0 z-[600] flex flex-col justify-end"
            data-testid="shop-scan-sheet-wrapper"
          >
            <!-- Backdrop tap area — closes the sheet -->
            <div
              class="flex-1"
              role="button"
              tabindex="0"
              (click)="teardownScan()"
              (keydown.enter)="teardownScan()"
              (keydown.space)="teardownScan()"
              aria-label="Close scanner"
              data-testid="shop-scan-backdrop"
            ></div>

            <!-- Sheet -->
            <div
              class="h-[60vh] rounded-t-3xl bg-onsen-deep overflow-hidden flex flex-col
                     transition-transform"
              data-testid="shop-scan-sheet"
            >
              <!-- Drag handle pill -->
              <div class="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div class="w-10 h-1 rounded-full bg-steam/30"></div>
              </div>

              <!-- Camera preview fills the sheet -->
              <div class="relative flex-1 overflow-hidden">
                <video
                  #shopScanVideo
                  class="absolute inset-0 w-full h-full object-cover"
                  muted
                  playsinline
                  autoplay
                  aria-hidden="true"
                  data-testid="shop-scan-video"
                ></video>

                <!-- SVG crosshair guide -->
                <svg
                  class="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <rect
                    x="15"
                    y="30"
                    width="70"
                    height="40"
                    rx="3"
                    ry="3"
                    fill="none"
                    stroke="white"
                    stroke-width="0.8"
                    stroke-dasharray="6 3"
                    opacity="0.7"
                  />
                </svg>

                <!-- Toast banner -->
                @if (_scanToast()) {
                  <div
                    class="absolute inset-x-4 bottom-4 px-4 py-3 rounded-2xl text-sm font-semibold text-center"
                    [class]="
                      _scanToast()!.kind === 'success'
                        ? 'bg-green-600/90 text-white'
                        : 'bg-amber-500/90 text-onsen-deep'
                    "
                    role="status"
                    data-testid="shop-scan-toast"
                  >
                    {{ _scanToast()!.text }}
                  </div>
                }

                <!-- Starting overlay -->
                @if (_scanState() === 'starting') {
                  <div class="absolute inset-0 flex items-center justify-center bg-onsen-deep/70">
                    <p class="text-steam/70 text-sm">Starting camera…</p>
                  </div>
                }
              </div>
            </div>
          </div>
        }

        <!-- Receipt overlay -->
        @if (showReceipt() && receiptData()) {
          <div class="fixed inset-0 z-[1100]" data-testid="shop-receipt-wrapper">
            <app-receipt
              [data]="receiptData()!"
              (newTransaction)="handleNewTransaction()"
              (printReceipt)="handlePrintReceipt()"
              data-testid="shop-receipt"
            />
            @if (receiptCountdown() > 0) {
              <div
                class="fixed bottom-0 inset-x-0 flex items-center justify-center gap-2 py-3 px-5
                          bg-black/70 text-white/80 text-sm font-medium z-[1200]"
              >
                🕐 Closing in <strong class="text-yuzu">{{ receiptCountdown() }}s</strong>
              </div>
            }
          </div>
        }

        <!-- Auth modal (email-only account) -->
        @if (showAuthModal()) {
          <div
            class="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/60 p-4"
            role="presentation"
            tabindex="-1"
            (click)="showAuthModal.set(false)"
            (keydown.escape)="showAuthModal.set(false)"
          >
            <div
              class="relative w-full max-w-sm bg-onsen-water rounded-3xl shadow-2xl p-8 flex flex-col gap-6"
              (click)="$event.stopPropagation()"
              (keydown)="$event.stopPropagation()"
              tabindex="0"
            >
              <button
                class="absolute top-4 right-4 w-10 h-10 rounded-full bg-onsen-surface/60 text-steam/80 hover:text-steam flex items-center justify-center"
                (click)="showAuthModal.set(false)"
                aria-label="Close"
              >
                ✕
              </button>
              <h2 class="font-display text-2xl font-bold text-steam text-center">Your Account</h2>
              <div class="flex flex-col gap-2">
                <label for="shop-email" class="text-steam/80 text-sm font-medium"
                  >Email address</label
                >
                <input
                  id="shop-email"
                  type="email"
                  [(ngModel)]="authEmail"
                  placeholder="you@example.com"
                  class="min-h-[56px] rounded-xl bg-onsen-deep border border-onsen-surface/60 text-steam placeholder-kelp/60 px-4 text-base focus:outline-none focus:ring-2 focus:ring-yuzu/60"
                  autocomplete="email"
                  data-testid="shop-auth-email"
                  (keydown.enter)="handleSignIn()"
                />
              </div>
              @if (authError()) {
                <p
                  class="text-red-400 text-sm text-center"
                  role="alert"
                  data-testid="shop-auth-error"
                >
                  {{ authError() }}
                </p>
              }
              <div class="flex flex-col gap-3">
                <button
                  class="w-full min-h-[56px] rounded-xl bg-yuzu text-onsen-deep font-display text-lg font-bold active:scale-95"
                  [disabled]="authBusy()"
                  (click)="handleSignIn()"
                  data-testid="shop-sign-in-submit"
                >
                  {{ authBusy() ? 'Signing in…' : 'Sign In' }}
                </button>
                <button
                  class="w-full min-h-[56px] rounded-xl border-2 border-onsen-surface text-steam font-display text-lg font-semibold active:bg-onsen-surface/40"
                  [disabled]="authBusy()"
                  (click)="handleCreateAccount()"
                  data-testid="shop-create-account"
                >
                  {{ authBusy() ? 'Creating…' : 'Create Account' }}
                </button>
              </div>
              <p class="text-kelp/70 text-xs text-center">
                A customer account lets you earn loyalty points and track your orders.
              </p>
              <div class="border-t border-onsen-surface/40 pt-4 text-center">
                <button
                  class="text-kelp/50 text-xs hover:text-kelp/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-kelp/40"
                  (click)="goToStaffLogin()"
                  data-testid="shop-staff-login"
                >
                  🔒 Staff login
                </button>
              </div>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class ShopComponent implements OnInit, OnDestroy {
  // ── Services ────────────────────────────────────────────────────────────────
  private readonly router = inject(Router);
  readonly cartService = inject(CartService);
  private readonly productService = inject(ProductService);
  readonly kioskSettings = inject(KioskSettingsService);
  private readonly geofencing = inject(GeofencingService);
  readonly kioskCustomer = inject(KioskCustomerService);
  private readonly posFacade = inject(PosFacade);
  private readonly camera = inject(CameraService);
  private readonly scanner = inject(BarcodeScannerService);
  private readonly injector = inject(Injector);
  private readonly customerRepo = inject(CUSTOMER_REPOSITORY);
  private readonly authGateway = inject(AUTH_GATEWAY);

  // ── View state ───────────────────────────────────────────────────────────────
  readonly view = signal<ShopView>('resolving');
  readonly sessionError = signal<string | null>(null);
  readonly resolvedStoreId = signal<string | null>(null);

  // ── Shopping state ───────────────────────────────────────────────────────────
  readonly maxQty = MAX_QTY;
  readonly isLoading = signal(false);
  readonly selectedCategory = signal<string | null>(null);
  readonly showCheckout = signal(false);
  readonly checkoutError = signal<string | null>(null);
  readonly showReceipt = signal(false);
  readonly receiptData = signal<ReceiptData | null>(null);
  readonly receiptCountdown = signal(0);
  readonly idleCountdown = signal(0);

  // ── Auth modal ───────────────────────────────────────────────────────────────
  readonly showAuthModal = signal(false);
  readonly authError = signal<string | null>(null);
  readonly authBusy = signal(false);
  authEmail = '';

  // ── Product data ──────────────────────────────────────────────────────────────
  private readonly _products = signal<Product[]>([]);
  readonly categories = computed(() =>
    [...new Set(this._products().map((p) => p.category))].sort()
  );
  readonly filteredProducts = computed(() => {
    const cat = this.selectedCategory();
    return cat === null ? this._products() : this._products().filter((p) => p.category === cat);
  });

  // ── Scan state ────────────────────────────────────────────────────────────────
  readonly _scanState = signal<ScanState>('idle');
  readonly _scanToast = signal<{ kind: 'success' | 'error'; text: string } | null>(null);
  private readonly _detectorReady = signal(false);
  readonly canScan = computed(() => this._detectorReady() && this.scanner.supported());
  readonly showScanSheet = computed(() => this._scanState() !== 'idle');

  // ── Scan timers ───────────────────────────────────────────────────────────────
  private scanPoll: ReturnType<typeof setTimeout> | null = null;
  private scanDeadline: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Idle / receipt timers ─────────────────────────────────────────────────────
  private readonly shopIdleTimeoutMs = 120_000;
  private readonly receiptAutoDismissMs = 30_000;
  private shopIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private shopIdleStarted = false;
  private receiptDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private receiptCountdownTimer: ReturnType<typeof setInterval> | null = null;

  @ViewChild('shopCartItems') private shopCartItemsRef?: ElementRef<HTMLElement>;

  // The video element only exists while the sheet is open; attach the camera
  // stream the moment it appears — same race-removing pattern as BarcodeScanFieldComponent.
  @ViewChild('shopScanVideo')
  private set scanVideoRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    const el = ref?.nativeElement;
    if (!el) return;
    this.camera.attach(el);
    // play() may return undefined in JSDOM (tests) or a Promise in real browsers.
    const playResult = el.play();
    if (playResult instanceof Promise) {
      void playResult.catch(() => undefined);
    }
  }

  constructor() {
    // Prime the detector up-front so canScan() is true before the first tap.
    void this.scanner.prepare().then((r) => this._detectorReady.set(r));

    // Camera must not outlive the component under any exit path.
    inject(DestroyRef).onDestroy(() => this.teardownScan());

    effect(() => {
      const items = this.cartService.items();
      if (items.length > 0) {
        afterNextRender(
          () => {
            const el = this.shopCartItemsRef?.nativeElement;
            if (el) el.scrollTop = el.scrollHeight;
          },
          { injector: this.injector }
        );
      }
    });
  }

  async ngOnInit(): Promise<void> {
    await this.kioskSettings.load();
    const storeId = await this.resolveStore();
    this.resolvedStoreId.set(storeId);
    if (storeId !== null) {
      await this.acquireSession(storeId);
    }
    // If store picker is showing, session will be acquired after user picks.
  }

  ngOnDestroy(): void {
    this.clearIdleTimers();
    this.clearReceiptTimers();
    this.geofencing.reset();
  }

  // ── Barcode scan ─────────────────────────────────────────────────────────────

  toggleScan(): void {
    if (this.showScanSheet()) {
      this.teardownScan();
    } else {
      void this.startScan();
    }
  }

  private async startScan(): Promise<void> {
    this._scanState.set('starting');
    this._scanToast.set(null);

    if (!(await this.camera.start())) {
      this._scanState.set('failed');
      return;
    }

    this._scanState.set('scanning');
    // bindScanVideo() happens automatically via the @ViewChild setter when
    // Angular inserts #shopScanVideo into the DOM on the next render cycle.
    this.scheduleScanTick();
    this.scanDeadline = setTimeout(() => this.teardownScan(), SCAN_TIMEOUT_MS);
  }

  private scheduleScanTick(): void {
    this.scanPoll = setTimeout(() => void this.scanTick(), SCAN_POLL_MS);
  }

  private async scanTick(): Promise<void> {
    this.scanPoll = null;
    if (this._scanState() !== 'scanning') return;

    const video = this.camera.detectionSource();
    if (!video) {
      this.scheduleScanTick();
      return;
    }

    const found = await this.scanner.detect(video);
    if (found === null || found.length === 0) {
      this.scheduleScanTick();
      return;
    }

    const presented = pickPresentedCode(found);
    if (!presented) {
      this.scheduleScanTick();
      return;
    }

    const products = this._products();
    const product = products.find((p) => p.barcode === presented.value);
    if (product) {
      if (navigator.vibrate) navigator.vibrate(50);
      this._scanToast.set({ kind: 'success', text: `✓ Added — ${product.name}` });
      this.addToCart(product);
      this.toastTimer = setTimeout(() => this.teardownScan(), TOAST_DURATION_MS);
    } else {
      this._scanToast.set({ kind: 'error', text: 'Product not found — try again or browse above' });
      this.scheduleScanTick();
    }
  }

  teardownScan(): void {
    if (this.scanPoll !== null) {
      clearTimeout(this.scanPoll);
      this.scanPoll = null;
    }
    if (this.scanDeadline !== null) {
      clearTimeout(this.scanDeadline);
      this.scanDeadline = null;
    }
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.camera.stop();
    this._scanState.set('idle');
    this._scanToast.set(null);
  }

  // ── Store resolution ─────────────────────────────────────────────────────────

  /**
   * Resolve the active storeId using the three-step fallback:
   * 1. Exactly one store → use it.
   * 2. Multiple stores + GPS inside → use active storeId.
   * 3. Multiple stores + GPS denied/error → show picker, return null.
   * 4. No stores → use default ('default-org/default-store').
   */
  private async resolveStore(): Promise<string | null> {
    const stores = this.kioskSettings.stores();

    if (stores.length === 0) {
      return 'default-org/default-store';
    }

    if (stores.length === 1 || !this.kioskSettings.hasFencePolygon()) {
      return this.kioskSettings.storeId();
    }

    // Multiple stores — try geofence
    try {
      const status = await this.geofencing.checkFence();
      if (status === 'inside') {
        return this.kioskSettings.storeId();
      }
    } catch {
      // fall through to picker
    }

    // GPS unavailable or outside — show store picker
    this.view.set('store-picker');
    return null;
  }

  async pickStore(storeId: string): Promise<void> {
    const terminal = this.kioskSettings.terminals().find((t) => t.storeId === storeId);
    if (terminal) {
      await this.kioskSettings.setActiveTerminal(terminal.terminalId);
    }
    this.resolvedStoreId.set(storeId);
    await this.acquireSession(storeId);
  }

  // ── Session acquisition ──────────────────────────────────────────────────────

  private async acquireSession(storeId: string): Promise<void> {
    // Reuse an existing valid session token from sessionStorage
    const existing = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (existing) {
      this.startShopping();
      return;
    }

    this.view.set('acquiring-session');
    try {
      const response = await fetch(`${environment.apiUrl}/shop/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId }),
      });
      if (!response.ok) {
        throw new Error(`Session request failed: ${response.status}`);
      }
      const data = (await response.json()) as { token: string; expiresAt: string };
      sessionStorage.setItem(SESSION_TOKEN_KEY, data.token);
      this.startShopping();
    } catch (err) {
      this.sessionError.set(
        err instanceof Error ? err.message : 'Could not connect to the store server.'
      );
      this.view.set('session-error');
    }
  }

  async retrySession(): Promise<void> {
    this.sessionError.set(null);
    const storeId = this.resolvedStoreId();
    if (storeId) {
      await this.acquireSession(storeId);
    } else {
      this.view.set('resolving');
      await this.ngOnInit();
    }
  }

  private startShopping(): void {
    this.view.set('shopping');
    this.loadProducts();
    this.startShopIdleTimer();
  }

  // ── Product loading ──────────────────────────────────────────────────────────

  private loadProducts(): void {
    this.isLoading.set(true);
    this.productService
      .getActiveProducts()
      .then((products) => {
        this._products.set(products);
        this.isLoading.set(false);
      })
      .catch(() => {
        this.isLoading.set(false);
      });
  }

  // ── Cart actions ─────────────────────────────────────────────────────────────

  addToCart(product: Product): void {
    this.cartService.addProduct(product);
    this.resetIdleTimer();
  }

  incrementItem(productId: string): void {
    const item = this.cartService.items().find((i) => i.product.id === productId);
    if (item && item.quantity < MAX_QTY) {
      this.cartService.updateQuantity(productId, item.quantity + 1);
    }
  }

  decrementItem(productId: string): void {
    const item = this.cartService.items().find((i) => i.product.id === productId);
    if (item) {
      if (item.quantity <= 1) {
        this.cartService.removeItem(productId);
      } else {
        this.cartService.updateQuantity(productId, item.quantity - 1);
      }
    }
  }

  selectCategory(cat: string | null): void {
    this.selectedCategory.set(cat);
  }

  productGradient(id: string): string {
    const hue = (id.charCodeAt(0) * 37 + id.charCodeAt(id.length - 1) * 13) % 360;
    return `linear-gradient(135deg, hsl(${hue},40%,25%), hsl(${(hue + 60) % 360},30%,15%))`;
  }

  // ── Checkout flow ────────────────────────────────────────────────────────────

  openCheckout(): void {
    if (this.cartService.isEmpty()) return;
    const customer = this.kioskCustomer.customer();
    if (customer) {
      this.posFacade.attachCustomerDirectly(customer);
    }
    this.showCheckout.set(true);
  }

  closeCheckout(): void {
    this.showCheckout.set(false);
    this.posFacade.detachCustomer();
    this.startShopIdleTimer();
  }

  handlePaymentComplete(result: PaymentResult): void {
    // Pass the shop-session token so PosFacade performs the remote-first write
    // before clearing the cart. Token was stored in sessionStorage on page load.
    const sessionToken = sessionStorage.getItem('shop-session-token') ?? undefined;
    this.posFacade
      .checkout(result, sessionToken)
      .then((receipt) => {
        this.checkoutError.set(null);
        this.receiptData.set(receipt);
        this.showCheckout.set(false);
        this.clearIdleTimers();
        this.showReceipt.set(true);
        this.startReceiptTimer();
        this.kioskCustomer.clear();
        this.posFacade.detachCustomer();
      })
      .catch((err: unknown) => {
        // Persistence failed — cart preserved, no receipt.
        console.error('[ShopComponent] checkout failed:', err);
        this.showCheckout.set(false);
        const detail = err instanceof Error ? ` (${err.message})` : '';
        this.checkoutError.set(
          `Payment could not be saved — please try again or ask a cashier.${detail}`
        );
      });
  }

  handleNewTransaction(): void {
    this.clearReceiptTimers();
    this.showReceipt.set(false);
    this.receiptData.set(null);
    void this.router.navigate(['/shop']);
  }

  handlePrintReceipt(): void {
    this.clearReceiptTimers();
    this.startReceiptTimer();
    globalThis.print();
  }

  goToStaffLogin(): void {
    void this.router.navigate(['/login']);
  }

  // ── Auth modal ───────────────────────────────────────────────────────────────

  async handleSignIn(): Promise<void> {
    const email = this.authEmail.trim().toLowerCase();
    if (!email) {
      this.authError.set('Please enter your email address.');
      return;
    }
    if (!email.includes('@')) {
      this.authError.set('Please enter a valid email address.');
      return;
    }
    this.authBusy.set(true);
    this.authError.set(null);
    try {
      const customer = await this.customerRepo.findByEmail(email);
      if (customer) {
        this.kioskCustomer.set(customer);
        this.showAuthModal.set(false);
        this.authEmail = '';
      } else {
        this.authError.set('No account found for that email. Use "Create Account" to register.');
      }
    } catch {
      this.authError.set('Could not sign in. Please try again.');
    } finally {
      this.authBusy.set(false);
    }
  }

  async handleCreateAccount(): Promise<void> {
    const email = this.authEmail.trim().toLowerCase();
    if (!email) {
      this.authError.set('Please enter your email address.');
      return;
    }
    if (!email.includes('@')) {
      this.authError.set('Please enter a valid email address.');
      return;
    }
    this.authBusy.set(true);
    this.authError.set(null);
    try {
      const existing = await this.customerRepo.findByEmail(email);
      if (existing) {
        this.kioskCustomer.set(existing);
        this.showAuthModal.set(false);
        this.authEmail = '';
        return;
      }
      const newCustomer = new CustomerBuilder()
        .withEmail(email)
        .withName(email.split('@')[0])
        // Phone is intentionally empty — /shop form is email-only.
        .withPhone('')
        .withStatus(CustomerStatus.ACTIVE)
        .withTier(CustomerTier.BRONZE)
        .build();
      const created = await this.customerRepo.create(newCustomer);
      this.kioskCustomer.set(created);
      this.showAuthModal.set(false);
      this.authEmail = '';
    } catch {
      this.authError.set('Could not create account. Please try again.');
    } finally {
      this.authBusy.set(false);
    }
  }

  // ── Idle timer ───────────────────────────────────────────────────────────────

  resetIdleTimer(): void {
    this.clearIdleTimers();
    this.idleCountdown.set(0);
    this.startShopIdleTimer();
  }

  private startShopIdleTimer(): void {
    this.clearIdleTimers();
    this.shopIdleStarted = false;
    const countdownMs = this.shopIdleTimeoutMs - 15_000;
    setTimeout(() => {
      if (this.shopIdleStarted) return;
      this.shopIdleStarted = true;
      let remaining = 15;
      this.idleCountdown.set(remaining);
      setInterval(() => {
        remaining -= 1;
        this.idleCountdown.set(remaining);
      }, 1_000);
    }, countdownMs);
    this.shopIdleTimer = setTimeout(() => {
      this.clearIdleTimers();
      this.cartService.clearCart();
      void this.router.navigate(['/shop']);
    }, this.shopIdleTimeoutMs);
  }

  private clearIdleTimers(): void {
    if (this.shopIdleTimer) {
      clearTimeout(this.shopIdleTimer);
      this.shopIdleTimer = null;
    }
    this.idleCountdown.set(0);
  }

  // ── Receipt timer ─────────────────────────────────────────────────────────────

  private startReceiptTimer(): void {
    let remaining = 30;
    this.receiptCountdown.set(remaining);
    this.receiptCountdownTimer = setInterval(() => {
      remaining -= 1;
      this.receiptCountdown.set(remaining);
      if (remaining <= 0) {
        this.clearReceiptTimers();
        this.handleNewTransaction();
      }
    }, 1_000);
  }

  private clearReceiptTimers(): void {
    if (this.receiptDismissTimer) {
      clearTimeout(this.receiptDismissTimer);
      this.receiptDismissTimer = null;
    }
    if (this.receiptCountdownTimer) {
      clearInterval(this.receiptCountdownTimer);
      this.receiptCountdownTimer = null;
    }
    this.receiptCountdown.set(0);
  }
}
