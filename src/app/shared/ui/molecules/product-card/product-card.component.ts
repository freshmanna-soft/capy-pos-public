import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '@shared/ui/atoms/card/card.component';
import { ButtonComponent } from '@shared/ui/atoms/button/button.component';
import { BadgeComponent } from '@shared/ui/atoms/badge/badge.component';
import { Product } from '@core/domain/entities/product.entity';

/**
 * Product Card Component (Molecule)
 * Combines Card, Button, and Badge atoms to display product information
 * Used in POS terminal and inventory management
 */
@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent, BadgeComponent],
  template: `
    <app-card [clickable]="true" (click)="onCardClick()">
      <div class="product-card">
        <!-- Product Image -->
        <div class="product-image">
          <img
            [src]="product.imageUrl || '/assets/placeholder-product.png'"
            [alt]="product.name"
            class="w-full h-32 object-cover rounded-t-lg"
          />

          <!-- Stock Badge -->
          @if (showStockBadge) {
            <app-badge [variant]="stockBadgeVariant" class="absolute top-2 right-2">
              {{ product.stock }} in stock
            </app-badge>
          }
        </div>

        <!-- Product Info -->
        <div class="product-info">
          <div class="product-header">
            <h3 class="product-name">{{ product.name }}</h3>
            <span class="product-price">{{ product.price | currency }}</span>
          </div>

          @if (product.description) {
            <p class="product-description">
              {{ product.description }}
            </p>
          }

          <div class="product-meta">
            <app-badge variant="secondary" size="sm">
              {{ product.category }}
            </app-badge>

            <span class="product-sku">SKU: {{ product.sku }}</span>
          </div>

          <!-- Action Buttons -->
          <div class="product-actions">
            @if (showAddToCart) {
              <app-button
                variant="primary"
                size="sm"
                [fullWidth]="true"
                [disabled]="product.stock === 0 || !product.isActive"
                (clicked)="onAddToCart()"
              >
                {{ product.stock === 0 ? 'Out of Stock' : 'Add to Cart' }}
              </app-button>
            }

            @if (showQuickView) {
              <app-button variant="secondary" size="sm" (clicked)="onQuickView($event)">
                Quick View
              </app-button>
            }
          </div>
        </div>
      </div>
    </app-card>
  `,
  styles: [
    `
      .product-card {
        @apply flex flex-col h-full;
      }

      .product-image {
        @apply relative;
      }

      .product-info {
        @apply p-4 flex flex-col gap-3 flex-1;
      }

      .product-header {
        @apply flex justify-between items-start gap-2;
      }

      .product-name {
        @apply text-lg font-semibold text-gray-900 line-clamp-2;
      }

      .product-price {
        @apply text-lg font-bold text-blue-600 whitespace-nowrap;
      }

      .product-description {
        @apply text-sm text-gray-600 line-clamp-2;
      }

      .product-meta {
        @apply flex items-center justify-between gap-2;
      }

      .product-sku {
        @apply text-xs text-gray-500;
      }

      .product-actions {
        @apply flex gap-2 mt-auto;
      }
    `,
  ],
})
export class ProductCardComponent {
  @Input() product!: Product;
  @Input() showAddToCart = true;
  @Input() showQuickView = false;
  @Input() showStockBadge = true;

  @Output() addToCart = new EventEmitter<Product>();
  @Output() quickView = new EventEmitter<Product>();
  @Output() cardClick = new EventEmitter<Product>();

  get stockBadgeVariant(): 'success' | 'warning' | 'danger' {
    if (this.product.stock === 0) return 'danger';
    if (this.product.stock <= this.product.lowStockThreshold) return 'warning';
    return 'success';
  }

  onAddToCart(): void {
    if (this.product.stock > 0 && this.product.isActive) {
      this.addToCart.emit(this.product);
    }
  }

  onQuickView(event: MouseEvent): void {
    event.stopPropagation();
    this.quickView.emit(this.product);
  }

  onCardClick(): void {
    this.cardClick.emit(this.product);
  }
}

// Made with Bob
