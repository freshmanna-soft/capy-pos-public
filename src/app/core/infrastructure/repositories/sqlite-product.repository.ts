import { Injectable, inject } from '@angular/core';
import { IProductRepository } from '@core/domain/interfaces/product.repository.interface';
import { Product } from '@core/domain/entities/product.entity';
import { ProductBuilder } from '@core/domain/entities/product.builder';
import { BaseSQLiteRepository } from '@core/infrastructure/repositories/base-sqlite.repository';
import { DatabaseService } from '@core/infrastructure/sqlite/database.service';

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
const NOT_IMPLEMENTED_MSG = 'Method not implemented - use DexieProductRepository instead';

@Injectable({ providedIn: 'root' })
export class SQLiteProductRepository
  extends BaseSQLiteRepository<Product>
  implements IProductRepository
{
  protected readonly tableName = 'products';

  constructor() {
    const db = inject(DatabaseService);

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
    return rows.map((row) => this.mapToEntity(row));
  }

  /**
   * Search products by name, SKU, or barcode
   */
  async search(query: string): Promise<Product[]> {
    const { where, params } = this.buildSearchWhere(['name', 'sku', 'barcode'], query);
    const sql = `
      SELECT * FROM ${this.tableName} 
      WHERE ${where} AND deleted_at IS NULL 
      ORDER BY name
    `;
    const rows = this.db.query(sql, params as import('sql.js').BindParams);
    return rows.map((row) => this.mapToEntity(row));
  }

  /**
   * Find products with low stock
   */
  async findLowStock(threshold = 10): Promise<Product[]> {
    const sql = `
      SELECT * FROM ${this.tableName} 
      WHERE stock <= ? AND deleted_at IS NULL 
      ORDER BY stock ASC
    `;
    const rows = this.db.query(sql, [threshold]);
    return rows.map((row) => this.mapToEntity(row));
  }

  /**
   * Map database row to Product entity
   */
  protected mapToEntity(row: unknown): Product {
    const data = row as Record<string, unknown>;
    const builder = new ProductBuilder()
      .withId(data['id'] as string)
      .withName(data['name'] as string)
      .withPrice(data['price'] as number)
      .withSku(data['sku'] as string)
      .withCategory(data['category'] as string)
      .withStock(data['stock'] as number)
      .withCreatedAt(new Date(data['created_at'] as string))
      .withUpdatedAt(new Date(data['updated_at'] as string));

    if (data['description']) builder.withDescription(data['description'] as string);
    if (data['image_url']) builder.withImageUrl(data['image_url'] as string);
    if (data['barcode']) builder.withBarcode(data['barcode'] as string);
    if (data['emoji']) builder.withEmoji(data['emoji'] as string);
    if (data['created_by']) builder.withCreatedBy(data['created_by'] as string);
    if (data['updated_by']) builder.withUpdatedBy(data['updated_by'] as string);
    if (data['deleted_at']) builder.withDeletedAt(new Date(data['deleted_at'] as string));
    if (data['deleted_by']) builder.withDeletedBy(data['deleted_by'] as string);

    return builder.build();
  }

  /**
   * Build INSERT query for Product
   */
  protected buildInsertQuery(product: Product): { sql: string; params: unknown[] } {
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
      product.updatedAt.toISOString(),
    ];

    return { sql, params };
  }

  /**
   * Build UPDATE query for Product
   */
  protected buildUpdateQuery(
    id: string,
    data: Partial<Product>,
  ): { sql: string; params: unknown[] } {
    const updates: string[] = [];
    const params: unknown[] = [];

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
    params.push(new Date().toISOString(), id);

    const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = ?`;
    return { sql, params };
  }

  /**
   * Find active products (stub - not implemented for SQLite)
   */
  async findActive(): Promise<Product[]> {
    throw new Error(NOT_IMPLEMENTED_MSG);
  }

  /**
   * Update product stock (stub - not implemented for SQLite)
   */
  async updateStock(_productId: string, _quantity: number): Promise<Product> {
    throw new Error(NOT_IMPLEMENTED_MSG);
  }

  /**
   * Adjust product stock (stub - not implemented for SQLite)
   */
  async adjustStock(_productId: string, _adjustment: number): Promise<Product> {
    throw new Error(NOT_IMPLEMENTED_MSG);
  }

  /**
   * Update product price (stub - not implemented for SQLite)
   */
  async updatePrice(_productId: string, _price: number, _cost?: number): Promise<Product> {
    throw new Error(NOT_IMPLEMENTED_MSG);
  }

  /**
   * Get all categories (stub - not implemented for SQLite)
   */
  async getCategories(): Promise<string[]> {
    throw new Error(NOT_IMPLEMENTED_MSG);
  }
}

// Made with Bob
