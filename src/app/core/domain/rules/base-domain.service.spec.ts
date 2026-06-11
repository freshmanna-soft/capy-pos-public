import { BaseDomainService } from '@core/domain/rules/base-domain.service';

/**
 * Concrete implementation for testing the abstract BaseDomainService
 */
class TestDomainService extends BaseDomainService {
  public initializeCalled: boolean;

  constructor(name = 'TestService') {
    super(name);
    this.initializeCalled = false;
  }

  protected override initialize(): void {
    // Note: Due to JS class initialization order, we track via a spy instead
    // The initialize() method IS called by super(), but property initializers
    // run after super() returns, so we verify via spy in the test
  }

  // Expose protected methods for testing
  public testValidateInput(condition: boolean, errorMessage: string): void {
    this.validateInput(condition, errorMessage);
  }

  public testValidateRequired<T>(value: T | null | undefined, paramName: string): void {
    this.validateRequired(value, paramName);
  }

  public testValidatePositive(value: number, paramName: string): void {
    this.validatePositive(value, paramName);
  }

  public testValidateNonNegative(value: number, paramName: string): void {
    this.validateNonNegative(value, paramName);
  }

  public testValidateRange(value: number, min: number, max: number, paramName: string): void {
    this.validateRange(value, min, max, paramName);
  }

  public testValidateNotEmpty(value: string, paramName: string): void {
    this.validateNotEmpty(value, paramName);
  }

  public testValidateArrayNotEmpty<T>(value: T[], paramName: string): void {
    this.validateArrayNotEmpty(value, paramName);
  }

  public testLogDebug(message: string, data?: unknown): void {
    this.logDebug(message, data);
  }

  public testLogWarning(message: string, data?: unknown): void {
    this.logWarning(message, data);
  }

  public testLogError(message: string, error?: Error): void {
    this.logError(message, error);
  }

  public testExecuteWithErrorHandling<T>(fn: () => T, errorMessage: string): T {
    return this.executeWithErrorHandling(fn, errorMessage);
  }

  public testExecuteAsyncWithErrorHandling<T>(
    fn: () => Promise<T>,
    errorMessage: string,
  ): Promise<T> {
    return this.executeAsyncWithErrorHandling(fn, errorMessage);
  }

  public testGetServiceName(): string {
    return this.getServiceName();
  }
}

