import { describe, it, expect } from 'vitest';
import { Operator } from './operator.entity';

interface OperatorOverrides {
  id?: string;
  email?: string;
  displayName?: string;
  roleId?: string;
  tenantId?: string;
  passwordHash?: string;
}

const makeOperator = (overrides: OperatorOverrides = {}) => {
  const defaults: Required<OperatorOverrides> = {
    id: 'op-001',
    email: 'alice@store.com',
    displayName: 'Alice',
    roleId: 'admin',
    tenantId: 'default-tenant',
    passwordHash: '$2b$10$hashed',
  };
  const merged = { ...defaults, ...overrides };
  return new Operator(
    merged.id,
    merged.email,
    merged.displayName,
    merged.roleId,
    merged.tenantId,
    merged.passwordHash
  );
};

describe('Operator Entity', () => {
  describe('construction', () => {
    it('creates a valid operator', () => {
      const op = makeOperator();
      expect(op.id).toBe('op-001');
      expect(op.email).toBe('alice@store.com');
      expect(op.displayName).toBe('Alice');
      expect(op.roleId).toBe('admin');
      expect(op.tenantId).toBe('default-tenant');
      expect(op.isActive).toBe(true);
    });

    it('throws when email is invalid', () => {
      expect(() => makeOperator({ email: 'notanemail' })).toThrow(
        'Operator email must be a valid email address'
      );
    });

    it('throws when displayName is empty', () => {
      expect(() => makeOperator({ displayName: '' })).toThrow('Operator displayName is required');
    });

    it('throws when roleId is empty', () => {
      expect(() => makeOperator({ roleId: '' })).toThrow('Operator roleId is required');
    });

    it('throws when tenantId is empty', () => {
      expect(() => makeOperator({ tenantId: '' })).toThrow('Operator tenantId is required');
    });

    it('throws when passwordHash is empty', () => {
      expect(() => makeOperator({ passwordHash: '' })).toThrow('Operator passwordHash is required');
    });

    it('throws when id is empty (BaseEntity rule)', () => {
      expect(() => new Operator('', 'a@b.com', 'Name', 'admin', 'tenant', '$hash')).toThrow();
    });
  });

  describe('lifecycle', () => {
    it('deactivates an active operator', () => {
      const op = makeOperator();
      op.deactivate('manager-id');
      expect(op.isActive).toBe(false);
    });

    it('activates a deactivated operator', () => {
      const op = makeOperator();
      op.deactivate();
      op.activate();
      expect(op.isActive).toBe(true);
    });
  });

  describe('clone', () => {
    it('returns a new instance with same data', () => {
      const op = makeOperator();
      const cloned = op.clone();
      expect(cloned).not.toBe(op);
      expect(cloned.id).toBe(op.id);
      expect(cloned.email).toBe(op.email);
    });
  });

  describe('toJSON', () => {
    it('does NOT expose passwordHash', () => {
      const json = makeOperator().toJSON();
      expect(json).not.toHaveProperty('passwordHash');
    });

    it('includes email, displayName, roleId, tenantId, isActive', () => {
      const json = makeOperator().toJSON();
      expect(json['email']).toBe('alice@store.com');
      expect(json['displayName']).toBe('Alice');
      expect(json['roleId']).toBe('admin');
      expect(json['tenantId']).toBe('default-tenant');
      expect(json['isActive']).toBe(true);
    });
  });
});
