import { SoftDeletableEntity } from '@core/domain/entities/base.entity';
import { isLoyaltyCode, normalizeLoyaltyCode } from '@core/domain/utils/loyalty-code';

/**
 * Customer Status Enum
 */
export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  BLOCKED = 'BLOCKED',
  VIP = 'VIP',
}

/**
 * Customer Tier Enum (for loyalty program)
 */
export enum CustomerTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
}

/*
 * ---------------------------------------------------------------------------
 * Guards for the two enum-typed fields that arrive unvalidated
 * ---------------------------------------------------------------------------
 *
 * `status` and `tier` are the same hazard twice. Both are declared as enums on
 * this entity and stored as bare strings (`ICustomerDB.status`, `ICustomerDB.tier`
 * are `string`), so nothing between the database and here enforces the declared
 * type: a bad sync or the capy-pos-demo failure-injection mode can leave any
 * string — or no string — in either column.
 *
 * Both are therefore coerced in one place, the constructor below, which every
 * construction path runs through (`fromJSON`, `CustomerBuilder`, the Dexie mapper,
 * `clone`). Guarding at some readers and not others is worse than not guarding at
 * all, because the same customer then reads two different ways depending on who is
 * asking — the till pricing a sale at one rung while the screen badges another.
 * Guarded once here, every reader downstream may trust the declared type instead
 * of re-guarding it.
 *
 * Neither throws. A corrupt field should cost the customer their standing or their
 * multiplier, not their sale.
 */

/** The standings as plain strings, for membership tests. */
const CUSTOMER_STATUS_VALUES: readonly string[] = Object.values(CustomerStatus);

/** The rungs of the ladder as plain strings, for membership tests. */
const CUSTOMER_TIER_VALUES: readonly string[] = Object.values(CustomerTier);

/**
 * Snaps a stored status onto one of ours.
 *
 * Absent and corrupt are answered differently, because they are different facts.
 * `undefined` and `null` both mean no standing was ever stored — an ordinary
 * customer, ACTIVE, as this field has always defaulted (it is optional on the
 * props, and most call sites omit it). This mirrors `normalizeCode` at the foot of
 * this file, which reads both as "no card".
 *
 * Anything else is a value we cannot read, and falls back to INACTIVE
 * rather than ACTIVE: a standing we do not recognise must not hand out the one
 * that carries privileges. The customer still earns points and still completes
 * their sale — INACTIVE gates neither — they simply do not read as active or VIP
 * off the back of a corrupt byte.
 *
 * The direction that matters is a mis-cased or unknown BLOCKED. Cast straight onto
 * the enum it would slip past the BLOCKED check in `AwardLoyaltyPointsUseCase` and
 * award points on a blocked account; coerced, it lands somewhere that grants
 * nothing.
 *
 * @param value - Whatever the stored record actually holds
 * @returns The matching standing, ACTIVE when none was stored, INACTIVE otherwise
 */
export function toCustomerStatus(value: unknown): CustomerStatus {
  if (value === undefined || value === null) {
    return CustomerStatus.ACTIVE;
  }
  return typeof value === 'string' && CUSTOMER_STATUS_VALUES.includes(value)
    ? (value as CustomerStatus)
    : CustomerStatus.INACTIVE;
}

/**
 * Snaps a stored tier onto the ladder.
 *
 * Falls back to BRONZE for both absent and unrecognised, which collapses the two
 * cases `toCustomerStatus` has to separate: BRONZE is at once the documented
 * default for a customer with no tier and the rung that carries no bonus, so a
 * corrupt tier costs the customer their multiplier and nothing else.
 *
 * @param value - Whatever the stored record actually holds
 * @returns The matching rung, or BRONZE for anything unrecognised
 */
export function toCustomerTier(value: unknown): CustomerTier {
  return typeof value === 'string' && CUSTOMER_TIER_VALUES.includes(value)
    ? (value as CustomerTier)
    : CustomerTier.BRONZE;
}

/**
 * Loyalty Program Interface
 */
export interface ILoyaltyProgram {
  loyaltyPoints: number;
  tier: CustomerTier;
  addPoints(points: number, updatedBy?: string): void;
  redeemPoints(points: number, updatedBy?: string): void;
  calculateTier(): CustomerTier;
}

/**
 * Base properties for AbstractCustomer construction
 */
