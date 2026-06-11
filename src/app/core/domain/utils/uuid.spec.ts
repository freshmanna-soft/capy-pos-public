import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateUUID } from '@core/domain/utils/uuid';

describe('generateUUID', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate a valid UUID v4 format string', () => {
    const uuid = generateUUID();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuid).toMatch(uuidRegex);
  });

  it('should generate unique UUIDs', () => {
    const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(uuids.size).toBe(100);
  });

  it('should use crypto.randomUUID when available', () => {
    const mockUUID = '12345678-1234-4123-8123-123456789abc';
    const spy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(mockUUID as `${string}-${string}-${string}-${string}-${string}`);
    const result = generateUUID();
    expect(result).toBe(mockUUID);
    expect(spy).toHaveBeenCalled();
  });

  it('should use fallback when crypto.randomUUID is not available', () => {
    const originalRandomUUID = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });

    const uuid = generateUUID();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuid).toMatch(uuidRegex);

    Object.defineProperty(crypto, 'randomUUID', { value: originalRandomUUID, configurable: true });
  });
});
