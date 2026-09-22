import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  ElementRef,
  Injector,
  ViewChild,
  afterNextRender,
  effect,
  inject,
  signal,
  computed,
} from '@angular/core';
import { Router } from '@angular/router';
import { ProductService } from '@core/application/services/product.service';
import { CartService, MAX_QTY_PER_PRODUCT } from '@core/application/services/cart.service';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import {
  BarcodeGate,
  INSTANT_TIMING,
  pickPresentedCode,
} from '@core/infrastructure/media/barcode-gate';
import { Product } from '@core/domain/entities/product.entity';
import {
  CheckoutComponent,
  PaymentResult,
} from '@features/pos-terminal/components/checkout/checkout.component';
import { ReceiptComponent } from '@features/pos-terminal/components/receipt/receipt.component';
import { ReceiptData } from '@core/application/use-cases/generate-receipt.use-case';
import { PosFacade } from '@core/application/facades';
import { KioskSettingsService } from '@core/application/services/kiosk-settings.service';
import { GeofencingService } from '@core/application/services/geofencing.service';

/** Poll cadence — matches the clerk's barcode-only mode. */
const POLL_MS = 150;

/**
 * KioskShopComponent
 *
 * Full-screen self-checkout terminal — no staff chrome.
 *
 * Layout:
 *   Left panel : category chips + inline camera viewfinder (collapsible) + product grid.
 *   Right panel: order summary sidebar (desktop) / bottom-sheet FAB (mobile).
 *
 * The barcode scanner is integrated into the left panel — not a separate modal.
 * Tapping "📷 Scan" opens an inline viewfinder between the chips and the grid;
 * the camera runs until a barcode is confirmed (INSTANT_TIMING — zero dwell,
 * same gate the clerk uses with AI off), the product is added, and the viewfinder
 * collapses. The same CameraService isolation pattern as BarcodeScanFieldComponent:
 * a component-level provider so this instance never disturbs the staff clerk session.
 */