describe('BaseDomainService', () => {
  let service: TestDomainService;

  beforeEach(() => {
    service = new TestDomainService();
  });

  describe('Construction and Initialization', () => {
    it('should set service name', () => {
      expect(service.testGetServiceName()).toBe('TestService');
    });

    it('should call initialize on construction', () => {
      // Verify initialize() is called by super() constructor via spy
      // Need to access protected method via prototype for spying
      const proto: Record<string, unknown> = TestDomainService.prototype as never;
      const initSpy = vi.spyOn(proto as { initialize: () => void }, 'initialize');
      const _newService = new TestDomainService('SpyTest');
      expect(initSpy).toHaveBeenCalled();
      initSpy.mockRestore();
    });

    it('should accept custom service name', () => {
      const custom = new TestDomainService('CustomService');
      expect(custom.testGetServiceName()).toBe('CustomService');
    });
  });

  describe('getServiceName', () => {
    it('should return the service name', () => {
      expect(service.testGetServiceName()).toBe('TestService');
    });
  });

  describe('validateInput', () => {
    it('should not throw when condition is true', () => {
      expect(() => service.testValidateInput(true, 'Error')).not.toThrow();
    });

    it('should throw with service name prefix when condition is false', () => {
      expect(() => service.testValidateInput(false, 'Something went wrong')).toThrow(
        '[TestService] Something went wrong',
      );
    });
  });

  describe('validateRequired', () => {
    it('should not throw for valid string', () => {
      expect(() => service.testValidateRequired('hello', 'name')).not.toThrow();
    });

    it('should not throw for valid number', () => {
      expect(() => service.testValidateRequired(42, 'count')).not.toThrow();
    });

    it('should not throw for zero', () => {
      expect(() => service.testValidateRequired(0, 'count')).not.toThrow();
    });

    it('should not throw for false', () => {
      expect(() => service.testValidateRequired(false, 'flag')).not.toThrow();
    });

    it('should throw for null', () => {
      expect(() => service.testValidateRequired(null, 'name')).toThrow(
        '[TestService] name is required',
      );
    });

    it('should throw for undefined', () => {
      expect(() => service.testValidateRequired(undefined, 'name')).toThrow(
        '[TestService] name is required',
      );
    });

    it('should throw for empty string', () => {
      expect(() => service.testValidateRequired('', 'name')).toThrow(
        '[TestService] name is required',
      );
    });
  });

  describe('validatePositive', () => {
    it('should not throw for positive number', () => {
      expect(() => service.testValidatePositive(1, 'quantity')).not.toThrow();
    });

    it('should not throw for large positive number', () => {
      expect(() => service.testValidatePositive(999999, 'quantity')).not.toThrow();
    });

    it('should throw for zero', () => {
      expect(() => service.testValidatePositive(0, 'quantity')).toThrow(
        '[TestService] quantity must be positive',
      );
    });

    it('should throw for negative number', () => {
      expect(() => service.testValidatePositive(-1, 'quantity')).toThrow(
        '[TestService] quantity must be positive',
      );
    });
  });

  describe('validateNonNegative', () => {
    it('should not throw for positive number', () => {
      expect(() => service.testValidateNonNegative(5, 'amount')).not.toThrow();
    });

    it('should not throw for zero', () => {
      expect(() => service.testValidateNonNegative(0, 'amount')).not.toThrow();
    });

    it('should throw for negative number', () => {
      expect(() => service.testValidateNonNegative(-1, 'amount')).toThrow(
        '[TestService] amount must be non-negative, got -1',
      );
    });
  });

  describe('validateRange', () => {
    it('should not throw when value is within range', () => {
      expect(() => service.testValidateRange(5, 1, 10, 'value')).not.toThrow();
    });

    it('should not throw when value equals min', () => {
      expect(() => service.testValidateRange(1, 1, 10, 'value')).not.toThrow();
    });

    it('should not throw when value equals max', () => {
      expect(() => service.testValidateRange(10, 1, 10, 'value')).not.toThrow();
    });

    it('should throw when value is below min', () => {
      expect(() => service.testValidateRange(0, 1, 10, 'value')).toThrow(
        '[TestService] value must be between 1 and 10, got 0',
      );
    });

    it('should throw when value is above max', () => {
      expect(() => service.testValidateRange(11, 1, 10, 'value')).toThrow(
        '[TestService] value must be between 1 and 10, got 11',
      );
    });
  });

  describe('validateNotEmpty', () => {
    it('should not throw for non-empty string', () => {
      expect(() => service.testValidateNotEmpty('hello', 'name')).not.toThrow();
    });

    it('should throw for empty string', () => {
      expect(() => service.testValidateNotEmpty('', 'name')).toThrow(
        '[TestService] name is required',
      );
    });

    it('should throw for whitespace-only string', () => {
      expect(() => service.testValidateNotEmpty('   ', 'name')).toThrow(
        '[TestService] name cannot be empty',
      );
    });
  });

  describe('validateArrayNotEmpty', () => {
    it('should not throw for non-empty array', () => {
      expect(() => service.testValidateArrayNotEmpty([1, 2, 3], 'items')).not.toThrow();
    });

    it('should not throw for array with one element', () => {
      expect(() => service.testValidateArrayNotEmpty(['a'], 'items')).not.toThrow();
    });

    it('should throw for empty array', () => {
      expect(() => service.testValidateArrayNotEmpty([], 'items')).toThrow(
        '[TestService] items cannot be empty',
      );
    });
  });

  describe('logDebug', () => {
    it('should call console.debug with service name prefix', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      service.testLogDebug('Test message', { key: 'value' });
      expect(spy).toHaveBeenCalledWith('[TestService] Test message', { key: 'value' });
      spy.mockRestore();
    });

    it('should call console.debug with empty string when no data', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      service.testLogDebug('Test message');
      expect(spy).toHaveBeenCalledWith('[TestService] Test message', '');
      spy.mockRestore();
    });
  });

  describe('logWarning', () => {
    it('should call console.warn with service name prefix', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      service.testLogWarning('Warning message', { detail: 'info' });
      expect(spy).toHaveBeenCalledWith('[TestService] Warning message', { detail: 'info' });
      spy.mockRestore();
    });

    it('should call console.warn with empty string when no data', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      service.testLogWarning('Warning message');
      expect(spy).toHaveBeenCalledWith('[TestService] Warning message', '');
      spy.mockRestore();
    });
  });

  describe('logError', () => {
    it('should call console.error with service name prefix', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const error = new Error('Something failed');
      service.testLogError('Error occurred', error);
      expect(spy).toHaveBeenCalledWith('[TestService] Error occurred', error);
      spy.mockRestore();
    });

    it('should call console.error with empty string when no error', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      service.testLogError('Error occurred');
      expect(spy).toHaveBeenCalledWith('[TestService] Error occurred', '');
      spy.mockRestore();
    });
  });

  describe('executeWithErrorHandling', () => {
    it('should return result on success', () => {
      const result = service.testExecuteWithErrorHandling(() => 42, 'Calculation failed');
      expect(result).toBe(42);
    });

    it('should return complex result on success', () => {
      const result = service.testExecuteWithErrorHandling(
        () => ({ name: 'test', value: 123 }),
        'Operation failed',
      );
      expect(result).toEqual({ name: 'test', value: 123 });
    });

    it('should wrap Error with service name prefix', () => {
      expect(() =>
        service.testExecuteWithErrorHandling(() => {
          throw new Error('Original error');
        }, 'Operation failed'),
      ).toThrow('[TestService] Operation failed: Original error');
    });

    it('should wrap non-Error throws with service name prefix', () => {
      expect(() =>
        service.testExecuteWithErrorHandling(() => {
          throw 'string error';
        }, 'Operation failed'),
      ).toThrow('[TestService] Operation failed: string error');
    });

    it('should preserve cause in wrapped error', () => {
      const originalError = new Error('Original');
      try {
        service.testExecuteWithErrorHandling(() => {
          throw originalError;
        }, 'Wrapped');
        // Should not reach here
        expect(true).toBe(false);
      } catch (e) {
        expect((e as Error).cause).toBe(originalError);
      }
    });
  });

  describe('executeAsyncWithErrorHandling', () => {
    it('should return result on success', async () => {
      const result = await service.testExecuteAsyncWithErrorHandling(
        async () => 'async result',
        'Async failed',
      );
      expect(result).toBe('async result');
    });

    it('should return complex async result', async () => {
      const result = await service.testExecuteAsyncWithErrorHandling(
        async () => ({ items: [1, 2, 3] }),
        'Async failed',
      );
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('should wrap async Error with service name prefix', async () => {
      await expect(
        service.testExecuteAsyncWithErrorHandling(async () => {
          throw new Error('Async original error');
        }, 'Async operation failed'),
      ).rejects.toThrow('[TestService] Async operation failed: Async original error');
    });

    it('should wrap non-Error async throws', async () => {
      await expect(
        service.testExecuteAsyncWithErrorHandling(async () => {
          throw 'async string error';
        }, 'Async operation failed'),
      ).rejects.toThrow('[TestService] Async operation failed: async string error');
    });

    it('should preserve cause in wrapped async error', async () => {
      const originalError = new Error('Async Original');
      try {
        await service.testExecuteAsyncWithErrorHandling(async () => {
          throw originalError;
        }, 'Wrapped async');
        expect(true).toBe(false);
      } catch (e) {
        expect((e as Error).cause).toBe(originalError);
      }
    });
  });

  describe('Default initialize (no override)', () => {
    it('should not throw when initialize is not overridden', () => {
      // Create a minimal subclass that does NOT override initialize
      class MinimalService extends BaseDomainService {
        constructor() {
          super('MinimalService');
        }

        // Expose for testing
        public testGetServiceName(): string {
          return this.getServiceName();
        }
      }

      const minimal = new MinimalService();
      expect(minimal.testGetServiceName()).toBe('MinimalService');
    });
  });
});
