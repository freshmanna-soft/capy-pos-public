import { BaseEntity } from '@core/domain/entities/base.entity';

/**
 * Operator Entity
 *
 * Represents a POS operator (staff member who logs in).
 * passwordHash stores a bcrypt/argon2-style digest — NEVER the plaintext password.
 *
 * Framework-free pure domain object.
 */
export class Operator extends BaseEntity {
  constructor(
    id: string,
    public readonly email: string,
    public displayName: string,
    public readonly roleId: string,
    public readonly tenantId: string,
    public passwordHash: string,
    public isActive = true,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    createdBy?: string,
    updatedBy?: string
  ) {
    super(id, createdAt, updatedAt, createdBy, updatedBy);
    this.validate();
  }

  protected validate(): void {
    if (!this.email || !this.email.includes('@')) {
      throw new Error('Operator email must be a valid email address');
    }
    if (!this.displayName || this.displayName.trim().length === 0) {
      throw new Error('Operator displayName is required');
    }
    if (!this.roleId || this.roleId.trim().length === 0) {
      throw new Error('Operator roleId is required');
    }
    if (!this.tenantId || this.tenantId.trim().length === 0) {
      throw new Error('Operator tenantId is required');
    }
    if (!this.passwordHash || this.passwordHash.trim().length === 0) {
      throw new Error('Operator passwordHash is required');
    }
  }

  deactivate(updatedBy?: string): void {
    this.isActive = false;
    this.touch(updatedBy);
  }

  activate(updatedBy?: string): void {
    this.isActive = true;
    this.touch(updatedBy);
  }

  clone(): Operator {
    return new Operator(
      this.id,
      this.email,
      this.displayName,
      this.roleId,
      this.tenantId,
      this.passwordHash,
      this.isActive,
      new Date(this.createdAt),
      new Date(this.updatedAt),
      this.createdBy,
      this.updatedBy
    );
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      email: this.email,
      displayName: this.displayName,
      roleId: this.roleId,
      tenantId: this.tenantId,
      // passwordHash intentionally excluded from serialisation
      isActive: this.isActive,
    };
  }
}
