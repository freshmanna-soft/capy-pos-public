import { describe, expect, it } from 'vitest';
import { validateSearch, authorizeReindex } from './server.mjs';

describe('authorizeReindex', () => {
  it('is disabled when no secret is configured', () => {
    expect(authorizeReindex({ 'x-webhook-secret': 'anything' }, undefined)).toBe('disabled');
  });
  it('authorizes a matching secret', () => {
    expect(authorizeReindex({ 'x-webhook-secret': 's3cret' }, 's3cret')).toBe('ok');
  });
  it('rejects a wrong/missing secret', () => {
    expect(authorizeReindex({ 'x-webhook-secret': 'nope' }, 's3cret')).toBe('unauthorized');
    expect(authorizeReindex({}, 's3cret')).toBe('unauthorized');
  });
});

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
