import { ResponseDto, CreateDto, UpdateDto } from '@core/application/dtos/base.dto';

/**
 * Abstract Base Mapper
 * Provides common mapping functionality for all entity mappers
 * Follows Open/Closed Principle - open for extension, closed for modification
 *
 * @template TEntity - Domain entity type
 * @template TCreateDto - DTO for creating entities
 * @template TUpdateDto - DTO for updating entities
 * @template TResponseDto - DTO for entity responses
 */
export abstract class BaseMapper<
  TEntity,
  TCreateDto extends CreateDto,
  TUpdateDto extends UpdateDto,
  TResponseDto extends ResponseDto,
> {
  /**
   * Maps CreateDto to domain entity
   * Must be implemented by concrete mappers
   */
  abstract toDomain(dto: TCreateDto, id?: string): TEntity;

  /**
   * Maps domain entity to ResponseDto
   * Must be implemented by concrete mappers
   */
  abstract toResponseDto(entity: TEntity): TResponseDto;

  /**
   * Maps ResponseDto back to domain entity
   * Must be implemented by concrete mappers
   */
  abstract fromResponseDto(dto: TResponseDto): TEntity;

  /**
   * Applies UpdateDto to existing entity
   * Must be implemented by concrete mappers
   */
  abstract applyUpdate(entity: TEntity, dto: TUpdateDto): TEntity;

  /**
   * Maps array of entities to array of ResponseDtos
   * Common implementation for all mappers
   */
  toResponseDtoList(entities: TEntity[]): TResponseDto[] {
    return entities.map((entity) => this.toResponseDto(entity));
  }

  /**
   * Maps array of ResponseDtos to array of entities
   * Common implementation for all mappers
   */
  fromResponseDtoList(dtos: TResponseDto[]): TEntity[] {
    return dtos.map((dto) => this.fromResponseDto(dto));
  }

  /**
   * Generates a new UUID
   * Common utility for all mappers
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Converts Date to ISO string, handles undefined
   * Common utility for all mappers
   */
  protected dateToIsoString(date?: Date): string | undefined {
    return date?.toISOString();
  }

  /**
   * Converts ISO string to Date, handles undefined
   * Common utility for all mappers
   */
  protected isoStringToDate(isoString?: string): Date | undefined {
    return isoString ? new Date(isoString) : undefined;
  }

  /**
   * Validates that required fields are present
   * Common utility for all mappers
   */
  protected validateRequired(value: unknown, fieldName: string): void {
    if (value === undefined || value === null) {
      throw new Error(`${fieldName} is required`);
    }
  }
}

// Made with Bob