@Component({
  selector: 'app-kiosk-shop',
  standalone: true,
  imports: [CheckoutComponent, ReceiptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Own CameraService so kiosk scanning never touches the shared clerk instance.
  providers: [CameraService],
  template: `
    <div
      class="fixed inset-0 flex flex-col lg:flex-row bg-onsen-deep overflow-hidden"
      data-testid="kiosk-shop"
    >
      <!-- Idle-reset countdown — shown during the last 15 s of inactivity -->
      @if (idleCountdown() > 0) {
        <div
          class="absolute inset-x-0 bottom-0 z-[200] flex items-center justify-between gap-4
                 bg-onsen-deep/95 border-t border-onsen-surface/60 px-6 py-4"
          data-testid="kiosk-idle-hint"
          (click)="$event.stopPropagation(); resetIdleTimer()"
          (keydown)="$event.stopPropagation(); resetIdleTimer()"
          tabindex="0"
        >
          <p class="text-steam/80 text-sm font-medium">
            🕐 No activity detected — session resets in
            <strong class="text-yuzu">{{ idleCountdown() }}s</strong>
          </p>
          <button
            class="px-4 py-2 rounded-xl bg-yuzu text-onsen-deep text-sm font-bold
                   active:scale-95 transition-transform focus:outline-none"
            (click)="resetIdleTimer()"
            data-testid="kiosk-idle-keep-shopping"
          >
            Keep shopping
          </button>
        </div>
      }

      <!-- ── Product catalog (full width on mobile, 65% on desktop) ──── -->
      <main class="flex flex-col flex-1 min-h-0 overflow-hidden">
        <!-- Top bar -->
        <div class="flex items-center gap-3 px-4 pt-4 pb-3 flex-shrink-0 lg:px-6 lg:pt-5">
          <button
            class="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-onsen-surface/70
                   text-steam/80 active:bg-onsen-surface/40 transition-colors text-sm font-medium
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-steam/40 min-h-[44px] flex-shrink-0"
            (click)="requestBack()"
            aria-label="Back to welcome screen"
            data-testid="kiosk-back-btn"
          >
            ← Back
          </button>
          <div class="flex flex-col flex-1 min-w-0">
            <h1 class="font-display text-lg font-bold text-steam truncate lg:text-xl">
              {{
                kioskSettings.storeName() ||
                  (scannerOpen() ? 'Scan a barcode' : 'Browse & Add Items')
              }}
            </h1>
            @if (kioskSettings.storeName() && kioskSettings.storeAddress()) {
              <p class="text-kelp/60 text-xs truncate">📍 {{ kioskSettings.storeAddress() }}</p>
            }
          </div>
        </div>

        <!-- Category chips + scan toggle — one row, unified bar -->
        <div
          class="flex items-center gap-2 overflow-x-auto px-4 pb-3 flex-shrink-0 lg:px-6"
          style="-webkit-overflow-scrolling: touch; scrollbar-width: none;"
        >
          <!-- Scan toggle chip — same height/shape as category chips -->
          @if (scannerSupported()) {
            <button
              class="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold
                     transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60 min-h-[40px]"
              [class]="
                scannerOpen()
                  ? 'bg-yuzu text-onsen-deep'
                  : 'bg-onsen-surface/50 text-steam/70 active:bg-onsen-surface/80'
              "
              (click)="toggleScanner()"
              [attr.aria-pressed]="scannerOpen()"
              aria-label="Toggle barcode scanner"
              data-testid="kiosk-scan-toggle"
            >
              <span class="leading-none">{{ scannerOpen() ? '✕' : '📷' }}</span>
              <span>Scan</span>
            </button>
          }

          <!-- Category filter chips -->
          <button
            class="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60 min-h-[40px]"
            [class]="
              selectedCategory() === null
                ? 'bg-yuzu text-onsen-deep'
                : 'bg-onsen-surface/50 text-steam/70 active:bg-onsen-surface/80'
            "
            (click)="selectCategory(null)"
            role="tab"
            [attr.aria-selected]="selectedCategory() === null"
            data-testid="kiosk-cat-all"
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
                  : 'bg-onsen-surface/50 text-steam/70 active:bg-onsen-surface/80'
              "
              (click)="selectCategory(cat)"
              role="tab"
              [attr.aria-selected]="selectedCategory() === cat"
              [attr.data-testid]="'kiosk-cat-' + cat"
            >
              {{ cat }}
            </button>
          }
        </div>

        <!-- Inline barcode viewfinder — collapses when not scanning -->
        @if (scannerOpen()) {
          <div
            class="mx-4 mb-3 rounded-2xl overflow-hidden flex-shrink-0 bg-black relative lg:mx-6"
            style="height: 200px;"
            data-testid="kiosk-scanner-viewfinder"
          >
            <video
              #scanPreview
              class="absolute inset-0 w-full h-full object-cover"
              muted
              playsinline
              autoplay
              aria-hidden="true"
            ></video>

            <!-- Bracket corners -->
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div class="relative w-48 h-24">
                <span
                  class="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-yuzu rounded-tl-md"
                ></span>
                <span
                  class="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-yuzu rounded-tr-md"
                ></span>
                <span
                  class="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-yuzu rounded-bl-md"
                ></span>
                <span
                  class="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-yuzu rounded-br-md"
                ></span>
                @if (scannerState() === 'scanning') {
                  <div
                    class="absolute inset-x-1 h-px bg-yuzu/80 shadow-[0_0_6px_2px_rgba(251,191,36,0.5)] animate-scan-line"
                  ></div>
                }
              </div>
            </div>

            <!-- Status pill -->
            <div class="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none">
              @switch (scannerState()) {
                @case ('starting') {
                  <span
                    class="bg-black/60 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full"
                    >Starting camera…</span
                  >
                }
                @case ('scanning') {
                  <span
                    class="bg-black/60 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full"
                    >Hold a barcode inside the frame</span
                  >
                }
                @case ('found') {
                  <span
                    class="bg-green-600/90 text-white text-xs font-bold px-4 py-1.5 rounded-full"
                    >✓ Added to cart!</span
                  >
                }
                @case ('not-found') {
                  <span
                    class="bg-red-600/80 text-white text-xs font-semibold px-3 py-1.5 rounded-full"
                    >Barcode not in catalogue — try another</span
                  >
                }
                @case ('error') {
                  <span
                    class="bg-black/70 text-white/90 text-xs font-medium px-3 py-1.5 rounded-full text-center max-w-[260px]"
                    >{{ scannerError() }}</span
                  >
                }
                @case ('unsupported') {
                  <span
                    class="bg-black/70 text-white/80 text-xs px-3 py-1.5 rounded-full text-center max-w-[260px]"
                  >
                    Camera scanning requires Chrome on Android
                  </span>
                }
              }
            </div>
          </div>
        }

        <!-- Product grid -->
        <div
          class="flex-1 overflow-y-auto px-4 pb-24 lg:pb-6 lg:px-6"
          data-testid="kiosk-product-grid"
        >
          @if (isLoading()) {
            <div class="flex items-center justify-center h-full" aria-live="polite">
              <p class="text-steam/50 text-lg">Loading products…</p>
            </div>
          } @else if (filteredProducts().length === 0) {
            <div class="flex items-center justify-center h-full" aria-live="polite">
              <p class="text-steam/50 text-lg">No products found.</p>
            </div>
          } @else {
            <div
              class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3"
            >
              @for (product of filteredProducts(); track product.id) {
                <button
                  class="group relative flex flex-col items-center gap-2 p-3 rounded-2xl bg-onsen-water
                         border border-onsen-surface/60 active:scale-95 transition-transform duration-150
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-yuzu/60
                         disabled:opacity-40 disabled:cursor-not-allowed min-h-[140px]"
                  [disabled]="product.stock === 0"
                  (click)="addToCart(product)"
                  [attr.aria-label]="'Add ' + product.name + ' — $' + product.price.toFixed(2)"
                  [attr.data-testid]="'kiosk-product-' + product.id"
                >
                  <div
                    class="w-full rounded-xl overflow-hidden flex-shrink-0"
                    style="height:70px;"
                    aria-hidden="true"
                  >
                    <div
                      class="w-full h-full"
                      [style.background]="productGradient(product.id)"
                    ></div>
                  </div>
                  <p
                    class="w-full text-steam text-xs font-semibold leading-tight line-clamp-2 text-center"
                  >
                    {{ product.name }}
                  </p>
                  <p class="text-yuzu text-sm font-bold">\${{ product.price.toFixed(2) }}</p>
                  @if (product.stock === 0) {
                    <span
                      class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-tsuba text-white text-[10px] font-bold uppercase"
                      >Out</span
                    >
                  }
                  <span
                    class="absolute inset-0 rounded-2xl bg-yuzu/0 group-active:bg-yuzu/10 transition-colors pointer-events-none"
                    aria-hidden="true"
                  ></span>
                </button>
              }
            </div>
          }
        </div>
      </main>

      <!-- ── Order summary: sidebar on desktop, bottom sheet on mobile ── -->

      <!-- Desktop sidebar (lg+) -->
      <aside
        class="hidden lg:flex flex-col w-[340px] xl:w-[380px] bg-onsen-water border-l border-onsen-surface/60 flex-shrink-0 overflow-hidden"
        aria-label="Order summary"
        data-testid="kiosk-order-summary"
      >
        <div class="px-6 py-5 border-b border-onsen-surface/60 flex-shrink-0">
          <h2 class="font-display text-lg font-bold text-steam">Your Order</h2>
          <p class="text-kelp text-sm mt-0.5">
            {{ cartService.totalItems() }} item{{ cartService.totalItems() !== 1 ? 's' : '' }}
          </p>
        </div>
        <div #kioskCartItems class="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          @if (cartService.isEmpty()) {
            <div
              class="flex flex-col items-center justify-center h-full gap-3 text-center px-4 py-12"
            >
              <p class="text-steam/40 text-4xl">🛒</p>
              <p class="text-steam/50 text-sm">Tap a product to add it, or scan a barcode.</p>
            </div>
          } @else {
            @for (item of cartService.items(); track item.product.id) {
              <div
                class="flex items-center gap-3 p-3 rounded-xl bg-onsen-surface/30"
                [attr.data-testid]="'kiosk-cart-item-' + item.product.id"
              >
                <div
                  class="w-10 h-10 rounded-lg flex-shrink-0"
                  [style.background]="productGradient(item.product.id)"
                  aria-hidden="true"
                ></div>
                <div class="flex-1 min-w-0">
                  <p class="text-steam text-sm font-medium truncate">{{ item.product.name }}</p>
                  <p class="text-yuzu text-xs font-semibold">
                    \${{ (item.product.price * item.quantity).toFixed(2) }}
                  </p>
                </div>
                <div class="flex items-center gap-1.5">
                  <button
                    class="w-8 h-8 rounded-lg bg-onsen-deep/60 text-steam text-lg flex items-center justify-center active:bg-onsen-deep transition-colors focus:outline-none"
                    (click)="decreaseOrRemove(item.product.id, item.quantity)"
                    [attr.aria-label]="'Remove one ' + item.product.name"
                  >
                    −
                  </button>
                  <span class="w-6 text-center text-steam text-sm font-bold">{{
                    item.quantity
                  }}</span>
                  <button
                    class="w-8 h-8 rounded-lg bg-onsen-deep/60 text-steam text-lg flex items-center justify-center active:bg-onsen-deep transition-colors focus:outline-none disabled:opacity-40"
                    [disabled]="
                      item.quantity >= item.product.stock || item.quantity >= maxQtyPerProduct
                    "
                    (click)="cartService.increaseQuantity(item.product.id)"
                    [attr.aria-label]="'Add one more ' + item.product.name"
                  >
                    +
                  </button>
                </div>
              </div>
            }
          }
        </div>
        <div class="px-6 py-5 border-t border-onsen-surface/60 flex-shrink-0 space-y-3">
          <div class="flex justify-between text-steam/70 text-sm">
            <span>Subtotal</span><span>\${{ cartService.subtotal().toFixed(2) }}</span>
          </div>
          <div class="flex justify-between text-steam/70 text-sm">
            <span>Tax ({{ (cartService.taxRate() * 100).toFixed(1) }}%)</span
            ><span>\${{ cartService.tax().toFixed(2) }}</span>
          </div>
          <div
            class="flex justify-between text-steam font-bold text-lg pt-1 border-t border-onsen-surface/60"
          >
            <span>Total</span
            ><span data-testid="kiosk-total">\${{ cartService.total().toFixed(2) }}</span>
          </div>
          <button
            class="w-full min-h-[64px] rounded-2xl bg-yuzu text-onsen-deep font-display text-xl font-bold
                   shadow-lg shadow-yuzu/30 active:scale-95 transition-transform
                   focus:outline-none focus-visible:ring-4 focus-visible:ring-yuzu/60
                   disabled:opacity-40 disabled:cursor-not-allowed mt-2"
            [disabled]="cartService.isEmpty() || fenceCheckingAtCheckout()"
            (click)="openCheckout()"
            aria-label="Proceed to payment"
            data-testid="kiosk-pay-now"
          >
            {{ fenceCheckingAtCheckout() ? '⏳ Checking location…' : 'Pay Now' }}
          </button>
        </div>
      </aside>

      <!-- Mobile cart FAB (visible below lg, only when cart has items) -->
      @if (!cartService.isEmpty()) {
        <button
          class="fixed bottom-6 right-4 z-30 lg:hidden flex items-center gap-2 px-5 py-4 rounded-2xl
                 bg-yuzu text-onsen-deep font-display font-bold text-base shadow-xl shadow-yuzu/40
                 active:scale-95 transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-yuzu/60"
          (click)="mobileCartOpen.set(true)"
          aria-label="View order"
          data-testid="kiosk-cart-fab"
        >
          🛒 View Order
          <span
            class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-onsen-deep/20 text-sm font-bold"
            >{{ cartService.totalItems() }}</span
          >
        </button>
      }

      <!-- Mobile order bottom sheet -->
      @if (mobileCartOpen()) {
        <div
          class="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Your order"
        >
          <div
            class="absolute inset-0 bg-black/60"
            (click)="mobileCartOpen.set(false)"
            aria-hidden="true"
          ></div>
          <div
            class="absolute bottom-0 inset-x-0 max-h-[80vh] bg-onsen-water rounded-t-3xl flex flex-col overflow-hidden"
          >
            <div class="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div class="w-10 h-1.5 rounded-full bg-onsen-surface/60"></div>
            </div>
            <div
              class="flex items-center justify-between px-5 py-3 border-b border-onsen-surface/60 flex-shrink-0"
            >
              <h2 class="font-display text-lg font-bold text-steam">Your Order</h2>
              <button
                class="w-9 h-9 rounded-full bg-onsen-surface/40 text-steam flex items-center justify-center focus:outline-none"
                (click)="mobileCartOpen.set(false)"
                aria-label="Close order summary"
              >
                ✕
              </button>
            </div>
            <div #kioskMobileCartItems class="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              @for (item of cartService.items(); track item.product.id) {
                <div class="flex items-center gap-3 p-3 rounded-xl bg-onsen-surface/30">
                  <div
                    class="w-10 h-10 rounded-lg flex-shrink-0"
                    [style.background]="productGradient(item.product.id)"
                    aria-hidden="true"
                  ></div>
                  <div class="flex-1 min-w-0">
                    <p class="text-steam text-sm font-medium truncate">{{ item.product.name }}</p>
                    <p class="text-yuzu text-xs font-semibold">
                      \${{ (item.product.price * item.quantity).toFixed(2) }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      class="w-9 h-9 rounded-lg bg-onsen-deep/60 text-steam text-xl flex items-center justify-center active:bg-onsen-deep focus:outline-none"
                      (click)="decreaseOrRemove(item.product.id, item.quantity)"
                      [attr.aria-label]="'Remove one ' + item.product.name"
                    >
                      −
                    </button>
                    <span class="w-6 text-center text-steam font-bold">{{ item.quantity }}</span>
                    <button
                      class="w-9 h-9 rounded-lg bg-onsen-deep/60 text-steam text-xl flex items-center justify-center active:bg-onsen-deep focus:outline-none disabled:opacity-40"
                      [disabled]="
                        item.quantity >= item.product.stock || item.quantity >= maxQtyPerProduct
                      "
                      (click)="cartService.increaseQuantity(item.product.id)"
                      [attr.aria-label]="'Add one more ' + item.product.name"
                    >
                      +
                    </button>
                  </div>
                </div>
              }
            </div>
            <div class="px-5 py-5 border-t border-onsen-surface/60 flex-shrink-0 space-y-3">
              <div class="flex justify-between text-steam/70 text-sm">
                <span>Subtotal</span><span>\${{ cartService.subtotal().toFixed(2) }}</span>
              </div>
              <div class="flex justify-between text-steam/70 text-sm">
                <span>Tax ({{ (cartService.taxRate() * 100).toFixed(1) }}%)</span
                ><span>\${{ cartService.tax().toFixed(2) }}</span>
              </div>
              <div
                class="flex justify-between text-steam font-bold text-xl pt-1 border-t border-onsen-surface/60"
              >
                <span>Total</span><span>\${{ cartService.total().toFixed(2) }}</span>
              </div>
              <button
                class="w-full min-h-[64px] rounded-2xl bg-yuzu text-onsen-deep font-display text-xl font-bold
                       shadow-lg shadow-yuzu/40 active:scale-95 transition-transform
                       focus:outline-none focus-visible:ring-4 focus-visible:ring-yuzu/60 mt-1
                       disabled:opacity-40 disabled:cursor-not-allowed"
                [disabled]="fenceCheckingAtCheckout()"
                (click)="mobileCartOpen.set(false); openCheckout()"
                data-testid="kiosk-pay-now-mobile"
              >
                {{ fenceCheckingAtCheckout() ? '⏳ Checking location…' : 'Pay Now' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Inline back-confirmation overlay -->
      @if (showBackConfirm()) {
        <div
          class="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Leave shopping"
          (click)="showBackConfirm.set(false)"
          (keyup.escape)="showBackConfirm.set(false)"
        >
          <div
            class="w-full max-w-sm bg-onsen-water rounded-3xl p-7 flex flex-col gap-5"
            (click)="$event.stopPropagation()"
            (keydown)="$event.stopPropagation()"
            tabindex="0"
          >
            <h3 class="font-display text-xl font-bold text-steam text-center">Leave shopping?</h3>
            <p class="text-steam/70 text-sm text-center">Your cart will be cleared.</p>
            <div class="flex flex-col gap-3">
              <button
                class="w-full min-h-[56px] rounded-xl bg-tsuba text-white font-display font-bold text-lg active:scale-95 transition-transform focus:outline-none"
                (click)="executeBack()"
                data-testid="kiosk-confirm-back"
              >
                Yes, leave
              </button>
              <button
                class="w-full min-h-[56px] rounded-xl border-2 border-onsen-surface text-steam font-semibold text-lg active:bg-onsen-surface/40 transition-colors focus:outline-none"
                (click)="showBackConfirm.set(false)"
                data-testid="kiosk-cancel-back"
              >
                Keep shopping
              </button>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- Geofence-blocked checkout overlay -->
    @if (fenceBlockedAtCheckout()) {
      <div
        class="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/70 p-4"
        role="alertdialog"
        aria-modal="true"
        aria-label="Outside store fence"
        data-testid="kiosk-fence-blocked-checkout"
      >
        <div
          class="w-full max-w-sm bg-onsen-water rounded-3xl p-8 flex flex-col items-center gap-5 text-center"
          (click)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()"
          tabindex="0"
        >
          <span class="text-5xl" aria-hidden="true">📍</span>
          <h3 class="font-display text-xl font-bold text-steam">You're outside the store</h3>
          <p class="text-kelp text-sm leading-relaxed">
            Payment can only be completed inside
            @if (kioskSettings.storeName()) {
              <strong class="text-steam">{{ kioskSettings.storeName() }}</strong
              >.
            } @else {
              the store.
            }
            Move back inside and try again, or ask a staff member for help.
          </p>
          <div class="flex flex-col gap-3 w-full">
            <button
              class="w-full min-h-[56px] rounded-2xl bg-yuzu text-onsen-deep font-display font-bold text-lg
                     active:scale-95 transition-transform focus:outline-none focus-visible:ring-4 focus-visible:ring-yuzu/60
                     disabled:opacity-50 disabled:cursor-not-allowed"
              (click)="fenceBlockedAtCheckout.set(false); openCheckout()"
              [disabled]="fenceCheckingAtCheckout()"
              data-testid="kiosk-fence-retry-checkout"
            >
              {{ fenceCheckingAtCheckout() ? '⏳ Checking…' : '🔄 Try again' }}
            </button>
            <button
              class="w-full min-h-[48px] rounded-2xl border border-onsen-surface/70 text-steam/70 font-semibold
                     active:bg-onsen-surface/40 transition-colors focus:outline-none"
              (click)="closeCheckout()"
              data-testid="kiosk-fence-dismiss-checkout"
            >
              Keep shopping
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Checkout overlay — kiosk mode when this terminal is configured as kiosk -->
    @if (showCheckout()) {
      <app-checkout
        [kioskMode]="kioskSettings.isKiosk()"
        (paymentComplete)="handlePaymentComplete($event)"
        (checkoutCancelled)="closeCheckout()"
        data-testid="kiosk-checkout"
      />
    }

    <!-- Receipt overlay — shown after a successful payment.
         A 30 s auto-dismiss timer starts when it appears; the last 10 s are
         shown as a countdown strip so the customer knows it will close. -->
    @if (showReceipt() && receiptData()) {
      <div class="fixed inset-0 z-[1100]" data-testid="kiosk-receipt-wrapper">
        <app-receipt
          [data]="receiptData()!"
          (newTransaction)="handleNewTransaction()"
          (printReceipt)="handlePrintReceipt()"
          data-testid="kiosk-receipt"
        />
        @if (receiptCountdown() > 0) {
          <div
            class="fixed bottom-0 inset-x-0 flex items-center justify-center gap-2 py-3 px-5
                   bg-black/70 text-white/80 text-sm font-medium z-[1200]"
            data-testid="kiosk-receipt-countdown"
          >
            <span
              >🕐 Closing in <strong class="text-yuzu">{{ receiptCountdown() }}s</strong></span
            >
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      @keyframes scan-line {
        0% {
          top: 2px;
          opacity: 1;
        }
        48% {
          top: calc(100% - 2px);
          opacity: 1;
        }
        50% {
          top: calc(100% - 2px);
          opacity: 0;
        }
        52% {
          top: 2px;
          opacity: 0;
        }
        54% {
          top: 2px;
          opacity: 1;
        }
        100% {
          top: 2px;
          opacity: 1;
        }
      }
      .animate-scan-line {
        animation: scan-line 1.8s ease-in-out infinite;
      }
    `,
  ],
})
export class KioskShopComponent implements OnInit, OnDestroy {
  // ── idle-reset timer (shop page) ───────────────────────────────────────────
  /** Seconds remaining before the session auto-resets due to inactivity. */
  readonly idleCountdown = signal(0);
  /** Seconds remaining before the receipt auto-dismisses. */
  readonly receiptCountdown = signal(0);

