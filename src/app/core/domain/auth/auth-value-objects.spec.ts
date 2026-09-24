import { describe, it, expect } from 'vitest';
import { OrgId } from './org-id.value-object';
import { StoreId } from './store-id.value-object';
import { TerminalId, TerminalMode } from './terminal-id.value-object';

// ─── OrgId ──────────────────────────────────────────────────────────────────

describe('OrgId', () => {
  it('creates a valid OrgId', () => {
    const id = new OrgId('my-org');
    expect(id.value).toBe('my-org');
    expect(id.toString()).toBe('my-org');
    expect(id.toJSON()).toBe('my-org');
  });

  it('trims whitespace', () => {
    const id = new OrgId('  trimmed  ');
    expect(id.value).toBe('trimmed');
  });

  it('allows underscores and hyphens', () => {
    expect(() => new OrgId('my_org-1')).not.toThrow();
  });

  it('throws for empty string', () => {
    expect(() => new OrgId('')).toThrow('non-empty');
    expect(() => new OrgId('   ')).toThrow('non-empty');
  });

  it('throws for non-string', () => {
    expect(() => new OrgId(null as unknown as string)).toThrow('non-empty');
  });

  it('throws for value over 128 chars', () => {
    expect(() => new OrgId('a'.repeat(129))).toThrow('128');
  });

  it('throws for invalid characters', () => {
    expect(() => new OrgId('invalid org!')).toThrow('alphanumeric');
    expect(() => new OrgId('invalid/org')).toThrow('alphanumeric');
  });

  it('equals another OrgId with same value', () => {
    expect(new OrgId('org-a').equals(new OrgId('org-a'))).toBe(true);
  });

  it('does not equal a different OrgId', () => {
    expect(new OrgId('org-a').equals(new OrgId('org-b'))).toBe(false);
  });

  it('does not equal a non-OrgId', () => {
    expect(new OrgId('org-a').equals('org-a' as unknown as OrgId)).toBe(false);
  });

  it('fromJSON round-trips', () => {
    const id = OrgId.fromJSON('my-org');
    expect(id.value).toBe('my-org');
  });

  it('DEFAULT is a valid singleton', () => {
    expect(OrgId.DEFAULT.value).toBe('default-org');
  });

  it('is frozen', () => {
    const id = new OrgId('org');
    expect(Object.isFrozen(id)).toBe(true);
  });
});

// ─── StoreId ─────────────────────────────────────────────────────────────────

describe('StoreId', () => {
  const org = new OrgId('acme');

  it('creates a valid StoreId', () => {
    const id = new StoreId(org, 'store-1');
    expect(id.value).toBe('acme/store-1');
    expect(id.slug).toBe('store-1');
    expect(id.orgId).toBe(org);
    expect(id.toString()).toBe('acme/store-1');
  });

  it('trims slug whitespace', () => {
    const id = new StoreId(org, '  trimmed  ');
    expect(id.slug).toBe('trimmed');
  });

  it('throws when orgId is not an OrgId instance', () => {
    expect(() => new StoreId('not-an-orgid' as unknown as OrgId, 'store')).toThrow('OrgId');
  });

  it('throws for empty slug', () => {
    expect(() => new StoreId(org, '')).toThrow('non-empty');
  });

  it('throws for slug over 128 chars', () => {
    expect(() => new StoreId(org, 'a'.repeat(129))).toThrow('128');
  });

  it('throws for invalid slug characters', () => {
    expect(() => new StoreId(org, 'bad slug!')).toThrow('alphanumeric');
  });

  it('equals another StoreId with same org and slug', () => {
    expect(new StoreId(org, 'store-1').equals(new StoreId(new OrgId('acme'), 'store-1'))).toBe(
      true
    );
  });

  it('does not equal a StoreId with different slug', () => {
    expect(new StoreId(org, 'store-1').equals(new StoreId(org, 'store-2'))).toBe(false);
  });

  it('does not equal a StoreId with different org', () => {
    expect(new StoreId(org, 'store-1').equals(new StoreId(new OrgId('other'), 'store-1'))).toBe(
      false
    );
  });

  it('does not equal a non-StoreId', () => {
    expect(new StoreId(org, 'store-1').equals('x' as unknown as StoreId)).toBe(false);
  });

  it('toJSON includes orgId and storeSlug', () => {
    const json = new StoreId(org, 'store-1').toJSON();
    expect(json).toEqual({ orgId: 'acme', storeSlug: 'store-1' });
  });

  it('fromJSON round-trips', () => {
    const id = StoreId.fromJSON({ orgId: 'acme', storeSlug: 'store-1' });
    expect(id.value).toBe('acme/store-1');
  });

  it('parse handles valid composite string', () => {
    const id = StoreId.parse('acme/store-1');
    expect(id.value).toBe('acme/store-1');
  });

  it('parse throws for missing separator', () => {
    expect(() => StoreId.parse('no-slash')).toThrow('parse');
  });

  it('parse throws when separator is first char', () => {
    expect(() => StoreId.parse('/store')).toThrow('parse');
  });

  it('parse throws when separator is last char', () => {
    expect(() => StoreId.parse('org/')).toThrow('parse');
  });

  it('DEFAULT is a valid singleton', () => {
    expect(StoreId.DEFAULT.value).toBe('default-org/default-store');
  });
});

