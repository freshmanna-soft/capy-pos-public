import { AbstractEntityBuilder } from './abstract-entity.builder';
import { IProductBuilder } from './product-builder.interface';
import { Product } from './product.entity';

/**
 * ProductBuilder
 * Concrete builder for creating Product entities.
 * Implements IProductBuilder interface and extends AbstractEntityBuilder
 * for common entity fields (id, timestamps, audit).
 * Adds product-specific fields via a fluent API.
 *
 * @example
 * ```typescript
 * const product = new ProductBuilder()
 *   .withName('Organic Coffee')
 *   .withPrice(12.99)
 *   .withSku('COF-001')
 *   .withCategory('Beverages')
 *   .withStock(50)
 *   .build();
 * ```
 */
export class ProductBuilder
  extends AbstractEntityBuilder<Product, ProductBuilder>
  implements IProductBuilder
{
  private _name = '';
  private _price = 0;
  private _sku = '';
  private _category = '';
  private _stock = 0;
  private _description?: string;
  private _imageUrl?: string;
  private _barcode?: string;
  private _emoji?: string;
  private _lowStockThreshold = 10;
  private _reorderQuantity = 20;
  private _cost = 0;
  private _isActive = true;

  withName(name: string): this {
    this._name = name;
    return this;
  }

  withPrice(price: number): this {
    this._price = price;
    return this;
  }

  withSku(sku: string): this {
    this._sku = sku;
    return this;
  }

  withCategory(category: string): this {
    this._category = category;
    return this;
  }

  withStock(stock: number): this {
    this._stock = stock;
    return this;
  }

  withDescription(description: string): this {
    this._description = description;
    return this;
  }

  withImageUrl(imageUrl: string): this {
    this._imageUrl = imageUrl;
    return this;
  }

  withBarcode(barcode: string): this {
    this._barcode = barcode;
    return this;
  }

  withEmoji(emoji: string): this {
    this._emoji = emoji;
    return this;
  }

  withLowStockThreshold(threshold: number): this {
    this._lowStockThreshold = threshold;
    return this;
  }

  withReorderQuantity(quantity: number): this {
    this._reorderQuantity = quantity;
    return this;
  }

  withCost(cost: number): this {
    this._cost = cost;
    return this;
  }

  withIsActive(isActive: boolean): this {
    this._isActive = isActive;
    return this;
  }

  /**
   * Builds and returns a new Product entity.
   * Validation is performed by the Product constructor.
   * @throws Error if required fields (name, sku) are missing or invalid
   */
  build(): Product {
    return new Product(
      this._id,
      this._name,
      this._price,
      this._sku,
      this._category,
      this._stock,
      this._description,
      this._imageUrl,
      this._barcode,
      this._emoji,
      this._lowStockThreshold,
      this._reorderQuantity,
      this._cost,
      this._isActive,
      this._createdAt,
      this._updatedAt,
      this._createdBy,
      this._updatedBy,
      this._deletedAt,
      this._deletedBy
    );
  }
}
