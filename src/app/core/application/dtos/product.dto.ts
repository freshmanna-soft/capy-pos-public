import {
  CreateDto,
  UpdateDto,
  ResponseDto,
  FilterDto,
  BulkOperationDto
} from './base.dto';

/**
 * Product Data Transfer Objects
 * Uses class implementation with proper inheritance and implements keyword
 */

/**
 * Base product data interface
 * Contains common fields shared across all product DTOs
 */
interface ProductData {
  name: string;
  price: number;
  sku: string;
  category: string;
  stock: number;
  description?: string;
  imageUrl?: string;
  barcode?: string;
  emoji?: string;
}

/**
 * DTO class for creating a new product
 * Implements CreateDto marker interface
 */
export class CreateProductDto implements CreateDto, ProductData {
  constructor(
    public name: string,
    public price: number,
    public sku: string,
    public category: string,
    public stock: number,
    public description?: string,
    public imageUrl?: string,
    public barcode?: string,
    public emoji?: string
  ) {}

  /**
   * Factory method to create from plain object
   */
  static fromPlain(data: any): CreateProductDto {
    return new CreateProductDto(
      data.name,
      data.price,
      data.sku,
      data.category,
      data.stock,
      data.description,
      data.imageUrl,
      data.barcode,
      data.emoji
    );
  }
}

/**
 * DTO class for updating an existing product
 * Implements UpdateDto marker interface
 * All fields are optional to support partial updates
 */
export class UpdateProductDto implements UpdateDto {
  constructor(
    public name?: string,
    public price?: number,
    public sku?: string,
    public category?: string,
    public stock?: number,
    public description?: string,
    public imageUrl?: string,
    public barcode?: string,
    public emoji?: string
  ) {}

  /**
   * Factory method to create from plain object
   */
  static fromPlain(data: any): UpdateProductDto {
    return new UpdateProductDto(
      data.name,
      data.price,
      data.sku,
      data.category,
      data.stock,
      data.description,
      data.imageUrl,
      data.barcode,
      data.emoji
    );
  }

  /**
   * Check if DTO has any updates
   */
  hasUpdates(): boolean {
    return Object.values(this).some(value => value !== undefined);
  }
}

/**
 * DTO class for product responses
 * Implements ResponseDto (includes id and audit fields)
 * Used in API responses and UI display
 */
export class ProductResponseDto implements ResponseDto, ProductData {
  constructor(
    public id: string,
    public name: string,
    public price: number,
    public sku: string,
    public category: string,
    public stock: number,
    public createdAt: string,
    public updatedAt: string,
    public description?: string,
    public imageUrl?: string,
    public barcode?: string,
    public emoji?: string,
    public createdBy?: string,
    public updatedBy?: string,
    public deletedAt?: string,
    public deletedBy?: string
  ) {}

  /**
   * Factory method to create from plain object
   */
  static fromPlain(data: any): ProductResponseDto {
    return new ProductResponseDto(
      data.id,
      data.name,
      data.price,
      data.sku,
      data.category,
      data.stock,
      data.createdAt,
      data.updatedAt,
      data.description,
      data.imageUrl,
      data.barcode,
      data.emoji,
      data.createdBy,
      data.updatedBy,
      data.deletedAt,
      data.deletedBy
    );
  }

  /**
   * Check if product is deleted
   */
  isDeleted(): boolean {
    return this.deletedAt !== undefined;
  }

  /**
   * Check if product is in stock
   */
  isInStock(): boolean {
    return this.stock > 0;
  }
}

/**
 * DTO class for product search/filter criteria
 * Implements FilterDto (includes common search fields)
 */
export class ProductFilterDto implements FilterDto {
  constructor(
    public searchTerm?: string,
    public limit?: number,
    public offset?: number,
    public sortBy?: string,
    public sortOrder?: 'asc' | 'desc',
    public category?: string,
    public minPrice?: number,
    public maxPrice?: number,
    public inStock?: boolean,
    public sku?: string
  ) {}

  /**
   * Factory method to create from plain object
   */
  static fromPlain(data: any): ProductFilterDto {
    return new ProductFilterDto(
      data.searchTerm,
      data.limit,
      data.offset,
      data.sortBy,
      data.sortOrder,
      data.category,
      data.minPrice,
      data.maxPrice,
      data.inStock,
      data.sku
    );
  }

  /**
   * Check if any filters are applied
   */
  hasFilters(): boolean {
    return !!(
      this.searchTerm ||
      this.category ||
      this.minPrice !== undefined ||
      this.maxPrice !== undefined ||
      this.inStock !== undefined ||
      this.sku
    );
  }
}

/**
 * DTO class for bulk product operations
 * Implements BulkOperationDto
 */
export class BulkProductDto implements BulkOperationDto<CreateProductDto> {
  constructor(public items: CreateProductDto[]) {}

  /**
   * Factory method to create from plain object
   */
  static fromPlain(data: any): BulkProductDto {
    const items = data.items.map((item: any) => CreateProductDto.fromPlain(item));
    return new BulkProductDto(items);
  }

  /**
   * Get count of items
   */
  get count(): number {
    return this.items.length;
  }
}

/**
 * DTO class for bulk product updates
 */
export class BulkProductUpdateDto implements BulkOperationDto<{
  id: string;
  data: UpdateProductDto;
}> {
  constructor(
    public items: Array<{
      id: string;
      data: UpdateProductDto;
    }>
  ) {}

  /**
   * Factory method to create from plain object
   */
  static fromPlain(data: any): BulkProductUpdateDto {
    const items = data.items.map((item: any) => ({
      id: item.id,
      data: UpdateProductDto.fromPlain(item.data)
    }));
    return new BulkProductUpdateDto(items);
  }

  /**
   * Get count of items
   */
  get count(): number {
    return this.items.length;
  }
}

// Made with Bob