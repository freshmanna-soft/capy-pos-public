import { Component, signal, computed } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Product } from './core/domain/entities/product.entity';
import { CartItem } from './core/domain/entities/cart.entity';
import { NavigationComponent } from './shared/ui/organisms/navigation/navigation.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule, NavigationComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('capy-pos');
  
  // All products - using proper Product entities
  private readonly allProducts: Product[] = [
    new Product('1', 'Coffee', 4.50, 'SKU-001', 'Beverages', 50, 'Fresh brewed coffee', undefined, undefined, '☕'),
    new Product('2', 'Sandwich', 8.99, 'SKU-002', 'Food', 30, 'Delicious sandwich', undefined, undefined, '🥪'),
    new Product('3', 'Salad', 7.50, 'SKU-003', 'Food', 25, 'Fresh salad', undefined, undefined, '🥗'),
    new Product('4', 'Pizza', 12.99, 'SKU-004', 'Food', 20, 'Hot pizza', undefined, undefined, '🍕'),
    new Product('5', 'Burger', 10.50, 'SKU-005', 'Food', 35, 'Juicy burger', undefined, undefined, '🍔'),
    new Product('6', 'Sushi', 15.99, 'SKU-006', 'Food', 15, 'Fresh sushi', undefined, undefined, '🍣'),
    new Product('7', 'Pasta', 11.50, 'SKU-007', 'Food', 28, 'Italian pasta', undefined, undefined, '🍝'),
    new Product('8', 'Taco', 6.99, 'SKU-008', 'Food', 40, 'Tasty taco', undefined, undefined, '🌮'),
    new Product('9', 'Tea', 3.50, 'SKU-009', 'Beverages', 60, 'Hot tea', undefined, undefined, '🍵'),
    new Product('10', 'Juice', 4.99, 'SKU-010', 'Beverages', 45, 'Fresh juice', undefined, undefined, '🧃'),
    new Product('11', 'Donut', 2.99, 'SKU-011', 'Desserts', 50, 'Sweet donut', undefined, undefined, '🍩'),
    new Product('12', 'Ice Cream', 5.50, 'SKU-012', 'Desserts', 30, 'Cold ice cream', undefined, undefined, '🍦'),
  ];

  // Search query
  protected searchQuery = signal('');

  // Cart visibility (for mobile)
  protected cartVisible = signal(false);

  // Filtered products based on search
  protected readonly mockProducts = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) {
      return this.allProducts;
    }
    return this.allProducts.filter(product => 
      product.name.toLowerCase().includes(query) ||
      product.category.toLowerCase().includes(query)
    );
  });

  // Cart items stored directly as signal for proper reactivity
  protected readonly cartItems = signal<CartItem[]>([]);

  // User state
  protected readonly currentUser = signal('Cashier');

  // Computed values using cartItems
  protected readonly subtotal = computed(() =>
    this.cartItems().reduce((sum, item) => sum + item.getSubtotal(), 0)
  );
  
  protected readonly tax = computed(() => this.subtotal() * 0.08);
  
  protected readonly total = computed(() => this.subtotal() + this.tax());

  // Cart operations - direct manipulation of cartItems signal
  protected addToCart(product: Product): void {
    this.cartItems.update(items => {
      const existingIndex = items.findIndex(item => item.product.id === product.id);
      if (existingIndex >= 0) {
        // Update existing item quantity
        const newItems = [...items];
        const existingItem = newItems[existingIndex];
        newItems[existingIndex] = new CartItem(
          existingItem.product,
          existingItem.quantity + 1,
          existingItem.addedAt
        );
        return newItems;
      } else {
        // Add new item
        return [...items, new CartItem(product, 1)];
      }
    });
  }

  protected removeFromCart(productId: string): void {
    this.cartItems.update(items =>
      items.filter(item => item.product.id !== productId)
    );
  }

  protected increaseQuantity(productId: string): void {
    this.cartItems.update(items => {
      const index = items.findIndex(item => item.product.id === productId);
      if (index >= 0) {
        const newItems = [...items];
        const item = newItems[index];
        newItems[index] = new CartItem(
          item.product,
          item.quantity + 1,
          item.addedAt
        );
        return newItems;
      }
      return items;
    });
  }

  protected decreaseQuantity(productId: string): void {
    this.cartItems.update(items => {
      const index = items.findIndex(item => item.product.id === productId);
      if (index >= 0) {
        const newItems = [...items];
        const item = newItems[index];
        if (item.quantity > 1) {
          newItems[index] = new CartItem(
            item.product,
            item.quantity - 1,
            item.addedAt
          );
          return newItems;
        } else {
          // Remove item if quantity would be 0
          return items.filter(i => i.product.id !== productId);
        }
      }
      return items;
    });
  }

  protected clearCart(): void {
    this.cartItems.set([]);
  }

  protected checkout(): void {
    if (this.cartItems().length === 0) return;
    
    const itemsList = this.cartItems()
      .map(item => `${item.quantity}x ${item.product.name} - $${(item.product.price * item.quantity).toFixed(2)}`)
      .join('\n');
    
    alert(
      `✅ Checkout Successful!\n\n` +
      `Items:\n${itemsList}\n\n` +
      `Subtotal: $${this.subtotal().toFixed(2)}\n` +
      `Tax (8%): $${this.tax().toFixed(2)}\n` +
      `Total: $${this.total().toFixed(2)}\n\n` +
      `Thank you for your purchase! 🦫`
    );
    this.clearCart();
  }

  // Search functionality
  protected onSearchChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  // Settings button action
  protected openSettings(): void {
    alert(
      `⚙️ Settings\n\n` +
      `• Tax Rate: 8%\n` +
      `• Currency: USD\n` +
      `• Store: Capy Store #1\n` +
      `• Version: 1.0.0\n\n` +
      `Settings panel coming soon!`
    );
  }

  // User button action
  protected showUserInfo(): void {
    const totalSales = this.cartItems().length > 0
      ? `Current cart: $${this.total().toFixed(2)}`
      : 'No active cart';
    
    alert(
      `👤 User Information\n\n` +
      `Name: ${this.currentUser()}\n` +
      `Role: Cashier\n` +
      `Status: Active\n\n` +
      `${totalSales}\n\n` +
      `User management coming soon!`
    );
  }

  // Toggle cart visibility (for mobile)
  protected toggleCart(): void {
    this.cartVisible.update(visible => !visible);
  }

  // Close cart (for mobile)
  protected closeCart(): void {
    this.cartVisible.set(false);
  }
}

// Made with Bob
