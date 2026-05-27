import { SoftDeletableEntity } from './base.entity';

/**
 * Customer Status Enum
 */
export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  BLOCKED = 'BLOCKED',
  VIP = 'VIP'
}

/**
 * Customer Tier Enum (for loyalty program)
 */
export enum CustomerTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM'
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
 * Abstract Customer Base Class
 * Provides common customer functionality
 * Implements ILoyaltyProgram interface
 */
export abstract class AbstractCustomer extends SoftDeletableEntity implements ILoyaltyProgram {
  constructor(
    id: string,
    public name: string,
    public email: string,
    public phone: string,
    public status: CustomerStatus = CustomerStatus.ACTIVE,
    public loyaltyPoints: number = 0,
    public tier: CustomerTier = CustomerTier.BRONZE,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    createdBy?: string,
    updatedBy?: string,
    deletedAt?: Date,
    deletedBy?: string
  ) {
    super(id, createdAt, updatedAt, createdBy, updatedBy, deletedAt, deletedBy);
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
  override toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      name: this.name,
      email: this.email,
      phone: this.phone,
      status: this.status,
      loyaltyPoints: this.loyaltyPoints,
      tier: this.tier,
      isActive: this.isActive(),
      isVIP: this.isVIP()
    };
  }
}

/**
 * Customer Entity
 * Concrete implementation of AbstractCustomer
 * Represents a customer in the POS system
 */
export class Customer extends AbstractCustomer {
  constructor(
    id: string,
    name: string,
    email: string,
    phone: string,
    status: CustomerStatus = CustomerStatus.ACTIVE,
    loyaltyPoints: number = 0,
    tier: CustomerTier = CustomerTier.BRONZE,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    createdBy?: string,
    updatedBy?: string,
    deletedAt?: Date,
    deletedBy?: string,
    public address?: string,
    public city?: string,
    public state?: string,
    public zipCode?: string,
    public country: string = 'USA',
    public dateOfBirth?: Date,
    public notes?: string
  ) {
    super(
      id,
      name,
      email,
      phone,
      status,
      loyaltyPoints,
      tier,
      createdAt,
      updatedAt,
      createdBy,
      updatedBy,
      deletedAt,
      deletedBy
    );
    this.validate();
  }

  /**
   * Updates customer profile
   */
  updateProfile(
    name?: string,
    email?: string,
    phone?: string,
    address?: string,
    city?: string,
    state?: string,
    zipCode?: string,
    updatedBy?: string
  ): void {
    if (name !== undefined) this.name = name;
    if (email !== undefined) this.email = email;
    if (phone !== undefined) this.phone = phone;
    if (address !== undefined) this.address = address;
    if (city !== undefined) this.city = city;
    if (state !== undefined) this.state = state;
    if (zipCode !== undefined) this.zipCode = zipCode;
    
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
    return new Customer(
      this.id,
      this.name,
      this.email,
      this.phone,
      this.status,
      this.loyaltyPoints,
      this.tier,
      this.createdAt,
      this.updatedAt,
      this.createdBy,
      this.updatedBy,
      this.deletedAt,
      this.deletedBy,
      this.address,
      this.city,
      this.state,
      this.zipCode,
      this.country,
      this.dateOfBirth,
      this.notes
    );
  }

  /**
   * Converts customer to JSON with additional fields
   */
  override toJSON(): Record<string, any> {
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
      notes: this.notes
    };
  }

  /**
   * Creates customer from plain object
   */
  static fromJSON(data: any): Customer {
    return new Customer(
      data.id,
      data.name,
      data.email,
      data.phone,
      data.status,
      data.loyaltyPoints,
      data.tier,
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.createdBy,
      data.updatedBy,
      data.deletedAt ? new Date(data.deletedAt) : undefined,
      data.deletedBy,
      data.address,
      data.city,
      data.state,
      data.zipCode,
      data.country,
      data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
      data.notes
    );
  }
}

// Made with Bob
