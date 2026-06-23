import { BaseValueObject } from '@core/domain/value-objects/base.value-object';

/**
 * TenantId Value Object
 *
 * Represents the active tenant identifier. In the current single-tenant
 * phase this resolves to the configured store id. The white-label sprint
 * will introduce per-store custom domains backed by this primitive.
 *
 * Immutable, validated on construction, frozen.
 */
export class TenantId extends BaseValueObject<TenantId> {
  private readonly _value: string;

  constructor(value: string) {
    super();
    this.validateTenantId(value);
    this._value = value.trim();
    this.freeze();
  }

  get value(): string {
    return this._value;
  }

  private validateTenantId(value: string): void {
    if (value === null || value === undefined || typeof value !== 'string') {
      throw new Error('TenantId must be a non-empty string');
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error('TenantId cannot be empty');
    }
    if (trimmed.length > 128) {
      throw new Error('TenantId cannot exceed 128 characters');
    }
    // Allow alphanumeric, hyphens and underscores (slug-safe)
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      throw new Error('TenantId must be alphanumeric with hyphens or underscores only');
    }
  }

  equals(other: TenantId): boolean {
    if (!(other instanceof TenantId)) return false;
    return this._value === other._value;
  }

  toJSON(): string {
    return this._value;
  }

  override toString(): string {
    return this._value;
  }

  static fromJSON(raw: string): TenantId {
    return new TenantId(raw);
  }

  /**
   * The default single-tenant id used until white-label sprint lands.
   */
  static readonly DEFAULT = new TenantId('default-tenant');
}
