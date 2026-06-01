import { Product } from '../../domain/entities/product.entity';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductResponseDto
} from '../dtos/product.dto';
import { BaseMapper } from './base.mapper';

/**
 * ProductMapper
 * Extends BaseMapper to handle Product entity ↔ DTO conversions
 * Implements abstract methods with Product-specific logic
 * Inherits common list mapping and utility methods
 */
export class ProductMapper extends BaseMapper<
  Product,
  CreateProductDto,
  UpdateProductDto,
  ProductResponseDto
> {
  /**
   * Maps CreateProductDto to Product entity
   * Used when creating new products from API requests or forms
   */
  toDomain(dto: CreateProductDto, id?: string): Product {
    return new Product(
      id || this.generateId(),
      dto.name,
      dto.price,
      dto.sku,
      dto.category,
      dto.stock,
      dto.description,
      dto.imageUrl,
      dto.barcode,
      dto.emoji
    );
  }

  /**
   * Maps Product entity to ProductResponseDto
   * Used when sending product data to API or UI
   */
  toResponseDto(entity: Product): ProductResponseDto {
    return new ProductResponseDto(
      entity.id,
      entity.name,
      entity.price,
      entity.sku,
      entity.category,
      entity.stock,
      entity.createdAt.toISOString(),
      entity.updatedAt.toISOString(),
      entity.description,
      entity.imageUrl,
      entity.barcode,
      entity.emoji,
      entity.createdBy,
      entity.updatedBy,
      this.dateToIsoString(entity.deletedAt),
      entity.deletedBy
    );
  }

  /**
   * Maps ProductResponseDto back to Product entity
   * Used when receiving product data from API
   */
  fromResponseDto(dto: ProductResponseDto): Product {
    return new Product(
      dto.id,
      dto.name,
      dto.price,
      dto.sku,
      dto.category,
      dto.stock,
      dto.description,
      dto.imageUrl,
      dto.barcode,
      dto.emoji,
      10, // lowStockThreshold - default value
      20, // reorderQuantity - default value
      0,  // cost - default value
      true, // isActive - default value
      new Date(dto.createdAt),
      new Date(dto.updatedAt),
      dto.createdBy,
      dto.updatedBy,
      this.isoStringToDate(dto.deletedAt),
      dto.deletedBy
    );
  }

  /**
   * Applies UpdateProductDto to existing Product entity
   * Returns a new Product instance with updated values
   * Uses immutability pattern - original entity unchanged
   */
  applyUpdate(entity: Product, dto: UpdateProductDto): Product {
    const updated = entity.clone();
    
    if (dto.name !== undefined) updated.name = dto.name;
    if (dto.price !== undefined) updated.price = dto.price;
    if (dto.sku !== undefined) updated.sku = dto.sku;
    if (dto.category !== undefined) updated.category = dto.category;
    if (dto.stock !== undefined) updated.stock = dto.stock;
    if (dto.description !== undefined) updated.description = dto.description;
    if (dto.imageUrl !== undefined) updated.imageUrl = dto.imageUrl;
    if (dto.barcode !== undefined) updated.barcode = dto.barcode;
    if (dto.emoji !== undefined) updated.emoji = dto.emoji;
    
    return updated;
  }

  /**
   * Singleton instance for convenient access
   * Avoids creating multiple mapper instances
   */
  private static instance: ProductMapper;

  static getInstance(): ProductMapper {
    if (!ProductMapper.instance) {
      ProductMapper.instance = new ProductMapper();
    }
    return ProductMapper.instance;
  }
}

// Export singleton instance for convenience
export const productMapper = ProductMapper.getInstance();

// Made with Bob