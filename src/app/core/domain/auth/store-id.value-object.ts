import { BaseValueObject } from '@core/domain/value-objects/base.value-object';
import { OrgId } from './org-id.value-object';

/**
 * StoreId Value Object
 *
 * Middle layer of the Org → Store → Terminal hierarchy.
 * A Store is a physical or virtual sales location belonging to exactly one Org.
 * Payment credentials (MercadoPago keys, etc.) and geofencing config live here.
 *
 * Composite identity: orgId + storeSlug.
 * Immutable and frozen.
 */
export class StoreId extends BaseValueObject<StoreId> {
  private readonly _orgId: OrgId;
  private readonly _slug: string;

  constructor(orgId: OrgId, slug: string) {
    super();
    if (!(orgId instanceof OrgId)) {
      throw new Error('StoreId requires an OrgId');
    }
    StoreId.validateSlug(slug);
    this._orgId = orgId;
    this._slug = slug.trim();
    this.freeze();
  }

  get orgId(): OrgId {
    return this._orgId;
  }

  get slug(): string {
    return this._slug;
  }

  /** Canonical string representation: `orgId/storeSlug`. */
  get value(): string {
    return `${this._orgId.value}/${this._slug}`;
  }

  private static validateSlug(slug: string): void {
    if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
      throw new Error('StoreId slug must be a non-empty string');
    }
    if (slug.trim().length > 128) {
      throw new Error('StoreId slug cannot exceed 128 characters');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(slug.trim())) {
      throw new Error('StoreId slug must be alphanumeric with hyphens or underscores only');
    }
  }

  equals(other: StoreId): boolean {
    if (!(other instanceof StoreId)) return false;
    return this._orgId.equals(other._orgId) && this._slug === other._slug;
  }

  toJSON(): { orgId: string; storeSlug: string } {
    return { orgId: this._orgId.value, storeSlug: this._slug };
  }

  override toString(): string {
    return this.value;
  }

  static fromJSON(raw: { orgId: string; storeSlug: string }): StoreId {
    return new StoreId(new OrgId(raw.orgId), raw.storeSlug);
  }

  /**
   * Parse from the canonical `orgId/storeSlug` format.
   * Used when a StoreId is stored as a single string (e.g. TenantId interop).
   */
  static parse(composite: string): StoreId {
    const sep = composite.indexOf('/');
    if (sep < 1 || sep === composite.length - 1) {
      throw new Error(`StoreId.parse: expected "orgId/storeSlug", got "${composite}"`);
    }
    return new StoreId(new OrgId(composite.slice(0, sep)), composite.slice(sep + 1));
  }

  /** Default single-store used until multi-store provisioning lands. */
  static readonly DEFAULT = new StoreId(OrgId.DEFAULT, 'default-store');
}
