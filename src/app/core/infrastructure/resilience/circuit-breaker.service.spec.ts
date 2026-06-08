import { TestBed } from '@angular/core/testing';
import { CircuitBreakerService, CircuitState, CircuitBreakerError } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CircuitBreakerService]
    });
    service = TestBed.inject(CircuitBreakerService);
  });

  afterEach(() => {
    if (service) {
      service.clear();
    }
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Circuit Breaker States', () => {
    it('should start in CLOSED state', async () => {
      const breaker = service.getBreaker('test-service');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should open circuit after threshold failures', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 3,
        timeout: 1000
      });

      // Simulate 3 failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Test failure');
          });
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject requests when circuit is OPEN', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 2,
        timeout: 5000
      });

      // Cause circuit to open
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Test failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Try to execute when circuit is open
      try {
        await breaker.execute(async () => 'success');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerError);
        expect((error as CircuitBreakerError).circuitName).toBe('test-service');
        expect((error as CircuitBreakerError).state).toBe(CircuitState.OPEN);
      }
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 2,
        timeout: 100 // Short timeout for testing
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Test failure');
          });
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Next execution should transition to HALF_OPEN
      try {
        await breaker.execute(async () => 'success');
      } catch (error) {
        // May fail, but state should change
      }

      const state = breaker.getState();
      expect(state === CircuitState.HALF_OPEN || state === CircuitState.CLOSED).toBe(true);
    });

    it('should close circuit after successful recoveries in HALF_OPEN', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 100
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Test failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Execute successful operations
      await breaker.execute(async () => 'success1');
      await breaker.execute(async () => 'success2');

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reopen circuit on failure in HALF_OPEN state', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 2,
        timeout: 100
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Test failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Fail in HALF_OPEN state
      try {
        await breaker.execute(async () => {
          throw new Error('Still failing');
        });
      } catch (error) {
        // Expected
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('Statistics', () => {
    it('should track successful executions', async () => {
      const breaker = service.getBreaker('test-service');

      await breaker.execute(async () => 'success1');
      await breaker.execute(async () => 'success2');

      const stats = breaker.getStats();
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.consecutiveSuccesses).toBe(2);
    });

    it('should track failed executions', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 5
      });

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Test failure');
          });
        } catch (error) {
          // Expected
        }
      }

      const stats = breaker.getStats();
      expect(stats.totalFailures).toBe(3);
      expect(stats.consecutiveFailures).toBe(3);
    });

    it('should reset consecutive counters on state change', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 5
      });

      // Some failures
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Test failure');
          });
        } catch (error) {
          // Expected
        }
      }

      // Then success
      await breaker.execute(async () => 'success');

      const stats = breaker.getStats();
      expect(stats.consecutiveFailures).toBe(0);
      expect(stats.consecutiveSuccesses).toBe(1);
    });
  });

  describe('Service Management', () => {
    it('should create and retrieve circuit breakers', () => {
      const breaker1 = service.getBreaker('service1');
      const breaker2 = service.getBreaker('service1');

      expect(breaker1).toBe(breaker2); // Same instance
    });

    it('should create different breakers for different services', () => {
      const breaker1 = service.getBreaker('service1');
      const breaker2 = service.getBreaker('service2');

      expect(breaker1).not.toBe(breaker2);
    });

    it('should execute with custom config', async () => {
      const result = await service.execute(
        'test-service',
        async () => 'success',
        { failureThreshold: 10 }
      );

      expect(result).toBe('success');
    });

    it('should get all stats', async () => {
      await service.execute('service1', async () => 'success');
      await service.execute('service2', async () => 'success');

      const allStats = service.getAllStats();
      expect(Object.keys(allStats).length).toBe(2);
      expect(allStats['service1']).toBeDefined();
      expect(allStats['service2']).toBeDefined();
    });

    it('should reset specific breaker', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 2
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Test failure');
          });
        } catch (error) {
          // Expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      service.reset('test-service');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reset all breakers', async () => {
      const breaker1 = service.getBreaker('service1', { failureThreshold: 1 });
      const breaker2 = service.getBreaker('service2', { failureThreshold: 1 });

      // Open both circuits
      try {
        await breaker1.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      try {
        await breaker2.execute(async () => { throw new Error('fail'); });
      } catch (e) {}

      service.resetAll();

      expect(breaker1.getState()).toBe(CircuitState.CLOSED);
      expect(breaker2.getState()).toBe(CircuitState.CLOSED);
    });

    it('should remove breaker', () => {
      service.getBreaker('test-service');
      service.remove('test-service');

      const allStats = service.getAllStats();
      expect(allStats['test-service']).toBeUndefined();
    });

    it('should clear all breakers', () => {
      service.getBreaker('service1');
      service.getBreaker('service2');
      
      service.clear();

      const allStats = service.getAllStats();
      expect(Object.keys(allStats).length).toBe(0);
    });
  });

  describe('Monitoring Period', () => {
    it('should only count recent failures within monitoring period', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 3,
        monitoringPeriod: 200 // 200ms window
      });

      // First failure
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}

      // Wait for monitoring period to expire
      await new Promise(resolve => setTimeout(resolve, 250));

      // Two more failures (should not open circuit as first is outside window)
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors when circuit is closed', async () => {
      const breaker = service.getBreaker('test-service', {
        failureThreshold: 5
      });

      try {
        await breaker.execute(async () => {
          throw new Error('Custom error');
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Custom error');
      }
    });

    it('should handle successful executions', async () => {
      const breaker = service.getBreaker('test-service');

      const result = await breaker.execute(async () => {
        return { data: 'test' };
      });

      expect(result).toEqual({ data: 'test' });
    });
  });
});

// Made with Bob