export interface AbstractCustomerProps {
  id: string;
  name: string;
  email: string;
  phone: string;
  status?: CustomerStatus;
  loyaltyPoints?: number;
  tier?: CustomerTier;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

/**
 * Extended properties for Customer construction
 */
export interface CustomerProps extends AbstractCustomerProps {
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  dateOfBirth?: Date;
  notes?: string;
  /**
   * The code on this customer's loyalty card, or undefined for a customer who has
   * never been issued one.
   *
   * Optional rather than required because the shop existed before the cards did:
   * every pre-#176 customer has no code, and demanding one would make the whole
   * table unreadable. A card is issued on request — see `generateLoyaltyCode`.
   */
  loyaltyCode?: string;
}

/**
 * Abstract Customer Base Class
 * Provides common customer functionality
 * Implements ILoyaltyProgram interface
 */
export abstract class AbstractCustomer extends SoftDeletableEntity implements ILoyaltyProgram {
  public name: string;
  public email: string;
  public phone: string;
  public status: CustomerStatus;
  public loyaltyPoints: number;
  public tier: CustomerTier;

  constructor(props: AbstractCustomerProps) {
    super(
      props.id,
      props.createdAt ?? new Date(),
      props.updatedAt ?? new Date(),
      props.createdBy,
      props.updatedBy,
      props.deletedAt,
      props.deletedBy
    );
    this.name = props.name;
    this.email = props.email;
    this.phone = props.phone;
    // Both coerced rather than defaulted, so the declared enum types of these two
    // fields are true for every construction path — including a Dexie record whose
    // stored status or tier is an arbitrary string. See the guards above.
    this.status = toCustomerStatus(props.status);
    this.loyaltyPoints = props.loyaltyPoints ?? 0;
    this.tier = toCustomerTier(props.tier);
  }

  /**
   * Validates customer data
   */
  protected validate(): void {
    if (!this.name || this.name.trim() === '') {
      throw new Error('Customer name is required');
    }
    if (!this.email || !this.isValidEmail(this.email)) {
      throw new Error('Valid email is required');
    }
    if (!this.phone || !this.isValidPhone(this.phone)) {
      throw new Error('Valid phone number is required');
    }
    if (this.loyaltyPoints < 0) {
      throw new Error('Loyalty points cannot be negative');
    }
  }

  /**
   * Validates email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validates phone format (basic validation)
   */
  private isValidPhone(phone: string): boolean {
    const phoneRegex = /^\+?[\d\s\-()]{10,}$/;
    return phoneRegex.test(phone);
  }

  /**
   * Adds loyalty points
   * Implements ILoyaltyProgram interface
   */
  addPoints(points: number, updatedBy?: string): void {
    if (points <= 0) {
      throw new Error('Points to add must be greater than 0');
    }
    if (this.status === CustomerStatus.BLOCKED) {
      throw new Error('Cannot add points to blocked customer');
    }

    this.loyaltyPoints += points;
    this.tier = this.calculateTier();
    this.touch(updatedBy);
  }

  /**
   * Redeems loyalty points
   * Implements ILoyaltyProgram interface
   */
  redeemPoints(points: number, updatedBy?: string): void {
    if (points <= 0) {
      throw new Error('Points to redeem must be greater than 0');
    }
    if (this.loyaltyPoints < points) {
      throw new Error('Insufficient loyalty points');
    }
    if (this.status === CustomerStatus.BLOCKED) {
      throw new Error('Cannot redeem points for blocked customer');
    }

    this.loyaltyPoints -= points;
    this.tier = this.calculateTier();
    this.touch(updatedBy);
  }

  /**
   * Calculates customer tier based on loyalty points
   * Implements ILoyaltyProgram interface
   */
  calculateTier(): CustomerTier {
    if (this.loyaltyPoints >= 10000) return CustomerTier.PLATINUM;
    if (this.loyaltyPoints >= 5000) return CustomerTier.GOLD;
    if (this.loyaltyPoints >= 1000) return CustomerTier.SILVER;
    return CustomerTier.BRONZE;
  }

  /**
   * Activates customer account
   */
  activate(updatedBy?: string): void {
    if (this.status === CustomerStatus.ACTIVE) {
      throw new Error('Customer is already active');
    }
    this.status = CustomerStatus.ACTIVE;
    this.touch(updatedBy);
  }

