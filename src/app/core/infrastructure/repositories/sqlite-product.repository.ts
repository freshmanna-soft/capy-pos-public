import { Injectable } from '@angular/core';
import { IProductRepository } from '../../domain/interfaces/product.repository.interface';
import { Product } from '../../domain/entities/product.entity';
import Database from 'better-sqlite3';

/**
 * SQLite Product Repository Implementation
 * Implements IProductRepository for local SQLite database
 * Follows Dependency Inversion Principle (SOLID)
 */
@Injectable({
  providedIn: 'root'
})
export class SQLiteProductRepository implements IProductRepository {
  private db: Database.Database;

  constructor() {
    // Initialize SQLite database
    this.db = new Database('capy-pos.db');
    this.initializeDatabase();
  }

  /**
   * Initializes database schema
   */
  private initializeDatabase(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        sku TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        imageUrl TEXT,
        barcode TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `;
    
    this.db.exec(createTableSQL);
    
    // Create indexes for better performance
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock)');
  }

  async findAll(): Promise<Product[]> {
    const stmt = this.db.prepare('SELECT * FROM products ORDER BY name');
    const rows = stmt.all();
    return rows.map(row => this.mapToEntity(row));
  }

  async findById(id: string): Promise<Product | null> {
    const stmt = this.db.prepare('SELECT * FROM products WHERE id = ?');
    const row = stmt.get(id);
    return row ? this.mapToEntity(row) : null;
  }

  async findByCategory(category: string): Promise<Product[]> {
    const stmt = this.db.prepare('SELECT * FROM products WHERE category = ? ORDER BY name');
    const rows = stmt.all(category);
    return rows.map(row => this.mapToEntity(row));
  }

  async search(query: string): Promise<Product[]> {
    const searchPattern = `%${query}%`;
    const stmt = this.db.prepare(`
      SELECT * FROM products 
      WHERE name LIKE ? OR sku LIKE ? OR barcode LIKE ?
      ORDER BY name
    `);
    const rows = stmt.all(searchPattern, searchPattern, searchPattern);
    return rows.map(row => this.mapToEntity(row));
  }

  async findLowStock(threshold: number = 10): Promise<Product[]> {
    const stmt = this.db.prepare('SELECT * FROM products WHERE stock <= ? ORDER BY stock ASC');
    const rows = stmt.all(threshold);
    return rows.map(row => this.mapToEntity(row));
  }

  async create(product: Product): Promise<Product> {
    const stmt = this.db.prepare(`
      INSERT INTO products (id, name, price, sku, category, stock, description, imageUrl, barcode, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
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
    );
    
    return product;
  }

  async update(id: string, productData: Partial<Product>): Promise<Product> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Product with ID ${id} not found`);
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (productData.name !== undefined) {
      updates.push('name = ?');
      values.push(productData.name);
    }
    if (productData.price !== undefined) {
      updates.push('price = ?');
      values.push(productData.price);
    }
    if (productData.sku !== undefined) {
      updates.push('sku = ?');
      values.push(productData.sku);
    }
    if (productData.category !== undefined) {
      updates.push('category = ?');
      values.push(productData.category);
    }
    if (productData.stock !== undefined) {
      updates.push('stock = ?');
      values.push(productData.stock);
    }
    if (productData.description !== undefined) {
      updates.push('description = ?');
      values.push(productData.description);
    }
    if (productData.imageUrl !== undefined) {
      updates.push('imageUrl = ?');
      values.push(productData.imageUrl);
    }
    if (productData.barcode !== undefined) {
      updates.push('barcode = ?');
      values.push(productData.barcode);
    }

    updates.push('updatedAt = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE products SET ${updates.join(', ')} WHERE id = ?
    `);
    
    stmt.run(...values);
    
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM products WHERE id = ?');
    stmt.run(id);
  }

  async exists(id: string): Promise<boolean> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM products WHERE id = ?');
    const result = stmt.get(id) as { count: number };
    return result.count > 0;
  }

  async count(): Promise<number> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM products');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  async bulkCreate(products: Product[]): Promise<Product[]> {
    const stmt = this.db.prepare(`
      INSERT INTO products (id, name, price, sku, category, stock, description, imageUrl, barcode, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((products: Product[]) => {
      for (const product of products) {
        stmt.run(
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
        );
      }
    });

    transaction(products);
    return products;
  }

  async bulkUpdate(updates: Array<{ id: string; data: Partial<Product> }>): Promise<Product[]> {
    const transaction = this.db.transaction(async (updates: Array<{ id: string; data: Partial<Product> }>) => {
      for (const update of updates) {
        await this.update(update.id, update.data);
      }
    });

    transaction(updates);
    
    const updatedProducts: Product[] = [];
    for (const update of updates) {
      const product = await this.findById(update.id);
      if (product) {
        updatedProducts.push(product);
      }
    }
    
    return updatedProducts;
  }

  /**
   * Maps database row to Product entity
   */
  private mapToEntity(row: any): Product {
    return new Product(
      row.id,
      row.name,
      row.price,
      row.sku,
      row.category,
      row.stock,
      row.description,
      row.imageUrl,
      row.barcode,
      new Date(row.createdAt),
      new Date(row.updatedAt)
    );
  }

  /**
   * Closes database connection
   */
  close(): void {
    this.db.close();
  }
}

// Made with Bob
