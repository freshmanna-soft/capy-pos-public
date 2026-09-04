import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateCreate, validateAssignRole } from './admin-validate.ts';

describe('validateCreate', () => {
  it('accepts a well-formed request, lower-casing and trimming the email', () => {
    assert.deepEqual(validateCreate({ email: '  New@Capy.Test  ', roleId: 'role-1' }), {
      email: 'new@capy.test',
      roleId: 'role-1',
    });
  });

  it('refuses a missing or malformed email', () => {
    for (const body of [{ roleId: 'role-1' }, { email: 'not-an-email', roleId: 'role-1' }, { email: 42, roleId: 'role-1' }]) {
      assert.match(validateCreate(body).error, /email/);
    }
  });

  it('refuses a missing or blank roleId', () => {
    for (const body of [{ email: 'a@b.com' }, { email: 'a@b.com', roleId: '' }, { email: 'a@b.com', roleId: '   ' }]) {
      assert.match(validateCreate(body).error, /roleId/);
    }
  });

  it('refuses a non-object body', () => {
    for (const body of [null, 'string', 42, ['a']]) {
      assert.equal(typeof validateCreate(body).error, 'string');
    }
  });
});

describe('validateAssignRole', () => {
  it('accepts a well-formed request', () => {
    assert.deepEqual(validateAssignRole({ roleId: 'role-1' }), { roleId: 'role-1' });
  });

  it('refuses a missing or blank roleId', () => {
    for (const body of [{}, { roleId: '' }, { roleId: 42 }]) {
      assert.match(validateAssignRole(body).error, /roleId/);
    }
  });
});