  /**
   * Deactivates customer account
   */
  deactivate(updatedBy?: string): void {
    if (this.status === CustomerStatus.INACTIVE) {
      throw new Error('Customer is already inactive');
    }
    this.status = CustomerStatus.INACTIVE;
    this.touch(updatedBy);
  }

  /**
   * Blocks customer account
   */
  block(reason: string, updatedBy?: string): void {
    if (this.status === CustomerStatus.BLOCKED) {
      throw new Error('Customer is already blocked');
    }
    this.status = CustomerStatus.BLOCKED;
    this.touch(updatedBy);
  }

  /**
   * Promotes customer to VIP status
   */
  promoteToVIP(updatedBy?: string): void {
    if (this.status === CustomerStatus.VIP) {
      throw new Error('Customer is already VIP');
    }
    this.status = CustomerStatus.VIP;
    this.touch(updatedBy);
  }

  /**
   * Checks if customer is active
   */
  isActive(): boolean {
    return this.status === CustomerStatus.ACTIVE || this.status === CustomerStatus.VIP;
  }

  /**
   * Checks if customer is VIP
   */
  isVIP(): boolean {
    return this.status === CustomerStatus.VIP;
  }

  /**
   * Checks if customer is blocked
   */
  isBlocked(): boolean {
    return this.status === CustomerStatus.BLOCKED;
  }

  /**
   * The part of the name the clerk is allowed to say out loud.
   *
   * On the entity rather than in the greeting, because it is a rule about the data
   * and not about one screen: a queue within earshot of the till hears everything
   * she says, and "Marco" identifies a customer to themselves while "Marco Rossi,
   * four thousand points" identifies them to the six people behind them. Anything
   * that needs the whole name still has `name` — the captions do.
   *
   * Falls back to the whole name for a single-word name, and to the empty string
   * only if validation has been bypassed.
   */
  getFirstName(): string {
    return this.name.trim().split(/\s+/)[0] ?? '';
  }

  /**
   * Converts customer to JSON
   */
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      name: this.name,
      email: this.email,
      phone: this.phone,
      status: this.status,
      loyaltyPoints: this.loyaltyPoints,
      tier: this.tier,
      isActive: this.isActive(),
      isVIP: this.isVIP(),
    };
  }
}

/**
 * Customer Entity
 * Concrete implementation of AbstractCustomer
 * Represents a customer in the POS system
 */
export class Customer extends AbstractCustomer {
  public address?: string;
  public city?: string;
  public state?: string;
  public zipCode?: string;
  public country: string;
  public dateOfBirth?: Date;
  public notes?: string;
  /** Normalized on the way in, so the stored form is the form lookups compare. */
  public loyaltyCode?: string;

  constructor(props: CustomerProps) {
    super(props);
    this.address = props.address;
    this.city = props.city;
    this.state = props.state;
    this.zipCode = props.zipCode;
    this.country = props.country ?? 'USA';
    this.dateOfBirth = props.dateOfBirth;
    this.notes = props.notes;
    this.loyaltyCode = normalizeCode(props.loyaltyCode);
    this.validate();
  }

  /**
   * Updates customer profile
   */
  updateProfile(
    profileData: {
      name?: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      zipCode?: string;
    },
    updatedBy?: string
  ): void {
    if (profileData.name !== undefined) this.name = profileData.name;
    if (profileData.email !== undefined) this.email = profileData.email;
    if (profileData.phone !== undefined) this.phone = profileData.phone;
    if (profileData.address !== undefined) this.address = profileData.address;
    if (profileData.city !== undefined) this.city = profileData.city;
    if (profileData.state !== undefined) this.state = profileData.state;
    if (profileData.zipCode !== undefined) this.zipCode = profileData.zipCode;

    this.validate();
    this.touch(updatedBy);
  }

  /**
   * Gets customer's full address
   */
  getFullAddress(): string | undefined {
    if (!this.address) return undefined;

    const parts = [this.address];
    if (this.city) parts.push(this.city);
    if (this.state) parts.push(this.state);
    if (this.zipCode) parts.push(this.zipCode);
    if (this.country) parts.push(this.country);

    return parts.join(', ');
  }

