import { BaseValueObject } from '@core/domain/value-objects/base.value-object';

/**
 * OrgId Value Object
 *
 * Top level of the Org → Store → Terminal hierarchy.
 * An Org (organisation) owns one or more Stores; billing, branding and
 * top-level admin live at this layer.
 *
 * Validated slug: alphanumeric, hyphens and underscores, max 128 chars.
 * Immutable and frozen.
 */
export class OrgId extends BaseValueObject<OrgId> {
  private readonly _value: string;

  constructor(value: string) {
    super();
    OrgId.validate(value);
    this._value = value.trim();
    this.freeze();
  }

  get value(): string {
    return this._value;
  }

  private static validate(value: string): void {
    if (!value || typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('OrgId must be a non-empty string');
    }
    if (value.trim().length > 128) {
      throw new Error('OrgId cannot exceed 128 characters');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
      throw new Error('OrgId must be alphanumeric with hyphens or underscores only');
    }
  }

  equals(other: OrgId): boolean {
    if (!(other instanceof OrgId)) return false;
    return this._value === other._value;
  }

  toJSON(): string {
    return this._value;
  }

  override toString(): string {
    return this._value;
  }

  static fromJSON(raw: string): OrgId {
    return new OrgId(raw);
  }

  /** Default single-org used until multi-org provisioning lands. */
  static readonly DEFAULT = new OrgId('default-org');
}