// ─── TerminalId ──────────────────────────────────────────────────────────────

describe('TerminalId', () => {
  const store = StoreId.DEFAULT;

  it('creates an operator terminal by default', () => {
    const id = new TerminalId(store, 'pos-1');
    expect(id.mode).toBe(TerminalMode.OPERATOR);
    expect(id.isOperator).toBe(true);
    expect(id.isKiosk).toBe(false);
    expect(id.value).toBe('default-org/default-store/pos-1');
    expect(id.toString()).toBe('default-org/default-store/pos-1 [operator]');
  });

  it('creates a kiosk terminal', () => {
    const id = new TerminalId(store, 'kiosk-1', TerminalMode.KIOSK);
    expect(id.isKiosk).toBe(true);
    expect(id.isOperator).toBe(false);
    expect(id.mode).toBe(TerminalMode.KIOSK);
  });

  it('exposes storeId and slug', () => {
    const id = new TerminalId(store, 'pos-2');
    expect(id.storeId).toBe(store);
    expect(id.slug).toBe('pos-2');
  });

  it('trims slug', () => {
    const id = new TerminalId(store, '  t1  ');
    expect(id.slug).toBe('t1');
  });

  it('throws when storeId is not a StoreId', () => {
    expect(() => new TerminalId('not-a-store' as unknown as StoreId, 'pos')).toThrow('StoreId');
  });

  it('throws for empty slug', () => {
    expect(() => new TerminalId(store, '')).toThrow('non-empty');
  });

  it('throws for slug over 128 chars', () => {
    expect(() => new TerminalId(store, 'a'.repeat(129))).toThrow('128');
  });

  it('throws for invalid slug characters', () => {
    expect(() => new TerminalId(store, 'bad!')).toThrow('alphanumeric');
  });

  it('throws for invalid mode', () => {
    expect(() => new TerminalId(store, 'pos', 'invalid' as TerminalMode)).toThrow('mode');
  });

  it('equals another TerminalId with same store and slug', () => {
    expect(new TerminalId(store, 'pos-1').equals(new TerminalId(store, 'pos-1'))).toBe(true);
  });

  it('does not equal a TerminalId with different slug', () => {
    expect(new TerminalId(store, 'pos-1').equals(new TerminalId(store, 'pos-2'))).toBe(false);
  });

  it('does not equal a non-TerminalId', () => {
    expect(new TerminalId(store, 'pos-1').equals('x' as unknown as TerminalId)).toBe(false);
  });

  it('toJSON serializes all fields', () => {
    const id = new TerminalId(store, 'pos-1', TerminalMode.KIOSK);
    expect(id.toJSON()).toEqual({
      orgId: 'default-org',
      storeSlug: 'default-store',
      terminalSlug: 'pos-1',
      mode: 'kiosk',
    });
  });

  it('fromJSON round-trips with explicit mode', () => {
    const id = TerminalId.fromJSON({
      orgId: 'acme',
      storeSlug: 'store-1',
      terminalSlug: 'kiosk-1',
      mode: TerminalMode.KIOSK,
    });
    expect(id.isKiosk).toBe(true);
    expect(id.value).toBe('acme/store-1/kiosk-1');
  });

  it('fromJSON defaults mode to operator when omitted', () => {
    const id = TerminalId.fromJSON({
      orgId: 'acme',
      storeSlug: 'store-1',
      terminalSlug: 'pos-1',
    });
    expect(id.isOperator).toBe(true);
  });

  it('DEFAULT is operator mode', () => {
    expect(TerminalId.DEFAULT.isOperator).toBe(true);
  });

  it('DEFAULT_KIOSK is kiosk mode', () => {
    expect(TerminalId.DEFAULT_KIOSK.isKiosk).toBe(true);
  });
});
