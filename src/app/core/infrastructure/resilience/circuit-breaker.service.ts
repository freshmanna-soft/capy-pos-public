import { Injectable } from '@angular/core';

/**
 * Circuit Breaker Error
 * Thrown when circuit breaker is open
 */
export class CircuitBreakerError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly state: CircuitState,
  ) {
    super(`Circuit breaker is ${state} for ${circuitName}`);
    this.name = 'CircuitBreakerError';
    Object.setPrototypeOf(this, CircuitBreakerError.prototype);
  }
}

/**
 * Circuit Breaker State
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  successThreshold: number; // Number of successes to close from half-open
  timeout: number; // Time in ms before attempting half-open
  monitoringPeriod: number; // Time window for failure counting (ms)
}

/**
 * Circuit Breaker Statistics
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

/**
 * Circuit Breaker
 * Implements the Circuit Breaker pattern to prevent cascading failures
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests are rejected immediately
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextAttemptTime?: Date;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private failureTimestamps: number[] = [];

  constructor(
    private name: string,
    private config: CircuitBreakerConfig,
  ) {}

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        console.log(`[CircuitBreaker:${this.name}] Attempting reset (HALF_OPEN)`);
      } else {
        throw new CircuitBreakerError(this.name, CircuitState.OPEN);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.failureTimestamps = [];
    this.nextAttemptTime = undefined;
    console.log(`[CircuitBreaker:${this.name}] Reset to CLOSED`);
  }

  /**
   * Private methods
   */

  private onSuccess(): void {
    this.totalSuccesses++;
    this.successes++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.failureTimestamps = [];
        console.log(`[CircuitBreaker:${this.name}] Closed after successful recovery`);
      }
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.failures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = new Date();

    const now = Date.now();
    this.failureTimestamps.push(now);

    // Remove old failures outside monitoring period
    this.failureTimestamps = this.failureTimestamps.filter(
      (timestamp) => now - timestamp < this.config.monitoringPeriod,
    );

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open state reopens the circuit
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = new Date(Date.now() + this.config.timeout);
      console.log(`[CircuitBreaker:${this.name}] Reopened after failure in HALF_OPEN`);
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we should open the circuit
      if (this.failureTimestamps.length >= this.config.failureThreshold) {
        this.state = CircuitState.OPEN;
        this.nextAttemptTime = new Date(Date.now() + this.config.timeout);
        console.log(
          `[CircuitBreaker:${this.name}] Opened after ${this.failureTimestamps.length} failures`,
        );
      }
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.nextAttemptTime) {
      return true;
    }
    return Date.now() >= this.nextAttemptTime.getTime();
  }
}

/**
 * Circuit Breaker Service
 * Manages multiple circuit breakers for different services/operations
 */
@Injectable({
  providedIn: 'root',
})
export class CircuitBreakerService {
  private breakers = new Map<string, CircuitBreaker>();

  private defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000, // 1 minute
    monitoringPeriod: 120000, // 2 minutes
  };

  /**
   * Get or create a circuit breaker
   */
  getBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const finalConfig = { ...this.defaultConfig, ...config };
      this.breakers.set(name, new CircuitBreaker(name, finalConfig));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Execute with circuit breaker protection
   */
  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>,
  ): Promise<T> {
    const breaker = this.getBreaker(name, config);
    return breaker.execute(fn);
  }

  /**
   * Get all circuit breaker statistics
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    this.breakers.forEach((breaker, name) => {
      stats[name] = breaker.getStats();
    });
    return stats;
  }

  /**
   * Reset a specific circuit breaker
   */
  reset(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.forEach((breaker) => breaker.reset());
  }

  /**
   * Remove a circuit breaker
   */
  remove(name: string): void {
    this.breakers.delete(name);
  }

  /**
   * Clear all circuit breakers
   */
  clear(): void {
    this.breakers.clear();
  }
}

// Made with Bob
