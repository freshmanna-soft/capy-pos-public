import { describe, expect, it } from 'vitest';
import { validateSearch } from './server.mjs';

describe('validateSearch', () => {
  it('accepts a query and defaults k to 5', () => {
    expect(validateSearch({ query: 'hello' })).toEqual({ query: 'hello', k: 5 });
  });
  it('honors a positive integer k', () => {
    expect(validateSearch({ query: 'hello', k: 3 })).toEqual({ query: 'hello', k: 3 });
    expect(validateSearch({ query: 'hello', k: 2.9 })).toEqual({ query: 'hello', k: 2 });
  });
  it('rejects missing / empty / non-string query', () => {
    expect(() => validateSearch({})).toThrow(/query/);
    expect(() => validateSearch({ query: '   ' })).toThrow(/query/);
    expect(() => validateSearch({ query: 5 })).toThrow(/query/);
    expect(() => validateSearch(null)).toThrow(/query/);
  });
});