  /**
   * Gets customer's age from date of birth
   */
  getCustomerAge(): number | undefined {
    if (!this.dateOfBirth) return undefined;

    const today = new Date();
    const birthDate = new Date(this.dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  }

  /**
   * Creates a copy of the customer
   */
  override clone(): Customer {
    return new Customer({
      id: this.id,
      name: this.name,
      email: this.email,
      phone: this.phone,
      status: this.status,
      loyaltyPoints: this.loyaltyPoints,
      tier: this.tier,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
      deletedAt: this.deletedAt,
      deletedBy: this.deletedBy,
      address: this.address,
      city: this.city,
      state: this.state,
      zipCode: this.zipCode,
      country: this.country,
      dateOfBirth: this.dateOfBirth,
      notes: this.notes,
      loyaltyCode: this.loyaltyCode,
    });
  }

  /**
   * Converts customer to JSON with additional fields
   */
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      address: this.address,
      city: this.city,
      state: this.state,
      zipCode: this.zipCode,
      country: this.country,
      fullAddress: this.getFullAddress(),
      dateOfBirth: this.dateOfBirth?.toISOString(),
      age: this.getCustomerAge(),
      notes: this.notes,
      loyaltyCode: this.loyaltyCode,
    };
  }

  /**
   * Creates customer from plain object
   */
  static fromJSON(data: Record<string, unknown>): Customer {
    return new Customer({
      id: data['id'] as string,
      name: data['name'] as string,
      email: data['email'] as string,
      phone: data['phone'] as string,
      // Both casts are claims about the record rather than guarantees — a synced or
      // round-tripped row can hold any string here. The constructor coerces both.
      status: data['status'] as CustomerStatus | undefined,
      loyaltyPoints: data['loyaltyPoints'] as number | undefined,
      tier: data['tier'] as CustomerTier | undefined,
      createdAt: data['createdAt'] ? new Date(data['createdAt'] as string) : undefined,
      updatedAt: data['updatedAt'] ? new Date(data['updatedAt'] as string) : undefined,
      createdBy: data['createdBy'] as string | undefined,
      updatedBy: data['updatedBy'] as string | undefined,
      deletedAt: data['deletedAt'] ? new Date(data['deletedAt'] as string) : undefined,
      deletedBy: data['deletedBy'] as string | undefined,
      address: data['address'] as string | undefined,
      city: data['city'] as string | undefined,
      state: data['state'] as string | undefined,
      zipCode: data['zipCode'] as string | undefined,
      country: data['country'] as string | undefined,
      dateOfBirth: data['dateOfBirth'] ? new Date(data['dateOfBirth'] as string) : undefined,
      notes: data['notes'] as string | undefined,
      // The cast is a claim about the record, not a guarantee — a stored `null`
      // satisfies the compiler here and still arrives at runtime, which is why
      // `normalizeCode` validates rather than trusts it.
      loyaltyCode: data['loyaltyCode'] as string | undefined,
    });
  }
}

/**
 * Normalize a code on the way onto the entity, refusing a malformed one.
 *
 * Thrown rather than dropped, and this is the deliberate part: a code silently
 * discarded leaves a customer holding a printed card that will never be
 * recognised, with nothing anywhere saying why. A code that is *absent* is a
 * perfectly ordinary customer, so it passes straight through.
 *
 * Takes `unknown` rather than `string | undefined` because the static type is not
 * true at the boundary. `fromJSON` reads a record Dexie handed back and casts the
 * field on the way in, and a row that has been through a JSON round-trip, an
 * import, or a sync payload can carry an explicit `null` where TypeScript was
 * promised a string. Trusting the cast here meant `raw.trim()` threw
 * `TypeError: raw.trim is not a function` and took the whole customer list down
 * with it, which is a much worse outcome than the one bad field deserved.
 *
 * `null` and `undefined` both mean "no card": a customer predating #176 has no
 * value to read either way. Anything else non-string is a malformed code and is
 * refused like a malformed string, so a number or an object cannot become a card
 * nobody can scan.
 */
function normalizeCode(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new Error(`Invalid loyalty code: ${String(raw)}`);
  }
  if (raw.trim() === '') {
    return undefined;
  }
  if (!isLoyaltyCode(raw)) {
    throw new Error(`Invalid loyalty code: ${raw}`);
  }
  return normalizeLoyaltyCode(raw);
}

// Made with Bob
