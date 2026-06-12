/**
 * Base Domain Service
 *
 * Abstract base class for all domain services providing common functionality.
 * Follows Template Method Pattern and Open/Closed Principle (OCP).
 *
 * Domain services encapsulate business logic that doesn't naturally fit within
 * a single entity or value object. They are stateless and operate on domain objects.
 *
 * @example
 * ```typescript
 * export class PricingService extends BaseDomainService implements IPricingService {
 *   constructor() {
 *     super('PricingService');
 *   }
 *
 *   calculatePrice(product: Product, quantity: number): Money {
 *     this.validateInput(quantity > 0, 'Quantity must be positive');
 *     // ... implementation
 *   }
 * }
 * ```
 */
export abstract class BaseDomainService {
  /**
   * Service name for logging and debugging
   */
  protected readonly serviceName: string;

  /**
   * Constructor
   * @param serviceName Name of the service for identification
   */
  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.initialize();
  }

  /**
   * Initialize hook - called after construction
   * Override this method to perform initialization logic
   */
  protected initialize(): void {
    // Default implementation does nothing
    // Subclasses can override to add initialization logic
  }

  /**
   * Validate input and throw error if invalid
   * @param condition Condition that must be true
   * @param errorMessage Error message if condition is false
   * @throws Error if condition is false
   */
  protected validateInput(condition: boolean, errorMessage: string): void {
    if (!condition) {
      throw new Error(`[${this.serviceName}] ${errorMessage}`);
    }
  }

  /**
   * Validate that a value is not null or undefined
   * @param value Value to check
   * @param paramName Parameter name for error message
   * @throws Error if value is null or undefined
   */
  protected validateRequired<T>(
    value: T | null | undefined,
    paramName: string
  ): asserts value is T {
    if (value === null || value === undefined || (typeof value === 'string' && value === '')) {
      throw new Error(`[${this.serviceName}] ${paramName} is required`);
    }
  }

  /**
   * Validate that a number is positive
   * @param value Number to check
   * @param paramName Parameter name for error message
   * @throws Error if value is not positive
   */
  protected validatePositive(value: number, paramName: string): void {
    this.validateInput(value > 0, `${paramName} must be positive`);
  }

  /**
   * Validate that a number is non-negative
   * @param value Number to check
   * @param paramName Parameter name for error message
   * @throws Error if value is negative
   */
  protected validateNonNegative(value: number, paramName: string): void {
    this.validateInput(value >= 0, `${paramName} must be non-negative, got ${value}`);
  }

  /**
   * Validate that a value is within a range
   * @param value Value to check
   * @param min Minimum value (inclusive)
   * @param max Maximum value (inclusive)
   * @param paramName Parameter name for error message
   * @throws Error if value is out of range
   */
  protected validateRange(value: number, min: number, max: number, paramName: string): void {
    this.validateInput(
      value >= min && value <= max,
      `${paramName} must be between ${min} and ${max}, got ${value}`
    );
  }

  /**
   * Validate that a string is not empty
   * @param value String to check
   * @param paramName Parameter name for error message
   * @throws Error if string is empty
   */
  protected validateNotEmpty(value: string, paramName: string): void {
    this.validateRequired(value, paramName);
    this.validateInput(value.trim().length > 0, `${paramName} cannot be empty`);
  }

  /**
   * Validate that an array is not empty
   * @param value Array to check
   * @param paramName Parameter name for error message
   * @throws Error if array is empty
   */
  protected validateArrayNotEmpty<T>(value: T[], paramName: string): void {
    this.validateRequired(value, paramName);
    this.validateInput(value.length > 0, `${paramName} cannot be empty`);
  }

  /**
   * Log debug information (can be overridden for custom logging)
   * @param message Message to log
   * @param data Optional data to log
   */
  protected logDebug(message: string, data?: unknown): void {
    // Only log in development mode (can be controlled via Angular environment)
    console.debug(`[${this.serviceName}] ${message}`, data || '');
  }

  /**
   * Log warning (can be overridden for custom logging)
   * @param message Warning message
   * @param data Optional data to log
   */
  protected logWarning(message: string, data?: unknown): void {
    console.warn(`[${this.serviceName}] ${message}`, data || '');
  }

  /**
   * Log error (can be overridden for custom logging)
   * @param message Error message
   * @param error Optional error object
   */
  protected logError(message: string, error?: Error): void {
    console.error(`[${this.serviceName}] ${message}`, error || '');
  }

  /**
   * Execute a function with error handling
   * @param fn Function to execute
   * @param errorMessage Error message prefix
   * @returns Result of the function
   * @throws Error with service name prefix
   */
  protected executeWithErrorHandling<T>(fn: () => T, errorMessage: string): T {
    try {
      return fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[${this.serviceName}] ${errorMessage}: ${message}`, { cause: error });
    }
  }

  /**
   * Execute an async function with error handling
   * @param fn Async function to execute
   * @param errorMessage Error message prefix
   * @returns Promise with result of the function
   * @throws Error with service name prefix
   */
  protected async executeAsyncWithErrorHandling<T>(
    fn: () => Promise<T>,
    errorMessage: string
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[${this.serviceName}] ${errorMessage}: ${message}`, { cause: error });
    }
  }

  /**
   * Get service name
   */
  getServiceName(): string {
    return this.serviceName;
  }
}

// Made with Bob
