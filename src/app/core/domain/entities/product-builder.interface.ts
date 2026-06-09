import { IBuilder } from './builder.interface';
import { Product } from './product.entity';

/**
 * IProductBuilder Interface
 * Defines the contract for building Product entities.
 * Extends IBuilder<Product> with product-specific fluent methods.
 *
 * This allows consumers to depend on the interface rather than
 * the concrete ProductBuilder, enabling substitution and testing.
 */
export interface IProductBuilder extends IBuilder<Product> {
  // Identity & audit (inherited concept from AbstractEntityBuilder)
  withId(id: string): IProductBuilder;
  withCreatedAt(createdAt: Date): IProductBuilder;
  withUpdatedAt(updatedAt: Date): IProductBuilder;
  withCreatedBy(createdBy: string): IProductBuilder;
  withUpdatedBy(updatedBy: string): IProductBuilder;
  withDeletedAt(deletedAt: Date): IProductBuilder;
  withDeletedBy(deletedBy: string): IProductBuilder;

  // Product-specific fields
  withName(name: string): IProductBuilder;
  withPrice(price: number): IProductBuilder;
  withSku(sku: string): IProductBuilder;
  withCategory(category: string): IProductBuilder;
  withStock(stock: number): IProductBuilder;
  withDescription(description: string): IProductBuilder;
  withImageUrl(imageUrl: string): IProductBuilder;
  withBarcode(barcode: string): IProductBuilder;
  withEmoji(emoji: string): IProductBuilder;
  withLowStockThreshold(threshold: number): IProductBuilder;
  withReorderQuantity(quantity: number): IProductBuilder;
  withCost(cost: number): IProductBuilder;
  withIsActive(isActive: boolean): IProductBuilder;
}