  private readonly shopIdleTimeoutMs = 120_000; // 2 min of inactivity → back to splash
  private readonly receiptAutoDismissMs = 30_000; // 30 s after payment → splash

  private shopIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private shopCountdownStartTimer: ReturnType<typeof setTimeout> | null = null;
  private shopCountdownTimer: ReturnType<typeof setInterval> | null = null;
  private shopIdleStarted = false;

  private receiptDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private receiptCountdownStartTimer: ReturnType<typeof setTimeout> | null = null;
  private receiptCountdownTimer: ReturnType<typeof setInterval> | null = null;
  private receiptCountdownStarted = false;

  private readonly router = inject(Router);
  private readonly productService = inject(ProductService);
  private readonly camera = inject(CameraService);
  private readonly scanner = inject(BarcodeScannerService);
  readonly cartService = inject(CartService);
  /** Exposed to the template for the per-product quantity cap. */
  readonly maxQtyPerProduct = MAX_QTY_PER_PRODUCT;
  /** Kiosk settings — loaded on init; drives payment method visibility. */
  readonly kioskSettings = inject(KioskSettingsService);
  private readonly geofencing = inject(GeofencingService);
  private readonly posFacade = inject(PosFacade);
  private readonly injector = inject(Injector);

  @ViewChild('scanPreview')
  private set previewRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    this._preview = ref?.nativeElement ?? null;
    this.bindPreview();
  }
  private _preview: HTMLVideoElement | null = null;

  @ViewChild('kioskCartItems')
  private kioskCartItemsRef?: ElementRef<HTMLElement>;

  @ViewChild('kioskMobileCartItems')
  private kioskMobileCartItemsRef?: ElementRef<HTMLElement>;

  /** Previous total quantity — used to detect additions for auto-scroll. */
  private previousTotalQuantity = 0;

  constructor() {
    // Scroll the active cart list to the bottom whenever an item is added or
    // its quantity increases, matching the behaviour of ShoppingCartComponent.
    effect(() => {
      const items = this.cartService.items();
      const currentTotal = items.reduce((sum, i) => sum + i.quantity, 0);
      if (currentTotal > this.previousTotalQuantity && items.length > 0) {
        this.scrollCartToBottom();
      }
      this.previousTotalQuantity = currentTotal;
    });
  }

  private scrollCartToBottom(): void {
    afterNextRender(
      () => {
        // Scroll whichever panel is currently visible.
        const sidebar = this.kioskCartItemsRef?.nativeElement;
        if (sidebar) {
          sidebar.scrollTo({ top: sidebar.scrollHeight, behavior: 'smooth' });
        }
        const mobile = this.kioskMobileCartItemsRef?.nativeElement;
        if (mobile) {
          mobile.scrollTo({ top: mobile.scrollHeight, behavior: 'smooth' });
        }
      },
      { injector: this.injector }
    );
  }

  // ── catalogue ──────────────────────────────────────────────────────────────
  readonly isLoading = signal(true);
  readonly allProducts = signal<Product[]>([]);
  readonly categories = signal<string[]>([]);
  readonly selectedCategory = signal<string | null>(null);

  /** Barcode / SKU → product index — built once when products load. */
  private codeIndex = new Map<string, Product>();

  readonly filteredProducts = computed(() => {
    const cat = this.selectedCategory();
    const products = this.allProducts();
    return cat === null ? products : products.filter((p) => p.category === cat);
  });

  // ── ui state ───────────────────────────────────────────────────────────────
  readonly showCheckout = signal(false);
  readonly mobileCartOpen = signal(false);
  readonly showBackConfirm = signal(false);
  /**
   * True when the device is confirmed outside the fence at checkout time.
   * Replaces the checkout overlay with a blocked-state message so the customer
   * can't proceed with payment while standing outside the store.
   */
  readonly fenceBlockedAtCheckout = signal(false);
  readonly fenceCheckingAtCheckout = signal(false);
  /** Receipt data populated after a successful payment — drives the receipt overlay. */
  readonly receiptData = signal<ReceiptData | null>(null);
  readonly showReceipt = signal(false);

  // ── scanner state ──────────────────────────────────────────────────────────
  readonly scannerOpen = signal(false);
  readonly scannerSupported = signal(false);
  readonly scannerState = signal<
    'idle' | 'starting' | 'scanning' | 'found' | 'not-found' | 'error' | 'unsupported'
  >('idle');
  readonly scannerError = signal('');

  private readonly gate = new BarcodeGate({ timing: INSTANT_TIMING, minWidth: 0.08 });
  private poll: ReturnType<typeof setTimeout> | null = null;

  // ── lifecycle ──────────────────────────────────────────────────────────────
  async ngOnInit(): Promise<void> {
    this.startShopIdleTimer();
    const [products, cats, supported] = await Promise.all([
      this.productService.getActiveProducts(),
      this.productService.getCategories(),
      this.scanner.prepare(),
      this.kioskSettings.load(),
    ]);
    this.allProducts.set(products);
    this.categories.set(cats);
    this.isLoading.set(false);
    this.scannerSupported.set(supported);
    this.codeIndex = buildCodeIndex(products);
  }

  ngOnDestroy(): void {
    this.stopScanner();
    this.clearShopIdleTimers();
    this.clearReceiptTimers();
  }

  // ── catalogue interaction ──────────────────────────────────────────────────
  selectCategory(cat: string | null): void {
    this.selectedCategory.set(cat);
  }

  addToCart(product: Product): void {
    if (product.stock === 0) return;
    this.cartService.addProduct(product);
  }

  decreaseOrRemove(productId: string, currentQty: number): void {
    if (currentQty <= 1) {
      this.cartService.removeItem(productId);
    } else {
      this.cartService.decreaseQuantity(productId);
    }
  }

  // ── scanner ────────────────────────────────────────────────────────────────
  async toggleScanner(): Promise<void> {
    if (this.scannerOpen()) {
      this.stopScanner();
      this.scannerOpen.set(false);
      return;
    }
    this.scannerOpen.set(true);
    this.scannerState.set('starting');

    if (!(await this.camera.start())) {
      this.scannerState.set('error');
      this.scannerError.set(
        this.camera.status() === 'denied'
          ? 'Camera permission denied — allow access in browser settings.'
          : 'Could not start the camera. Close other apps using the camera.'
      );
      return;
    }

    this.scannerState.set('scanning');
    this.bindPreview();
    this.scheduleTick();
  }

  private bindPreview(): void {
    if (!this._preview) return;
    this.camera.attach(this._preview);
    void this._preview.play().catch(() => undefined);
  }

  private scheduleTick(): void {
    this.poll = setTimeout(() => void this.tick(), POLL_MS);
  }

  private async tick(): Promise<void> {
    this.poll = null;
    if (this.scannerState() !== 'scanning') return;

    const video = this.camera.detectionSource();
    if (!video) {
      this.scheduleTick();
      return;
    }

    const found = await this.scanner.detect(video);
    if (found === null) {
      this.scheduleTick();
      return;
    }

    const presented = pickPresentedCode(found);
    if (!presented) {
      this.scheduleTick();
      return;
    }

    const verdict = this.gate.observe(presented.value, performance.now());
    if (verdict !== 'new') {
      this.scheduleTick();
      return;
    }

    // Barcode confirmed — look it up in the in-memory index (same as clerk).
    const product = this.codeIndex.get(presented.value);
    if (!product) {
      this.scannerState.set('not-found');
      this.gate.release();
      // Resume scanning after a short feedback pause.
      setTimeout(() => {
        if (this.scannerOpen()) {
          this.scannerState.set('scanning');
          this.scheduleTick();
        }
      }, 1800);
      return;
    }

    // Hit — flash feedback, add to cart, collapse the viewfinder.
    this.scannerState.set('found');
    this.stopScanner();
    this.addToCart(product);
    this.mobileCartOpen.set(true);

    // Collapse after the ✓ feedback resolves.
    setTimeout(() => {
      this.scannerOpen.set(false);
      this.scannerState.set('idle');
    }, 700);
  }

  private stopScanner(): void {
    if (this.poll !== null) {
      clearTimeout(this.poll);
      this.poll = null;
    }
    this.camera.stop();
  }

  // ── checkout ───────────────────────────────────────────────────────────────

  /**
   * Open the checkout overlay after a fresh fence check.
   *
   * A customer who entered the store legitimately but then walked outside will
   * see a "you're outside the store" message instead of the payment form.
   * The check is skipped when no polygon is configured so stores without
   * geofencing are never impacted.
   */
  async openCheckout(): Promise<void> {
    if (this.cartService.isEmpty()) return;

    if (this.kioskSettings.hasFencePolygon()) {
      this.fenceCheckingAtCheckout.set(true);
      try {
        this.geofencing.reset();
        const status = await this.geofencing.checkFence();
        if (status === 'outside') {
          this.fenceBlockedAtCheckout.set(true);
          return;
        }
      } finally {
        this.fenceCheckingAtCheckout.set(false);
      }
    }

    this.showCheckout.set(true);
  }

  closeCheckout(): void {
    this.showCheckout.set(false);
    this.fenceBlockedAtCheckout.set(false);
  }

  handlePaymentComplete(result: PaymentResult): void {
    // Generate receipt + persist transaction + adjust stock via the facade
    // (same path as the POS terminal). The cart must still be full at this
    // point — posFacade.checkout() reads it then clears it.
    this.posFacade
      .checkout(result)
      .then((receipt) => {
        this.receiptData.set(receipt);
        this.showCheckout.set(false);
        this.fenceBlockedAtCheckout.set(false);
        this.clearShopIdleTimers(); // pause shop idle while receipt is visible
        this.showReceipt.set(true);
        this.startReceiptTimer();
      })
      .catch(() => {
        // Fallback: even if persistence fails, still show the receipt with
        // the data we have rather than silently navigating away.
        const fallback = {
          payment: result,
          items: [...this.cartService.items()],
          subtotal: this.cartService.subtotal(),
          tax: this.cartService.tax(),
          taxRate: this.cartService.taxRate(),
          total: this.cartService.total(),
          storeName: this.kioskSettings.storeName() || 'Capy-POS',
          storeAddress: this.kioskSettings.storeAddress(),
        };
        this.receiptData.set(fallback);
        this.cartService.clearCart();
        this.showCheckout.set(false);
        this.clearShopIdleTimers();
        this.showReceipt.set(true);
        this.startReceiptTimer();
      });
  }

  handleNewTransaction(): void {
    this.clearReceiptTimers();
    this.showReceipt.set(false);
    this.receiptData.set(null);
    void this.router.navigate(['/kiosk']);
  }

  handlePrintReceipt(): void {
    // Reset the receipt auto-dismiss so it doesn't close while printing.
    this.clearReceiptTimers();
    this.startReceiptTimer();
    globalThis.print();
  }

  /** Called by any tap/key on the shop root — resets the 2-min idle timer. */
  resetIdleTimer(): void {
    this.clearShopIdleTimers();
    this.idleCountdown.set(0);
    this.startShopIdleTimer();
  }

  // ── idle-reset & receipt-auto-dismiss timers ───────────────────────────────

  private startShopIdleTimer(): void {
    // Visible countdown starts 15 s before the reset fires.
    const countdownStartMs = this.shopIdleTimeoutMs - 15_000;

    this.shopIdleTimer = setTimeout(() => {
      this.clearShopIdleTimers();
      this.cartService.clearCart();
      void this.router.navigate(['/kiosk']);
    }, this.shopIdleTimeoutMs);

    this.shopCountdownStartTimer = setTimeout(() => {
      this.shopCountdownStartTimer = null;
      if (this.shopIdleStarted) return;
      this.shopIdleStarted = true;
      let remaining = 15;
      this.idleCountdown.set(remaining);
      this.shopCountdownTimer = setInterval(() => {
        remaining -= 1;
        this.idleCountdown.set(remaining);
        if (remaining <= 0) this.clearShopCountdownTimer();
      }, 1_000);
    }, countdownStartMs);
  }

  private startReceiptTimer(): void {
    const countdownStartMs = this.receiptAutoDismissMs - 10_000;

    this.receiptDismissTimer = setTimeout(() => {
      this.handleNewTransaction();
    }, this.receiptAutoDismissMs);

    this.receiptCountdownStartTimer = setTimeout(() => {
      this.receiptCountdownStartTimer = null;
      if (this.receiptCountdownStarted) return;
      this.receiptCountdownStarted = true;
      let remaining = 10;
      this.receiptCountdown.set(remaining);
      this.receiptCountdownTimer = setInterval(() => {
        remaining -= 1;
        this.receiptCountdown.set(remaining);
        if (remaining <= 0) this.clearReceiptCountdownTimer();
      }, 1_000);
    }, countdownStartMs);
  }

  private clearShopIdleTimers(): void {
    if (this.shopIdleTimer !== null) {
      clearTimeout(this.shopIdleTimer);
      this.shopIdleTimer = null;
    }
    if (this.shopCountdownStartTimer !== null) {
      clearTimeout(this.shopCountdownStartTimer);
      this.shopCountdownStartTimer = null;
    }
    this.clearShopCountdownTimer();
    this.shopIdleStarted = false;
  }

  private clearShopCountdownTimer(): void {
    if (this.shopCountdownTimer !== null) {
      clearInterval(this.shopCountdownTimer);
      this.shopCountdownTimer = null;
    }
  }

  private clearReceiptTimers(): void {
    if (this.receiptDismissTimer !== null) {
      clearTimeout(this.receiptDismissTimer);
      this.receiptDismissTimer = null;
    }
    if (this.receiptCountdownStartTimer !== null) {
      clearTimeout(this.receiptCountdownStartTimer);
      this.receiptCountdownStartTimer = null;
    }
    this.clearReceiptCountdownTimer();
    this.receiptCountdownStarted = false;
    this.receiptCountdown.set(0);
  }

  private clearReceiptCountdownTimer(): void {
    if (this.receiptCountdownTimer !== null) {
      clearInterval(this.receiptCountdownTimer);
      this.receiptCountdownTimer = null;
    }
  }

  requestBack(): void {
    if (this.cartService.isEmpty()) {
      this.executeBack();
    } else {
      this.showBackConfirm.set(true);
    }
  }

  executeBack(): void {
    this.showBackConfirm.set(false);
    this.cartService.clearCart();
    void this.router.navigate(['/kiosk']);
  }

  productGradient(productId: string): string {
    let hash = 0;
    for (let i = 0; i < productId.length; i++) {
      hash = (hash * 31 + productId.charCodeAt(i)) >>> 0;
    }
    const h1 = hash % 360;
    const h2 = (h1 + 40) % 360;
    return `linear-gradient(135deg, hsl(${h1},55%,45%), hsl(${h2},60%,35%))`;
  }
}

/**
 * Build a barcode/SKU → product lookup map.
 * Mirrors the clerk facade's `buildCodeIndex` — first writer wins so a product's
 * explicit barcode is never shadowed by another product's SKU collision.
 */
function buildCodeIndex(catalog: readonly Product[]): Map<string, Product> {
  const index = new Map<string, Product>();
  for (const product of catalog) {
    for (const code of [product.barcode, product.sku]) {
      if (code && code.length > 0 && !index.has(code)) {
        index.set(code, product);
      }
    }
  }
  return index;
}
