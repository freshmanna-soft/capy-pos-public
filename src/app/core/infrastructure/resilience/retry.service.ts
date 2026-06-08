import { Injectable } from '@angular/core';

/**
 * Retry Strategy
 */
export enum RetryStrategy {
  FIXED = 'FIXED',           // Fixed delay between retries
  EXPONENTIAL = 'EXPONENTIAL', // Exponential backoff
  LINEAR = 'LINEAR'          // Linear backoff
}

/**
 * Retry Configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;      // Initial delay in ms
  maxDelay: number;          // Maximum delay in ms
  strategy: RetryStrategy;
  backoffMultiplier: number; // For exponential/linear strategies
  retryableErrors?: string[]; // Specific error messages to retry
  shouldRetry?: (error: any) => boolean; // Custom retry condition
}

/**
 * Retry Result
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: any;
  attempts: number;
  totalDelay: number;
}

/**
 * Retry Statistics
 */
export interface RetryStats {
  operationName: string;
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  averageAttempts: number;
  lastAttemptTime?: Date;
}

/**
 * Retry Error
 * Thrown when all retry attempts are exhausted
 */
export class RetryExhaustedError extends Error {
  constructor(
    public readonly operationName: string,
    public readonly attempts: number,
    public readonly lastError: any
  ) {
    super(`Retry exhausted for ${operationName} after ${attempts} attempts`);
    this.name = 'RetryExhaustedError';
    Object.setPrototypeOf(this, RetryExhaustedError.prototype);
  }
}

/**
 * Retry Service
 * Implements retry logic with various backoff strategies
 * 
 * Features:
 * - Multiple retry strategies (fixed, exponential, linear)
 * - Configurable retry conditions
 * - Retry statistics tracking
 * - Jitter support to prevent thundering herd
 */
@Injectable({
  providedIn: 'root'
})
export class RetryService {
  private stats = new Map<string, RetryStats>();
  
  private defaultConfig: RetryConfig = {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    strategy: RetryStrategy.EXPONENTIAL,
    backoffMultiplier: 2
  };

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    operationName: string,
    fn: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const finalConfig = { ...this.defaultConfig, ...config };
    let lastError: any;
    let totalDelay = 0;
    
    this.initStats(operationName);

    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
      try {
        const result = await fn();
        
        // Update stats on success
        this.updateStats(operationName, attempt, true);
        
        return result;
      } catch (error) {
        lastError = error;
        
        // Check if we should retry this error
        if (!this.shouldRetry(error, finalConfig)) {
          this.updateStats(operationName, attempt, false);
          throw error;
        }

        // Don't delay after the last attempt
        if (attempt < finalConfig.maxAttempts) {
          const delay = this.calculateDelay(attempt, finalConfig);
          totalDelay += delay;
          
          console.log(
            `[Retry:${operationName}] Attempt ${attempt}/${finalConfig.maxAttempts} failed. ` +
            `Retrying in ${delay}ms...`,
            { error: error instanceof Error ? error.message : error }
          );
          
          await this.delay(delay);
        }
      }
    }

    // All attempts failed
    this.updateStats(operationName, finalConfig.maxAttempts, false);
    console.error(
      `[Retry:${operationName}] All ${finalConfig.maxAttempts} attempts failed`,
      lastError
    );
    throw new RetryExhaustedError(operationName, finalConfig.maxAttempts, lastError);
  }

  /**
   * Execute with exponential backoff
   */
  async executeWithExponentialBackoff<T>(
    operationName: string,
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    return this.execute(operationName, fn, {
      maxAttempts,
      initialDelay,
      strategy: RetryStrategy.EXPONENTIAL
    });
  }

  /**
   * Execute with fixed delay
   */
  async executeWithFixedDelay<T>(
    operationName: string,
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    delay: number = 1000
  ): Promise<T> {
    return this.execute(operationName, fn, {
      maxAttempts,
      initialDelay: delay,
      strategy: RetryStrategy.FIXED
    });
  }

  /**
   * Execute with linear backoff
   */
  async executeWithLinearBackoff<T>(
    operationName: string,
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    return this.execute(operationName, fn, {
      maxAttempts,
      initialDelay,
      strategy: RetryStrategy.LINEAR
    });
  }

  /**
   * Get retry statistics
   */
  getStats(operationName?: string): RetryStats | Record<string, RetryStats> {
    if (operationName) {
      return this.stats.get(operationName) || this.createEmptyStats(operationName);
    }
    
    const allStats: Record<string, RetryStats> = {};
    this.stats.forEach((stats, name) => {
      allStats[name] = stats;
    });
    return allStats;
  }

  /**
   * Clear statistics
   */
  clearStats(operationName?: string): void {
    if (operationName) {
      this.stats.delete(operationName);
    } else {
      this.stats.clear();
    }
  }

  /**
   * Private methods
   */

  private calculateDelay(attempt: number, config: RetryConfig): number {
    let delay: number;

    switch (config.strategy) {
      case RetryStrategy.FIXED:
        delay = config.initialDelay;
        break;

      case RetryStrategy.EXPONENTIAL:
        delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1);
        break;

      case RetryStrategy.LINEAR:
        delay = config.initialDelay * attempt;
        break;

      default:
        delay = config.initialDelay;
    }

    // Apply max delay cap
    delay = Math.min(delay, config.maxDelay);

    // Add jitter (±25% randomness) to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay = Math.max(0, delay + jitter);

    return Math.floor(delay);
  }

  private shouldRetry(error: any, config: RetryConfig): boolean {
    // Use custom retry condition if provided
    if (config.shouldRetry) {
      return config.shouldRetry(error);
    }

    // Check if error message matches retryable errors
    if (config.retryableErrors && config.retryableErrors.length > 0) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return config.retryableErrors.some(retryable => 
        errorMessage.includes(retryable)
      );
    }

    // Default: retry all errors except specific non-retryable ones
    const errorMessage = error instanceof Error ? error.message : String(error);
    const nonRetryablePatterns = [
      'validation',
      'invalid',
      'unauthorized',
      'forbidden',
      'not found',
      'bad request'
    ];

    return !nonRetryablePatterns.some(pattern => 
      errorMessage.toLowerCase().includes(pattern)
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private initStats(operationName: string): void {
    if (!this.stats.has(operationName)) {
      this.stats.set(operationName, this.createEmptyStats(operationName));
    }
  }

  private createEmptyStats(operationName: string): RetryStats {
    return {
      operationName,
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageAttempts: 0
    };
  }

  private updateStats(operationName: string, attempts: number, success: boolean): void {
    const stats = this.stats.get(operationName);
    if (!stats) return;

    stats.totalAttempts += attempts;
    stats.lastAttemptTime = new Date();

    if (success) {
      stats.successfulRetries++;
    } else {
      stats.failedRetries++;
    }

    const totalOperations = stats.successfulRetries + stats.failedRetries;
    stats.averageAttempts = stats.totalAttempts / totalOperations;
  }
}

/**
 * Retry Decorator
 * Can be used as a method decorator to add retry logic
 */
export function Retry(config?: Partial<RetryConfig>) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const retryService = new RetryService();
      const operationName = `${target.constructor.name}.${propertyKey}`;
      
      return retryService.execute(
        operationName,
        () => originalMethod.apply(this, args),
        config
      );
    };

    return descriptor;
  };
}

// Made with Bob
