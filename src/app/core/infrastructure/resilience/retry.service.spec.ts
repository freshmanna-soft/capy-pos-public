import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RetryService,
  RetryStrategy,
  RetryExhaustedError,
} from '@core/infrastructure/resilience/retry.service';

describe('RetryService', () => {
  let service: RetryService;

  beforeEach(() => {
    service = new RetryService();
  });

  afterEach(() => {
    service.clearStats();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('execute', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await service.execute('test-op', fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0;
      const fn = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      const result = await service.execute('test-op', fn, {
        maxAttempts: 3,
        initialDelay: 10,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw RetryExhaustedError after max attempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Persistent failure'));

      try {
        await service.execute('test-op', fn, {
          maxAttempts: 3,
          initialDelay: 10,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        expect((error as RetryExhaustedError).operationName).toBe('test-op');
        expect((error as RetryExhaustedError).attempts).toBe(3);
      }

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Validation error'));

      try {
        await service.execute('test-op', fn, {
          maxAttempts: 3,
          initialDelay: 10,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toBe('Validation error');
      }

      expect(fn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should respect custom shouldRetry function', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Custom error'));

      const shouldRetry = vi.fn().mockReturnValue(false);

      try {
        await service.execute('test-op', fn, {
          maxAttempts: 3,
          initialDelay: 10,
          shouldRetry,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toBe('Custom error');
      }

      expect(fn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalled();
    });

    it('should retry only specific error messages', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Network timeout'));

      try {
        await service.execute('test-op', fn, {
          maxAttempts: 3,
          initialDelay: 10,
          retryableErrors: ['timeout', 'connection'],
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
      }

      expect(fn).toHaveBeenCalledTimes(3); // Should retry
    });

    it('should not retry errors not in retryableErrors list', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Database error'));

      try {
        await service.execute('test-op', fn, {
          maxAttempts: 3,
          initialDelay: 10,
          retryableErrors: ['timeout', 'connection'],
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toBe('Database error');
      }

      expect(fn).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('Retry Strategies', () => {
    it('should use fixed delay strategy', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const startTimes: number[] = [];

      const fn = async () => {
        if (attempts > 0) {
          delays.push(Date.now() - startTimes[startTimes.length - 1]);
        }
        startTimes.push(Date.now());
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry me');
        }
        return 'success';
      };

      await service.execute('test-op', fn, {
        maxAttempts: 3,
        initialDelay: 50,
        strategy: RetryStrategy.FIXED,
      });

      expect(attempts).toBe(3);
      // Delays should be roughly equal (allowing for jitter ±25%)
      delays.forEach((delay) => {
        expect(delay).toBeGreaterThan(30); // 50ms - 25% jitter
        expect(delay).toBeLessThan(70); // 50ms + 25% jitter
      });
    });

    it('should use exponential backoff strategy', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const startTimes: number[] = [];

      const fn = async () => {
        if (attempts > 0) {
          delays.push(Date.now() - startTimes[startTimes.length - 1]);
        }
        startTimes.push(Date.now());
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry me');
        }
        return 'success';
      };

      await service.execute('test-op', fn, {
        maxAttempts: 3,
        initialDelay: 50,
        strategy: RetryStrategy.EXPONENTIAL,
        backoffMultiplier: 2,
      });

      expect(attempts).toBe(3);
      // Second delay should be roughly double the first
      if (delays.length >= 2) {
        expect(delays[1]).toBeGreaterThan(delays[0]);
      }
    });

    it('should use linear backoff strategy', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const startTimes: number[] = [];

      const fn = async () => {
        if (attempts > 0) {
          delays.push(Date.now() - startTimes[startTimes.length - 1]);
        }
        startTimes.push(Date.now());
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry me');
        }
        return 'success';
      };

      await service.execute('test-op', fn, {
        maxAttempts: 3,
        initialDelay: 50,
        strategy: RetryStrategy.LINEAR,
      });

      expect(attempts).toBe(3);
      // Delays should increase linearly
      if (delays.length >= 2) {
        expect(delays[1]).toBeGreaterThan(delays[0]);
      }
    });

    it('should respect maxDelay cap', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const startTimes: number[] = [];

      const fn = async () => {
        if (attempts > 0) {
          delays.push(Date.now() - startTimes[startTimes.length - 1]);
        }
        startTimes.push(Date.now());
        attempts++;
        if (attempts < 4) {
          throw new Error('Retry me');
        }
        return 'success';
      };

      await service.execute('test-op', fn, {
        maxAttempts: 4,
        initialDelay: 100,
        maxDelay: 150,
        strategy: RetryStrategy.EXPONENTIAL,
        backoffMultiplier: 3,
      });

      // All delays should be capped at maxDelay (with jitter)
      delays.forEach((delay) => {
        expect(delay).toBeLessThan(200); // maxDelay + jitter margin
      });
    });
  });

  describe('Convenience Methods', () => {
    it('should execute with exponential backoff', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Retry me');
        }
        return 'success';
      };

      const result = await service.executeWithExponentialBackoff('test-op', fn, 3, 10);

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should execute with fixed delay', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Retry me');
        }
        return 'success';
      };

      const result = await service.executeWithFixedDelay('test-op', fn, 3, 10);

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should execute with linear backoff', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Retry me');
        }
        return 'success';
      };

      const result = await service.executeWithLinearBackoff('test-op', fn, 3, 10);

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('Statistics', () => {
    it('should track successful retries', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry me');
        }
        return 'success';
      };

      await service.execute('test-op', fn, {
        maxAttempts: 3,
        initialDelay: 10,
      });

      const stats = service.getStats('test-op') as unknown;
      expect(stats.successfulRetries).toBe(1);
      expect(stats.failedRetries).toBe(0);
      expect(stats.totalAttempts).toBe(3);
    });

    it('should track failed retries', async () => {
      const fn = async () => {
        throw new Error('Always fail');
      };

      try {
        await service.execute('test-op', fn, {
          maxAttempts: 3,
          initialDelay: 10,
        });
      } catch (_error) {
        // Expected
      }

      const stats = service.getStats('test-op') as unknown;
      expect(stats.successfulRetries).toBe(0);
      expect(stats.failedRetries).toBe(1);
      expect(stats.totalAttempts).toBe(3);
    });

    it('should calculate average attempts', async () => {
      // First operation: 2 attempts
      let attempts1 = 0;
      const fn1 = async () => {
        attempts1++;
        if (attempts1 < 2) throw new Error('Retry');
        return 'success';
      };
      await service.execute('test-op', fn1, { maxAttempts: 3, initialDelay: 10 });

      // Second operation: 3 attempts
      let attempts2 = 0;
      const fn2 = async () => {
        attempts2++;
        if (attempts2 < 3) throw new Error('Retry');
        return 'success';
      };
      await service.execute('test-op', fn2, { maxAttempts: 3, initialDelay: 10 });

      const stats = service.getStats('test-op') as unknown;
      expect(stats.averageAttempts).toBe(2.5); // (2 + 3) / 2
    });

    it('should get all stats', async () => {
      const fn = async () => 'success';

      await service.execute('op1', fn);
      await service.execute('op2', fn);

      const allStats = service.getStats() as Record<string, unknown>;
      expect(Object.keys(allStats).length).toBe(2);
      expect(allStats['op1']).toBeDefined();
      expect(allStats['op2']).toBeDefined();
    });

    it('should clear specific operation stats', async () => {
      const fn = async () => 'success';

      // Execute operations to generate stats
      await service.execute('op1', fn);
      await service.execute('op2', fn);

      // Verify both have stats before clearing
      const statsBefore1 = service.getStats('op1') as unknown;
      const statsBefore2 = service.getStats('op2') as unknown;
      expect(statsBefore1.totalAttempts).toBeGreaterThan(0);
      expect(statsBefore2.totalAttempts).toBeGreaterThan(0);

      // Clear only op1
      service.clearStats('op1');

      // Verify op1 is cleared but op2 is not
      const stats1 = service.getStats('op1') as unknown;
      const stats2 = service.getStats('op2') as unknown;

      expect(stats1.totalAttempts).toBe(0); // Cleared
      expect(stats2.totalAttempts).toBeGreaterThan(0); // Not cleared
    });

    it('should clear all stats', async () => {
      const fn = async () => 'success';

      await service.execute('op1', fn);
      await service.execute('op2', fn);

      service.clearStats();

      const allStats = service.getStats() as Record<string, unknown>;
      expect(Object.keys(allStats).length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-Error objects', async () => {
      const fn = async () => {
        throw 'String error';
      };

      try {
        await service.execute('test-op', fn, {
          maxAttempts: 2,
          initialDelay: 10,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
      }
    });

    it('should preserve original error in RetryExhaustedError', async () => {
      const originalError = new Error('Original error');
      const fn = async () => {
        throw originalError;
      };

      try {
        await service.execute('test-op', fn, {
          maxAttempts: 2,
          initialDelay: 10,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        expect((error as RetryExhaustedError).lastError).toBe(originalError);
      }
    });
  });
});

// Made with Bob
