import { Injectable } from '@angular/core';
import { IProductRepository } from '../../domain/interfaces/product.repository.interface';
import { Product } from '../../domain/entities/product.entity';
import { BaseSQLiteRepository } from './base-sqlite.repository';
import { DatabaseService } from '../sqlite/database.service';

/**
 * SQLite Product Repository Implementation
 * 
 * Implements IProductRepository for local SQLite database using sql.js.
 * Extends BaseSQLiteRepository for common CRUD operations.
 * Follows Dependency Inversion Principle (SOLID).
 * 
 * @class SQLiteProductRepository
 * @extends BaseSQLiteRepository<Product>
 * @implements IProductRepository
 */
@Injectable({ providedIn: 'root' })
export class SQLiteProductRepository 
  extends BaseSQLiteRepository<Product> 
  implements IProductRepository 
{
  protected readonly tableName = 'products';

  constructor(db: DatabaseService) {
    super(db);
  }

  /**
   * Find products by category
   */
  async findByCategory(category: string): Promise<Product[]> {
    const sql = `
      SELECT * FROM ${this.tableName} 
      WHERE category = ? AND deleted_at IS NULL 
      ORDER BY name
    `;
    const rows = this.db.query(sql, [category]);
    return rows.map(row => this.mapToEntity(row));
  }

  /**
   * Search products by name, SKU, or barcode
   */
  async search(query: string): Promise<Product[]> {
    const { where, params } = this.buildSearchWhere(
      ['name', 'sku', 'barcode'],
      query
    );
    const sql = `
      SELECT * FROM ${this.tableName} 
      WHERE ${where} AND deleted_at IS NULL 
      ORDER BY name
    `;
    const rows = this.db.query(sql, params);
    return rows.map(row => this.mapToEntity(row));
  }

  /**
   * Find products with low stock
   */
  async findLowStock(threshold: number = 10): Promise<Product[]> {
    const sql = `
      SELECT * FROM ${this.tableName} 
      WHERE stock <= ? AND deleted_at IS NULL 
      ORDER BY stock ASC
    `;
    const rows = this.db.query(sql, [threshold]);
    return rows.map(row => this.mapToEntity(row));
  }

  /**
   * Map database row to Product entity
   */
  protected mapToEntity(row: any): Product {
    return new Product(
      row.id,
      row.name,
      row.price,
      row.sku,
      row.category,
      row.stock,
      row.description || undefined,
      row.image_url || undefined,
      row.barcode || undefined,
      row.emoji || undefined,
      10, // lowStockThreshold - default value
      20, // reorderQuantity - default value
      0,  // cost - default value
      true, // isActive - default value
      new Date(row.created_at),
      new Date(row.updated_at),
      row.created_by || undefined,
      row.updated_by || undefined,
      row.deleted_at ? new Date(row.deleted_at) : undefined,
      row.deleted_by || undefined
    );
  }

  /**
   * Build INSERT query for Product
   */
  protected buildInsertQuery(product: Product): { sql: string; params: any[] } {
    const sql = `
      INSERT INTO ${this.tableName} (
        id, name, price, sku, category, stock, description, 
        image_url, barcode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      product.id,
      product.name,
      product.price,
      product.sku,
      product.category,
      product.stock,
      product.description || null,
      product.imageUrl || null,
      product.barcode || null,
      product.createdAt.toISOString(),
      product.updatedAt.toISOString()
    ];

    return { sql, params };
  }

  /**
   * Build UPDATE query for Product
   */
  protected buildUpdateQuery(id: string, data: Partial<Product>): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.price !== undefined) {
      updates.push('price = ?');
      params.push(data.price);
    }
    if (data.sku !== undefined) {
      updates.push('sku = ?');
      params.push(data.sku);
    }
    if (data.category !== undefined) {
      updates.push('category = ?');
      params.push(data.category);
    }
    if (data.stock !== undefined) {
      updates.push('stock = ?');
      params.push(data.stock);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      params.push(data.description);
    }
    if (data.imageUrl !== undefined) {
      updates.push('image_url = ?');
      params.push(data.imageUrl);
    }
    if (data.barcode !== undefined) {
      updates.push('barcode = ?');
      params.push(data.barcode);
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = ?`;
    return { sql, params };
  }

  /**
   * Find active products (stub - not implemented for SQLite)
   */
  async findActive(): Promise<Product[]> {
    throw new Error('Method not implemented - use DexieProductRepository instead');
  }

  /**
   * Update product stock (stub - not implemented for SQLite)
   */
  async updateStock(productId: string, quantity: number): Promise<Product> {
    throw new Error('Method not implemented - use DexieProductRepository instead');
  }

  /**
   * Adjust product stock (stub - not implemented for SQLite)
   */
  async adjustStock(productId: string, adjustment: number): Promise<Product> {
    throw new Error('Method not implemented - use DexieProductRepository instead');
  }

  /**
   * Update product price (stub - not implemented for SQLite)
   */
  async updatePrice(productId: string, price: number, cost?: number): Promise<Product> {
    throw new Error('Method not implemented - use DexieProductRepository instead');
  }

  /**
   * Get all categories (stub - not implemented for SQLite)
   */
  async getCategories(): Promise<string[]> {
    throw new Error('Method not implemented - use DexieProductRepository instead');
  }
}

// Made with Bob
