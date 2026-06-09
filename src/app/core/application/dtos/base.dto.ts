/**
 * Base DTO Interfaces
 * Provides common structure for all DTOs following DRY principle
 * Uses interface inheritance for proper abstraction
 */

/**
 * Base interface for all DTOs with audit fields
 */
export interface BaseDto {
  createdAt: string; // ISO 8601 format
  updatedAt: string; // ISO 8601 format
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Base interface for DTOs that support soft delete
 */
export interface SoftDeletableDto extends BaseDto {
  deletedAt?: string; // ISO 8601 format
  deletedBy?: string;
}

/**
 * Base interface for response DTOs with ID
 */
export interface ResponseDto extends SoftDeletableDto {
  id: string;
}

/**
 * Base interface for create DTOs (no ID, no audit fields)
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CreateDto {
  // Marker interface - specific DTOs will extend this
}

/**
 * Base interface for update DTOs (partial updates)
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UpdateDto {
  // Marker interface - specific DTOs will extend this
}

/**
 * Base interface for filter/search DTOs
 */
export interface FilterDto {
  searchTerm?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Generic paginated response wrapper
 */
export interface PaginatedResponseDto<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Generic bulk operation DTO
 */
export interface BulkOperationDto<T> {
  items: T[];
}

// Made with Bob
