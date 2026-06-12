import {
  CreateDto,
  UpdateDto,
  ResponseDto,
  FilterDto,
  BulkOperationDto,
} from '@core/application/dtos/base.dto';

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
  static fromPlain(data: unknown): CreateProductDto {
    const d = data as Record<string, unknown>;
    return new CreateProductDto(
      d['name'] as string,
      d['price'] as number,
      d['sku'] as string,
      d['category'] as string,
      d['stock'] as number,
      d['description'] as string | undefined,
      d['imageUrl'] as string | undefined,
      d['barcode'] as string | undefined,
      d['emoji'] as string | undefined
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
  static fromPlain(data: unknown): UpdateProductDto {
    const d = data as Record<string, unknown>;
    return new UpdateProductDto(
      d['name'] as string | undefined,
      d['price'] as number | undefined,
      d['sku'] as string | undefined,
      d['category'] as string | undefined,
      d['stock'] as number | undefined,
      d['description'] as string | undefined,
      d['imageUrl'] as string | undefined,
      d['barcode'] as string | undefined,
      d['emoji'] as string | undefined
    );
  }

  /**
   * Check if DTO has unknown updates
   */
  hasUpdates(): boolean {
    return Object.values(this).some((value) => value !== undefined);
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
  static fromPlain(data: unknown): ProductResponseDto {
    const d = data as Record<string, unknown>;
    return new ProductResponseDto(
      d['id'] as string,
      d['name'] as string,
      d['price'] as number,
      d['sku'] as string,
      d['category'] as string,
      d['stock'] as number,
      d['createdAt'] as string,
      d['updatedAt'] as string,
      d['description'] as string | undefined,
      d['imageUrl'] as string | undefined,
      d['barcode'] as string | undefined,
      d['emoji'] as string | undefined,
      d['createdBy'] as string | undefined,
      d['updatedBy'] as string | undefined,
      d['deletedAt'] as string | undefined,
      d['deletedBy'] as string | undefined
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
  static fromPlain(data: unknown): ProductFilterDto {
    const d = data as Record<string, unknown>;
    return new ProductFilterDto(
      d['searchTerm'] as string | undefined,
      d['limit'] as number | undefined,
      d['offset'] as number | undefined,
      d['sortBy'] as string | undefined,
      d['sortOrder'] as 'asc' | 'desc' | undefined,
      d['category'] as string | undefined,
      d['minPrice'] as number | undefined,
      d['maxPrice'] as number | undefined,
      d['inStock'] as boolean | undefined,
      d['sku'] as string | undefined
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
  static fromPlain(data: unknown): BulkProductDto {
    const d = data as Record<string, unknown>;
    const items = (d['items'] as unknown[]).map((item: unknown) =>
      CreateProductDto.fromPlain(item)
    );
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
    public items: {
      id: string;
      data: UpdateProductDto;
    }[]
  ) {}

  /**
   * Factory method to create from plain object
   */
  static fromPlain(data: unknown): BulkProductUpdateDto {
    const d = data as Record<string, unknown>;
    const items = (d['items'] as Record<string, unknown>[]).map(
      (item: Record<string, unknown>) => ({
        id: item['id'] as string,
        data: UpdateProductDto.fromPlain(item['data']),
      })
    );
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
