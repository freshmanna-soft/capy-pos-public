import { SoftDeletableEntity } from './base.entity';

/**
 * Product Entity
 * Represents a product in the inventory system
 * Extends SoftDeletableEntity for common functionality
 * Follows SOLID principles - Single Responsibility
 */
export class Product extends SoftDeletableEntity {
  constructor(
    id: string,
    public name: string,
    public price: number,
    public sku: string,
    public category: string,
    public stock: number,
    public description?: string,
    public imageUrl?: string,
    public barcode?: string,
    public emoji?: string,
    public lowStockThreshold: number = 10,
    public reorderQuantity: number = 20,
    public cost: number = 0,
    public isActive: boolean = true,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    createdBy?: string,
    updatedBy?: string,
    deletedAt?: Date,
    deletedBy?: string
  ) {
    super(id, createdAt, updatedAt, createdBy, updatedBy, deletedAt, deletedBy);
    this.validate();
  }

  /**
   * Validates product data
   * @throws Error if validation fails
   */
  protected validate(): void {
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
  updateStock(quantity: number, updatedBy?: string): void {
    const newStock = this.stock + quantity;
    if (newStock < 0) {
      throw new Error('Insufficient stock');
    }
    this.stock = newStock;
    this.touch(updatedBy);
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
  updatePrice(newPrice: number, updatedBy?: string): void {
    if (newPrice < 0) {
      throw new Error('Price cannot be negative');
    }
    this.price = newPrice;
    this.touch(updatedBy);
  }

  /**
   * Creates a copy of the product
   */
  override clone(): Product {
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
      this.emoji,
      this.lowStockThreshold,
      this.reorderQuantity,
      this.cost,
      this.isActive,
      this.createdAt,
      this.updatedAt,
      this.createdBy,
      this.updatedBy,
      this.deletedAt,
      this.deletedBy
    );
  }

  /**
   * Converts product to plain object
   */
  override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      name: this.name,
      price: this.price,
      sku: this.sku,
      category: this.category,
      stock: this.stock,
      description: this.description,
      imageUrl: this.imageUrl,
      barcode: this.barcode,
      emoji: this.emoji,
      lowStockThreshold: this.lowStockThreshold,
      reorderQuantity: this.reorderQuantity,
      cost: this.cost,
      isActive: this.isActive
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
      data.emoji,
      data.lowStockThreshold ?? 10,
      data.reorderQuantity ?? 20,
      data.cost ?? 0,
      data.isActive ?? true,
      data.createdAt ? new Date(data.createdAt) : new Date(),
      data.updatedAt ? new Date(data.updatedAt) : new Date(),
      data.createdBy,
      data.updatedBy,
      data.deletedAt ? new Date(data.deletedAt) : undefined,
      data.deletedBy
    );
  }
}

// Made with Bob
