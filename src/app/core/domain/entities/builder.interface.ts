/**
 * IBuilder Interface
 * Generic contract for all Builder implementations.
 * Follows the Builder design pattern (GoF) with a fluent API.
 *
 * @typeParam T - The type of entity this builder produces
 */
export interface IBuilder<T> {
  /**
   * Constructs and returns the final entity.
   * Implementations should validate required fields before building.
   * @throws Error if the entity cannot be constructed due to invalid state
   */
  build(): T;
}
