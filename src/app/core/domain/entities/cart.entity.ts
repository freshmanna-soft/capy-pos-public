import { Product } from './product.entity';

/**
 * Cart Item Value Object
 * Represents a product in the shopping cart
 */
export class CartItem {
  constructor(
    public readonly product: Product,
    public quantity: number,
    public readonly addedAt: Date = new Date()
  ) {
    this.validate();
  }

  private validate(): void {
    if (this.quantity <= 0) {
      throw new Error('Quantity must be greater than 0');
    }
    if (this.quantity > this.product.stock) {
      throw new Error('Quantity exceeds available stock');
    }
  }

  /**
   * Calculates subtotal for this item
   */
  getSubtotal(): number {
    return this.product.price * this.quantity;
  }

  /**
   * Updates quantity
   */
  updateQuantity(newQuantity: number): void {
    if (newQuantity <= 0) {
      throw new Error('Quantity must be greater than 0');
    }
    if (newQuantity > this.product.stock) {
      throw new Error('Quantity exceeds available stock');
    }
    this.quantity = newQuantity;
  }
}

/**
 * Cart Entity
 * Represents a shopping cart in the POS system
 * Follows Single Responsibility Principle
 */
export class Cart {
  private items: Map<string, CartItem> = new Map();

  constructor(
    public readonly id: string,
    public readonly customerId?: string,
    public readonly createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {
    if (!this.id || this.id.trim() === '') {
      throw new Error('Cart ID is required');
    }
  }

  /**
   * Adds a product to the cart
   */
  addItem(product: Product, quantity: number): void {
    const existingItem = this.items.get(product.id);
    
    if (existingItem) {
      // Update quantity if item already exists
      const newQuantity = existingItem.quantity + quantity;
      existingItem.updateQuantity(newQuantity);
    } else {
      // Add new item
      const cartItem = new CartItem(product, quantity);
      this.items.set(product.id, cartItem);
    }
    
    this.updatedAt = new Date();
  }

  /**
   * Removes a product from the cart
   */
  removeItem(productId: string): void {
    if (!this.items.has(productId)) {
      throw new Error('Product not found in cart');
    }
    this.items.delete(productId);
    this.updatedAt = new Date();
  }

  /**
   * Updates quantity of a product in the cart
   */
  updateItemQuantity(productId: string, quantity: number): void {
    const item = this.items.get(productId);
    if (!item) {
      throw new Error('Product not found in cart');
    }
    item.updateQuantity(quantity);
    this.updatedAt = new Date();
  }

  /**
   * Gets all items in the cart
   */
  getItems(): CartItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Gets a specific item from the cart
   */
  getItem(productId: string): CartItem | undefined {
    return this.items.get(productId);
  }

  /**
   * Calculates total number of items
   */
  getTotalItems(): number {
    return Array.from(this.items.values())
      .reduce((total, item) => total + item.quantity, 0);
  }

  /**
   * Calculates cart subtotal (before tax and discounts)
   */
  getSubtotal(): number {
    return Array.from(this.items.values())
      .reduce((total, item) => total + item.getSubtotal(), 0);
  }

  /**
   * Calculates tax amount
   */
  getTax(taxRate: number = 0.08): number {
    return this.getSubtotal() * taxRate;
  }

  /**
   * Calculates total (subtotal + tax)
   */
  getTotal(taxRate: number = 0.08): number {
    return this.getSubtotal() + this.getTax(taxRate);
  }

  /**
   * Checks if cart is empty
   */
  isEmpty(): boolean {
    return this.items.size === 0;
  }

  /**
   * Clears all items from the cart
   */
  clear(): void {
    this.items.clear();
    this.updatedAt = new Date();
  }

  /**
   * Checks if a product is in the cart
   */
  hasProduct(productId: string): boolean {
    return this.items.has(productId);
  }

  /**
   * Validates cart before checkout
   */
  validateForCheckout(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.isEmpty()) {
      errors.push('Cart is empty');
    }

    // Check stock availability for all items
    for (const item of this.items.values()) {
      if (item.quantity > item.product.stock) {
        errors.push(`Insufficient stock for ${item.product.name}`);
      }
      if (item.product.isOutOfStock()) {
        errors.push(`${item.product.name} is out of stock`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Converts cart to plain object
   */
  toJSON(): Record<string, any> {
    return {
      id: this.id,
      customerId: this.customerId,
      items: this.getItems().map(item => ({
        product: item.product.toJSON(),
        quantity: item.quantity,
        subtotal: item.getSubtotal(),
        addedAt: item.addedAt.toISOString()
      })),
      totalItems: this.getTotalItems(),
      subtotal: this.getSubtotal(),
      tax: this.getTax(),
      total: this.getTotal(),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString()
    };
  }
}

// Made with Bob
