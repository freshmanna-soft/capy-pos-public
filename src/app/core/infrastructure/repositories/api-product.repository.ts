import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { IProductRepository } from '@core/domain/interfaces/product.repository.interface';
import { Product } from '@core/domain/entities/product.entity';

/**
 * API Product Repository Implementation
 * Implements IProductRepository for REST API backend
 * Follows Dependency Inversion Principle (SOLID)
 * Can be swapped with SQLiteProductRepository without changing business logic
 */
@Injectable({
  providedIn: 'root',
})
export class ApiProductRepository implements IProductRepository {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/products'; // Can be configured via environment

  async findAll(): Promise<Product[]> {
    try {
      const response = await firstValueFrom(this.http.get<unknown[]>(this.apiUrl));
      return response.map((data) => this.mapToEntity(data));
    } catch (error) {
      console.error('Error fetching products:', error);
      throw new Error('Failed to fetch products from API', { cause: error });
    }
  }

  async findById(id: string): Promise<Product | null> {
    try {
      const response = await firstValueFrom(this.http.get<unknown>(`${this.apiUrl}/${id}`));
      return this.mapToEntity(response);
    } catch (error: unknown) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      console.error(`Error fetching product ${id}:`, error);
      throw new Error(`Failed to fetch product ${id} from API`, { cause: error });
    }
  }

  async findByCategory(category: string): Promise<Product[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<unknown[]>(`${this.apiUrl}/category/${category}`),
      );
      return response.map((data) => this.mapToEntity(data));
    } catch (error) {
      console.error(`Error fetching products by category ${category}:`, error);
      throw new Error(`Failed to fetch products by category from API`, { cause: error });
    }
  }

  async search(query: string): Promise<Product[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<unknown[]>(`${this.apiUrl}/search`, {
          params: { q: query },
        }),
      );
      return response.map((data) => this.mapToEntity(data));
    } catch (error) {
      console.error(`Error searching products with query "${query}":`, error);
      throw new Error('Failed to search products from API', { cause: error });
    }
  }

  async findLowStock(threshold = 10): Promise<Product[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<unknown[]>(`${this.apiUrl}/low-stock`, {
          params: { threshold: threshold.toString() },
        }),
      );
      return response.map((data) => this.mapToEntity(data));
    } catch (error) {
      console.error('Error fetching low stock products:', error);
      throw new Error('Failed to fetch low stock products from API', { cause: error });
    }
  }

  async findActive(): Promise<Product[]> {
    try {
      const response = await firstValueFrom(this.http.get<unknown[]>(`${this.apiUrl}/active`));
      return response.map((data) => this.mapToEntity(data));
    } catch (error) {
      console.error('Error fetching active products:', error);
      throw new Error('Failed to fetch active products from API', { cause: error });
    }
  }

  async updateStock(productId: string, quantity: number): Promise<Product> {
    try {
      const response = await firstValueFrom(
        this.http.patch<unknown>(`${this.apiUrl}/${productId}/stock`, { quantity }),
      );
      return this.mapToEntity(response);
    } catch (error) {
      console.error(`Error updating stock for product ${productId}:`, error);
      throw new Error(`Failed to update stock for product ${productId} via API`, { cause: error });
    }
  }

  async adjustStock(productId: string, adjustment: number): Promise<Product> {
    try {
      const response = await firstValueFrom(
        this.http.patch<unknown>(`${this.apiUrl}/${productId}/adjust-stock`, { adjustment }),
      );
      return this.mapToEntity(response);
    } catch (error) {
      console.error(`Error adjusting stock for product ${productId}:`, error);
      throw new Error(`Failed to adjust stock for product ${productId} via API`, { cause: error });
    }
  }

  async updatePrice(productId: string, price: number, cost?: number): Promise<Product> {
    try {
      const response = await firstValueFrom(
        this.http.patch<unknown>(`${this.apiUrl}/${productId}/price`, { price, cost }),
      );
      return this.mapToEntity(response);
    } catch (error) {
      console.error(`Error updating price for product ${productId}:`, error);
      throw new Error(`Failed to update price for product ${productId} via API`, { cause: error });
    }
  }

  async getCategories(): Promise<string[]> {
    try {
      const response = await firstValueFrom(this.http.get<string[]>(`${this.apiUrl}/categories`));
      return response;
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw new Error('Failed to fetch categories from API', { cause: error });
    }
  }

  async create(product: Product): Promise<Product> {
    try {
      const response = await firstValueFrom(this.http.post<unknown>(this.apiUrl, product.toJSON()));
      return this.mapToEntity(response);
    } catch (error) {
      console.error('Error creating product:', error);
      throw new Error('Failed to create product via API', { cause: error });
    }
  }

  async update(id: string, productData: Partial<Product>): Promise<Product> {
    try {
      const response = await firstValueFrom(
        this.http.patch<unknown>(`${this.apiUrl}/${id}`, productData),
      );
      return this.mapToEntity(response);
    } catch (error) {
      console.error(`Error updating product ${id}:`, error);
      throw new Error(`Failed to update product ${id} via API`, { cause: error });
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`${this.apiUrl}/${id}`));
    } catch (error) {
      console.error(`Error deleting product ${id}:`, error);
      throw new Error(`Failed to delete product ${id} via API`, { cause: error });
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.head(`${this.apiUrl}/${id}`));
      return true;
    } catch (error: unknown) {
      if ((error as { status?: number }).status === 404) {
        return false;
      }
      console.error(`Error checking if product ${id} exists:`, error);
      throw new Error(`Failed to check product existence via API`, { cause: error });
    }
  }

  async count(): Promise<number> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ count: number }>(`${this.apiUrl}/count`),
      );
      return response.count;
    } catch (error) {
      console.error('Error counting products:', error);
      throw new Error('Failed to count products via API', { cause: error });
    }
  }

  async bulkCreate(products: Product[]): Promise<Product[]> {
    try {
      const response = await firstValueFrom(
        this.http.post<unknown[]>(
          `${this.apiUrl}/bulk`,
          products.map((p) => p.toJSON()),
        ),
      );
      return response.map((data) => this.mapToEntity(data));
    } catch (error) {
      console.error('Error bulk creating products:', error);
      throw new Error('Failed to bulk create products via API', { cause: error });
    }
  }

  async bulkUpdate(updates: { id: string; data: Partial<Product> }[]): Promise<Product[]> {
    try {
      const response = await firstValueFrom(
        this.http.patch<unknown[]>(`${this.apiUrl}/bulk`, updates),
      );
      return response.map((data) => this.mapToEntity(data));
    } catch (error) {
      console.error('Error bulk updating products:', error);
      throw new Error('Failed to bulk update products via API', { cause: error });
    }
  }

  /**
   * Maps API response to Product entity
   */
  private mapToEntity(data: unknown): Product {
    return Product.fromJSON(data);
  }
}
