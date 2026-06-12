import { SoftDeletableEntity } from '@core/domain/entities/base.entity';

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
    this.status = props.status ?? CustomerStatus.ACTIVE;
    this.loyaltyPoints = props.loyaltyPoints ?? 0;
    this.tier = props.tier ?? CustomerTier.BRONZE;
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

  constructor(props: CustomerProps) {
    super(props);
    this.address = props.address;
    this.city = props.city;
    this.state = props.state;
    this.zipCode = props.zipCode;
    this.country = props.country ?? 'USA';
    this.dateOfBirth = props.dateOfBirth;
    this.notes = props.notes;
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
    });
  }
}

// Made with Bob
