import { Injectable } from '@angular/core';
import { BaseDexieRepository } from './base-dexie.repository';
import { Product } from '../../domain/entities/product.entity';
import { IProductRepository } from '../../domain/interfaces/product.repository.interface';
import { DexieDatabase, IProductDB } from '../database/dexie-database.service';

/**
 * Dexie Product Repository
 * Implements product-specific operations using Dexie ORM
 */
@Injectable({
  providedIn: 'root'
})
export class DexieProductRepository 
  extends BaseDexieRepository<Product, IProductDB> 
  implements IProductRepository {

  constructor(private db: DexieDatabase) {
    super(db.products);
  }

  /**
   * Map database record to Product entity
   */
  protected mapToEntity(record: IProductDB): Product {
    return new Product(
      record.id,
      record.name,
      record.price,
      record.sku,
      record.category,
      record.quantity, // maps to stock in Product entity
      record.description,
      record.imageUrl,
      record.barcode,
      undefined, // emoji not in DB
      record.createdAt,
      record.updatedAt,
      record.createdBy,
      record.updatedBy,
      record.deletedAt,
      record.deletedBy
    );
  }

  /**
   * Map Product entity to database record
   */
  protected mapToDatabase(entity: Product): IProductDB {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      sku: entity.sku,
      barcode: entity.barcode,
      category: entity.category,
      price: entity.price,
      cost: 0, // default cost, not in Product entity
      quantity: entity.stock, // maps from stock in Product entity
      minStockLevel: 10, // default min stock level
      maxStockLevel: undefined,
      unit: 'unit', // default unit
      taxRate: 0.08, // default tax rate
      isActive: true, // default active status
      imageUrl: entity.imageUrl,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
      deletedAt: entity.deletedAt,
      deletedBy: entity.deletedBy
    };
  }

  /**
   * Find products by category
   */
  async findByCategory(category: string): Promise<Product[]> {
    return this.findByIndexedField('category', category);
  }

  /**
   * Find active products
   */
  async findActive(): Promise<Product[]> {
    return this.findByIndexedField('isActive', true);
  }

  /**
   * Find products by category and active status
   */
  async findByCategoryAndStatus(category: string, isActive: boolean): Promise<Product[]> {
    return this.findByCompoundIndex(['category', 'isActive'], [category, isActive]);
  }

  /**
   * Search products by name, SKU, or barcode
   */
  async search(query: string, limit: number = 50): Promise<Product[]> {
    const lowerQuery = query.toLowerCase();
    
    const records = await this.table
      .filter(record => {
        if (record.deletedAt) return false;
        
        const name = record.name.toLowerCase();
        const sku = record.sku.toLowerCase();
        const barcode = (record.barcode || '').toLowerCase();
        
        return name.includes(lowerQuery) || 
               sku.includes(lowerQuery) || 
               barcode.includes(lowerQuery);
      })
      .limit(limit)
      .toArray();
    
    return records.map(record => this.mapToEntity(record));
  }

  /**
   * Find products with low stock (threshold: 10)
   */
  async findLowStock(): Promise<Product[]> {
    const records = await this.table
      .filter(record => {
        if (record.deletedAt) return false;
        return record.quantity <= 10; // default threshold
      })
      .toArray();
    
    return records.map(record => this.mapToEntity(record));
  }

  /**
   * Find product by SKU
   */
  async findBySKU(sku: string): Promise<Product | null> {
    return this.findOneByIndexedField('sku', sku);
  }

  /**
   * Find product by barcode
   */
  async findByBarcode(barcode: string): Promise<Product | null> {
    return this.findOneByIndexedField('barcode', barcode);
  }

  /**
   * Update product stock (sets absolute value)
   */
  async updateStock(productId: string, quantity: number): Promise<Product> {
    const product = await this.findById(productId);
    if (!product) {
      throw new Error(`Product with id ${productId} not found`);
    }

    // Calculate the adjustment needed
    const adjustment = quantity - product.stock;
    product.updateStock(adjustment);
    
    await this.table.update(productId, {
      quantity: product.stock,
      updatedAt: product.updatedAt
    });

    return product;
  }

  /**
   * Adjust product stock (add or subtract)
   */
  async adjustStock(productId: string, adjustment: number): Promise<Product> {
    const product = await this.findById(productId);
    if (!product) {
      throw new Error(`Product with id ${productId} not found`);
    }

    product.updateStock(adjustment);
    
    await this.table.update(productId, {
      quantity: product.stock,
      updatedAt: product.updatedAt
    });

    return product;
  }

  /**
   * Update product price
   */
  async updatePrice(productId: string, price: number, cost?: number): Promise<Product> {
    const product = await this.findById(productId);
    if (!product) {
      throw new Error(`Product with id ${productId} not found`);
    }

    product.updatePrice(price);
    
    const updateData: Partial<IProductDB> = {
      price: product.price,
      updatedAt: product.updatedAt
    };
    
    if (cost !== undefined) {
      updateData.cost = cost;
    }
    
    await this.table.update(productId, updateData);

    return product;
  }

  /**
   * Get products count by category
   */
  async countByCategory(category: string): Promise<number> {
    return this.countByField('category', category);
  }

  /**
   * Get all categories
   */
  async getCategories(): Promise<string[]> {
    const records = await this.table
      .filter(record => !record.deletedAt)
      .toArray();
    
    const categories = new Set(records.map(r => r.category));
    return Array.from(categories).sort();
  }

  /**
   * Get products sorted by name
   */
  async findSortedByName(direction: 'asc' | 'desc' = 'asc'): Promise<Product[]> {
    return this.findSorted('name', direction);
  }

  /**
   * Get products sorted by price
   */
  async findSortedByPrice(direction: 'asc' | 'desc' = 'asc'): Promise<Product[]> {
    return this.findSorted('price', direction);
  }

  /**
   * Get top selling products (placeholder - requires transaction data)
   */
  async getTopSelling(limit: number = 10): Promise<Product[]> {
    // This would require joining with transaction_items table
    // For now, return products sorted by name
    return this.findSorted('name', 'asc', limit);
  }
}

// Made with Bob