/**
 * Product Entity
 * Represents a product in the inventory system
 * Follows SOLID principles - Single Responsibility
 */
export class Product {
  constructor(
    public readonly id: string,
    public name: string,
    public price: number,
    public sku: string,
    public category: string,
    public stock: number,
    public description?: string,
    public imageUrl?: string,
    public barcode?: string,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date()
  ) {
    this.validate();
  }

  /**
   * Validates product data
   * @throws Error if validation fails
   */
  private validate(): void {
    if (!this.id || this.id.trim() === '') {
      throw new Error('Product ID is required');
    }
    if (!this.name || this.name.trim() === '') {
      throw new Error('Product name is required');
    }
    if (this.price < 0) {
      throw new Error('Price cannot be negative');
    }
    if (!this.sku || this.sku.trim() === '') {
      throw new Error('SKU is required');
    }
    if (this.stock < 0) {
      throw new Error('Stock cannot be negative');
    }
  }

  /**
   * Updates product stock
   * @param quantity - Amount to add (positive) or remove (negative)
   * @throws Error if resulting stock would be negative
   */
  updateStock(quantity: number): void {
    const newStock = this.stock + quantity;
    if (newStock < 0) {
      throw new Error('Insufficient stock');
    }
    this.stock = newStock;
    this.updatedAt = new Date();
  }

  /**
   * Checks if product is low on stock
   * @param threshold - Minimum stock level (default: 10)
   */
  isLowStock(threshold: number = 10): boolean {
    return this.stock <= threshold;
  }

  /**
   * Checks if product is out of stock
   */
  isOutOfStock(): boolean {
    return this.stock === 0;
  }

  /**
   * Updates product price
   * @param newPrice - New price value
   * @throws Error if price is negative
   */
  updatePrice(newPrice: number): void {
    if (newPrice < 0) {
      throw new Error('Price cannot be negative');
    }
    this.price = newPrice;
    this.updatedAt = new Date();
  }

  /**
   * Creates a copy of the product
   */
  clone(): Product {
    return new Product(
      this.id,
      this.name,
      this.price,
      this.sku,
      this.category,
      this.stock,
      this.description,
      this.imageUrl,
      this.barcode,
      this.createdAt,
      this.updatedAt
    );
  }

  /**
   * Converts product to plain object
   */
  toJSON(): Record<string, any> {
    return {
      id: this.id,
      name: this.name,
      price: this.price,
      sku: this.sku,
      category: this.category,
      stock: this.stock,
      description: this.description,
      imageUrl: this.imageUrl,
      barcode: this.barcode,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString()
    };
  }

  /**
   * Creates product from plain object
   */
  static fromJSON(data: any): Product {
    return new Product(
      data.id,
      data.name,
      data.price,
      data.sku,
      data.category,
      data.stock,
      data.description,
      data.imageUrl,
      data.barcode,
      new Date(data.createdAt),
      new Date(data.updatedAt)
    );
  }
}

// Made with Bob
