import { SoftDeletableEntity } from '@core/domain/entities/base.entity';

/**
 * Product Interface
 * Defines the shape of a product without class behavior.
 * Use this for typing in services, DTOs, and tests.
 */
export interface IProduct {
  readonly id: string;
  name: string;
  price: number;
  sku: string;
  category: string;
  stock: number;
  description?: string;
  imageUrl?: string;
  barcode?: string;
  emoji?: string;
  lowStockThreshold: number;
  reorderQuantity: number;
  cost: number;
  isActive: boolean;
  readonly createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

/**
 * Product Entity
 * Represents a product in the inventory system
 * Extends SoftDeletableEntity for common functionality
 * Follows SOLID principles - Single Responsibility
 */
export class Product extends SoftDeletableEntity implements IProduct {
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
    public lowStockThreshold = 10,
    public reorderQuantity = 20,
    public cost = 0,
    public isActive = true,
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
  isLowStock(threshold = 10): boolean {
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
  override toJSON(): Record<string, unknown> {
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
      isActive: this.isActive,
    };
  }

  /**
   * Creates product from plain object
   */
  static fromJSON(data: unknown): Product {
    const record = data as Record<string, unknown>;
    return new Product(
      record['id'] as string,
      record['name'] as string,
      record['price'] as number,
      record['sku'] as string,
      record['category'] as string,
      record['stock'] as number,
      record['description'] as string | undefined,
      record['imageUrl'] as string | undefined,
      record['barcode'] as string | undefined,
      record['emoji'] as string | undefined,
      (record['lowStockThreshold'] as number) ?? 10,
      (record['reorderQuantity'] as number) ?? 20,
      (record['cost'] as number) ?? 0,
      (record['isActive'] as boolean) ?? true,
      record['createdAt'] ? new Date(record['createdAt'] as string) : new Date(),
      record['updatedAt'] ? new Date(record['updatedAt'] as string) : new Date(),
      record['createdBy'] as string | undefined,
      record['updatedBy'] as string | undefined,
      record['deletedAt'] ? new Date(record['deletedAt'] as string) : undefined,
      record['deletedBy'] as string | undefined
    );
  }
}

// Made with Bob
