import { BaseValueObject } from '@core/domain/value-objects/base.value-object';
import { StoreId } from './store-id.value-object';

/**
 * TerminalMode
 *
 * The operating mode of a physical or virtual terminal.
 * - `operator` : a staff-attended POS lane (full checkout, staff auth required)
 * - `kiosk`    : an unattended self-checkout station (customer-facing,
 *                MercadoPago / PayPal only, no cash/card entry)
 */
export const TerminalMode = {
  OPERATOR: 'operator',
  KIOSK: 'kiosk',
} as const;

export type TerminalMode = (typeof TerminalMode)[keyof typeof TerminalMode];

/**
 * TerminalId Value Object
 *
 * Leaf node of the Org → Store → Terminal hierarchy.
 * A Terminal is a single POS device or browser session.
 * The `mode` field drives which payment methods the checkout presents:
 *  - `kiosk`    → only MercadoPago / PayPal
 *  - `operator` → all methods (cash, card, mobile, MP, PayPal)
 *
 * Composite identity: storeId + terminalSlug.
 * Immutable and frozen.
 */
export class TerminalId extends BaseValueObject<TerminalId> {
  private readonly _storeId: StoreId;
  private readonly _slug: string;
  private readonly _mode: TerminalMode;

  constructor(storeId: StoreId, slug: string, mode: TerminalMode = TerminalMode.OPERATOR) {
    super();
    if (!(storeId instanceof StoreId)) {
      throw new Error('TerminalId requires a StoreId');
    }
    TerminalId.validateSlug(slug);
    if (!Object.values(TerminalMode).includes(mode)) {
      throw new Error(`TerminalId mode must be one of: ${Object.values(TerminalMode).join(', ')}`);
    }
    this._storeId = storeId;
    this._slug = slug.trim();
    this._mode = mode;
    this.freeze();
  }

  get storeId(): StoreId {
    return this._storeId;
  }

  get slug(): string {
    return this._slug;
  }

  get mode(): TerminalMode {
    return this._mode;
  }

  /** True when this terminal is in kiosk (unattended) mode. */
  get isKiosk(): boolean {
    return this._mode === TerminalMode.KIOSK;
  }

  /** True when this terminal is in operator (staff-attended) mode. */
  get isOperator(): boolean {
    return this._mode === TerminalMode.OPERATOR;
  }

  /** Canonical string: `orgId/storeSlug/terminalSlug`. */
  get value(): string {
    return `${this._storeId.value}/${this._slug}`;
  }

  private static validateSlug(slug: string): void {
    if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
      throw new Error('TerminalId slug must be a non-empty string');
    }
    if (slug.trim().length > 128) {
      throw new Error('TerminalId slug cannot exceed 128 characters');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(slug.trim())) {
      throw new Error('TerminalId slug must be alphanumeric with hyphens or underscores only');
    }
  }

  equals(other: TerminalId): boolean {
    if (!(other instanceof TerminalId)) return false;
    return this._storeId.equals(other._storeId) && this._slug === other._slug;
  }

  toJSON(): { orgId: string; storeSlug: string; terminalSlug: string; mode: TerminalMode } {
    return {
      orgId: this._storeId.orgId.value,
      storeSlug: this._storeId.slug,
      terminalSlug: this._slug,
      mode: this._mode,
    };
  }

  override toString(): string {
    return `${this.value} [${this._mode}]`;
  }

  static fromJSON(raw: {
    orgId: string;
    storeSlug: string;
    terminalSlug: string;
    mode?: TerminalMode;
  }): TerminalId {
    return new TerminalId(
      StoreId.fromJSON({ orgId: raw.orgId, storeSlug: raw.storeSlug }),
      raw.terminalSlug,
      raw.mode ?? TerminalMode.OPERATOR
    );
  }

  /** Default single-terminal (operator mode) used until provisioning lands. */
  static readonly DEFAULT = new TerminalId(
    StoreId.DEFAULT,
    'default-terminal',
    TerminalMode.OPERATOR
  );

  /** Default kiosk terminal. */
  static readonly DEFAULT_KIOSK = new TerminalId(StoreId.DEFAULT, 'kiosk-1', TerminalMode.KIOSK);
}
