import { Component, signal, computed } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Product } from '@core/domain/entities/product.entity';
import { ProductBuilder } from '@core/domain/entities/product.builder';
import { CartItem } from '@core/domain/entities/cart.entity';
import { NavigationComponent } from '@shared/ui/organisms/navigation/navigation.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavigationComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('capy-pos');

  // All products - using proper Product entities via ProductBuilder
  private readonly allProducts: Product[] = [
    new ProductBuilder()
      .withId('1')
      .withName('Coffee')
      .withPrice(4.5)
      .withSku('SKU-001')
      .withCategory('Beverages')
      .withStock(50)
      .withDescription('Fresh brewed coffee')
      .withEmoji('☕')
      .build(),
    new ProductBuilder()
      .withId('2')
      .withName('Sandwich')
      .withPrice(8.99)
      .withSku('SKU-002')
      .withCategory('Food')
      .withStock(30)
      .withDescription('Delicious sandwich')
      .withEmoji('🥪')
      .build(),
    new ProductBuilder()
      .withId('3')
      .withName('Salad')
      .withPrice(7.5)
      .withSku('SKU-003')
      .withCategory('Food')
      .withStock(25)
      .withDescription('Fresh salad')
      .withEmoji('🥗')
      .build(),
    new ProductBuilder()
      .withId('4')
      .withName('Pizza')
      .withPrice(12.99)
      .withSku('SKU-004')
      .withCategory('Food')
      .withStock(20)
      .withDescription('Hot pizza')
      .withEmoji('🍕')
      .build(),
    new ProductBuilder()
      .withId('5')
      .withName('Burger')
      .withPrice(10.5)
      .withSku('SKU-005')
      .withCategory('Food')
      .withStock(35)
      .withDescription('Juicy burger')
      .withEmoji('🍔')
      .build(),
    new ProductBuilder()
      .withId('6')
      .withName('Sushi')
      .withPrice(15.99)
      .withSku('SKU-006')
      .withCategory('Food')
      .withStock(15)
      .withDescription('Fresh sushi')
      .withEmoji('🍣')
      .build(),
    new ProductBuilder()
      .withId('7')
      .withName('Pasta')
      .withPrice(11.5)
      .withSku('SKU-007')
      .withCategory('Food')
      .withStock(28)
      .withDescription('Italian pasta')
      .withEmoji('🍝')
      .build(),
    new ProductBuilder()
      .withId('8')
      .withName('Taco')
      .withPrice(6.99)
      .withSku('SKU-008')
      .withCategory('Food')
      .withStock(40)
      .withDescription('Tasty taco')
      .withEmoji('🌮')
      .build(),
    new ProductBuilder()
      .withId('9')
      .withName('Tea')
      .withPrice(3.5)
      .withSku('SKU-009')
      .withCategory('Beverages')
      .withStock(60)
      .withDescription('Hot tea')
      .withEmoji('🍵')
      .build(),
    new ProductBuilder()
      .withId('10')
      .withName('Juice')
      .withPrice(4.99)
      .withSku('SKU-010')
      .withCategory('Beverages')
      .withStock(45)
      .withDescription('Fresh juice')
      .withEmoji('🧃')
      .build(),
    new ProductBuilder()
      .withId('11')
      .withName('Donut')
      .withPrice(2.99)
      .withSku('SKU-011')
      .withCategory('Desserts')
      .withStock(50)
      .withDescription('Sweet donut')
      .withEmoji('🍩')
      .build(),
    new ProductBuilder()
      .withId('12')
      .withName('Ice Cream')
      .withPrice(5.5)
      .withSku('SKU-012')
      .withCategory('Desserts')
      .withStock(30)
      .withDescription('Cold ice cream')
      .withEmoji('🍦')
      .build(),
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
    return this.allProducts.filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query),
    );
  });

  // Cart items stored directly as signal for proper reactivity
  protected readonly cartItems = signal<CartItem[]>([]);

  // User state
  protected readonly currentUser = signal('Cashier');

  // Computed values using cartItems
  protected readonly subtotal = computed(() =>
    this.cartItems().reduce((sum, item) => sum + item.getSubtotal(), 0),
  );

  protected readonly tax = computed(() => this.subtotal() * 0.08);

  protected readonly total = computed(() => this.subtotal() + this.tax());

  // Cart operations - direct manipulation of cartItems signal
  protected addToCart(product: Product): void {
    this.cartItems.update((items) => {
      const existingIndex = items.findIndex((item) => item.product.id === product.id);
      if (existingIndex >= 0) {
        // Update existing item quantity
        const newItems = [...items];
        const existingItem = newItems[existingIndex];
        newItems[existingIndex] = new CartItem(
          existingItem.product,
          existingItem.quantity + 1,
          existingItem.addedAt,
        );
        return newItems;
      } else {
        // Add new item
        return [...items, new CartItem(product, 1)];
      }
    });
  }

  protected removeFromCart(productId: string): void {
    this.cartItems.update((items) => items.filter((item) => item.product.id !== productId));
  }

  protected increaseQuantity(productId: string): void {
    this.cartItems.update((items) => {
      const index = items.findIndex((item) => item.product.id === productId);
      if (index >= 0) {
        const newItems = [...items];
        const item = newItems[index];
        newItems[index] = new CartItem(item.product, item.quantity + 1, item.addedAt);
        return newItems;
      }
      return items;
    });
  }

  protected decreaseQuantity(productId: string): void {
    this.cartItems.update((items) => {
      const index = items.findIndex((item) => item.product.id === productId);
      if (index >= 0) {
        const newItems = [...items];
        const item = newItems[index];
        if (item.quantity > 1) {
          newItems[index] = new CartItem(item.product, item.quantity - 1, item.addedAt);
          return newItems;
        } else {
          // Remove item if quantity would be 0
          return items.filter((i) => i.product.id !== productId);
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
      .map(
        (item) =>
          `${item.quantity}x ${item.product.name} - $${(item.product.price * item.quantity).toFixed(2)}`,
      )
      .join('\n');

    const message =
      `✅ Checkout Successful!\n\n` +
      `Items:\n${itemsList}\n\n` +
      `Subtotal: $${this.subtotal().toFixed(2)}\n` +
      `Tax (8%): $${this.tax().toFixed(2)}\n` +
      `Total: $${this.total().toFixed(2)}\n\n` +
      `Thank you for your purchase! 🦫`;
    alert(message);
    this.clearCart();
  }

  // Search functionality
  protected onSearchChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  // Settings button action
  protected openSettings(): void {
    const settingsMessage =
      `⚙️ Settings\n\n` +
      `• Tax Rate: 8%\n` +
      `• Currency: USD\n` +
      `• Store: Capy Store #1\n` +
      `• Version: 1.0.0\n\n` +
      `Settings panel coming soon!`;
    alert(settingsMessage);
  }

  // User button action
  protected showUserInfo(): void {
    const totalSales =
      this.cartItems().length > 0 ? `Current cart: $${this.total().toFixed(2)}` : 'No active cart';

    const userMessage =
      `👤 User Information\n\n` +
      `Name: ${this.currentUser()}\n` +
      `Role: Cashier\n` +
      `Status: Active\n\n` +
      `${totalSales}\n\n` +
      `User management coming soon!`;
    alert(userMessage);
  }

  // Toggle cart visibility (for mobile)
  protected toggleCart(): void {
    this.cartVisible.update((visible) => !visible);
  }

  // Close cart (for mobile)
  protected closeCart(): void {
    this.cartVisible.set(false);
  }
}

// Made with Bob
