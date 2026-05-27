import { Injectable } from '@angular/core';
import { BaseDexieRepository } from './base-dexie.repository';
import { Customer, CustomerStatus, CustomerTier } from '../../domain/entities/customer.entity';
import { ICustomerRepository } from '../../domain/interfaces/customer.repository.interface';
import { DexieDatabase, ICustomerDB } from '../database/dexie-database.service';

/**
 * Dexie Customer Repository
 * Implements customer-specific operations using Dexie ORM
 */
@Injectable({
  providedIn: 'root'
})
export class DexieCustomerRepository 
  extends BaseDexieRepository<Customer, ICustomerDB> 
  implements ICustomerRepository {

  constructor(private db: DexieDatabase) {
    super(db.customers);
  }

  /**
   * Map database record to Customer entity
   */
  protected mapToEntity(record: ICustomerDB): Customer {
    return new Customer(
      record.id,
      record.name,
      record.email,
      record.phone,
      record.status as CustomerStatus,
      record.loyaltyPoints,
      record.tier as CustomerTier,
      record.createdAt,
      record.updatedAt,
      record.createdBy,
      record.updatedBy,
      record.deletedAt,
      record.deletedBy,
      record.address,
      record.city,
      record.state,
      record.zipCode,
      record.country,
      record.dateOfBirth,
      record.notes
    );
  }

  /**
   * Map Customer entity to database record
   */
  protected mapToDatabase(entity: Customer): ICustomerDB {
    return {
      id: entity.id,
      name: entity.name,
      email: entity.email,
      phone: entity.phone,
      status: entity.status,
      loyaltyPoints: entity.loyaltyPoints,
      tier: entity.tier,
      address: entity.address,
      city: entity.city,
      state: entity.state,
      zipCode: entity.zipCode,
      country: entity.country,
      dateOfBirth: entity.dateOfBirth,
      notes: entity.notes,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
      deletedAt: entity.deletedAt,
      deletedBy: entity.deletedBy
    };
  }

  /**
   * Find customers by status
   */
  async findByStatus(status: CustomerStatus): Promise<Customer[]> {
    return this.findByIndexedField('status', status);
  }

  /**
   * Find customers by tier
   */
  async findByTier(tier: CustomerTier): Promise<Customer[]> {
    return this.findByIndexedField('tier', tier);
  }

  /**
   * Find customers by status and tier (compound index)
   */
  async findByStatusAndTier(status: CustomerStatus, tier: CustomerTier): Promise<Customer[]> {
    return this.findByCompoundIndex(['status', 'tier'], [status, tier]);
  }

  /**
   * Find customer by email
   */
  async findByEmail(email: string): Promise<Customer | null> {
    return this.findOneByIndexedField('email', email);
  }

  /**
   * Find customer by phone
   */
  async findByPhone(phone: string): Promise<Customer | null> {
    return this.findOneByIndexedField('phone', phone);
  }

  /**
   * Search customers by name, email, or phone
   */
  async search(query: string, limit: number = 50): Promise<Customer[]> {
    const lowerQuery = query.toLowerCase();
    
    const records = await this.table
      .filter(record => {
        if (record.deletedAt) return false;
        
        const name = record.name.toLowerCase();
        const email = record.email.toLowerCase();
        const phone = record.phone.toLowerCase();
        
        return name.includes(lowerQuery) || 
               email.includes(lowerQuery) || 
               phone.includes(lowerQuery);
      })
      .limit(limit)
      .toArray();
    
    return records.map(record => this.mapToEntity(record));
  }

  /**
   * Find VIP customers
   */
  async findVIPCustomers(): Promise<Customer[]> {
    return this.findByStatus(CustomerStatus.VIP);
  }

  /**
   * Find active customers
   */
  async findActiveCustomers(): Promise<Customer[]> {
    return this.findByStatus(CustomerStatus.ACTIVE);
  }

  /**
   * Find customers with loyalty points above threshold
   */
  async findByMinLoyaltyPoints(minPoints: number): Promise<Customer[]> {
    const records = await this.table
      .filter(record => {
        if (record.deletedAt) return false;
        return record.loyaltyPoints >= minPoints;
      })
      .toArray();
    
    return records.map(record => this.mapToEntity(record));
  }

  /**
   * Get top customers by loyalty points
   */
  async getTopCustomers(limit: number = 10): Promise<Customer[]> {
    const records = await this.table
      .orderBy('loyaltyPoints')
      .reverse()
      .filter(record => !record.deletedAt)
      .limit(limit)
      .toArray();
    
    return records.map(record => this.mapToEntity(record));
  }

  /**
   * Update customer loyalty points
   */
  async updateLoyaltyPoints(customerId: string, points: number): Promise<Customer> {
    const customer = await this.findById(customerId);
    if (!customer) {
      throw new Error(`Customer with id ${customerId} not found`);
    }

    if (points > 0) {
      customer.addPoints(points);
    } else if (points < 0) {
      customer.redeemPoints(Math.abs(points));
    }
    
    await this.table.update(customerId, {
      loyaltyPoints: customer.loyaltyPoints,
      tier: customer.tier,
      updatedAt: customer.updatedAt
    });

    return customer;
  }

  /**
   * Update customer status
   */
  async updateStatus(customerId: string, status: CustomerStatus): Promise<Customer> {
    const customer = await this.findById(customerId);
    if (!customer) {
      throw new Error(`Customer with id ${customerId} not found`);
    }

    // Use appropriate method based on status
    switch (status) {
      case CustomerStatus.ACTIVE:
        customer.activate();
        break;
      case CustomerStatus.INACTIVE:
        customer.deactivate();
        break;
      case CustomerStatus.BLOCKED:
        customer.block('Status update');
        break;
      case CustomerStatus.VIP:
        customer.promoteToVIP();
        break;
    }
    
    await this.table.update(customerId, {
      status: customer.status,
      updatedAt: customer.updatedAt
    });

    return customer;
  }

  /**
   * Get customer statistics
   */
  async getStatistics(): Promise<{
    total: number;
    active: number;
    vip: number;
    blocked: number;
    byTier: Record<CustomerTier, number>;
  }> {
    const allCustomers = await this.findAll();
    
    const stats = {
      total: allCustomers.length,
      active: allCustomers.filter(c => c.status === CustomerStatus.ACTIVE).length,
      vip: allCustomers.filter(c => c.status === CustomerStatus.VIP).length,
      blocked: allCustomers.filter(c => c.status === CustomerStatus.BLOCKED).length,
      byTier: {
        [CustomerTier.BRONZE]: allCustomers.filter(c => c.tier === CustomerTier.BRONZE).length,
        [CustomerTier.SILVER]: allCustomers.filter(c => c.tier === CustomerTier.SILVER).length,
        [CustomerTier.GOLD]: allCustomers.filter(c => c.tier === CustomerTier.GOLD).length,
        [CustomerTier.PLATINUM]: allCustomers.filter(c => c.tier === CustomerTier.PLATINUM).length
      }
    };
    
    return stats;
  }

  /**
   * Get customers sorted by name
   */
  async findSortedByName(direction: 'asc' | 'desc' = 'asc'): Promise<Customer[]> {
    return this.findSorted('name', direction);
  }

  /**
   * Get customers sorted by loyalty points
   */
  async findSortedByLoyaltyPoints(direction: 'asc' | 'desc' = 'desc'): Promise<Customer[]> {
    return this.findSorted('loyaltyPoints', direction);
  }

  /**
   * Count customers by status
   */
  async countByStatus(status: CustomerStatus): Promise<number> {
    return this.countByField('status', status);
  }

  /**
   * Count customers by tier
   */
  async countByTier(tier: CustomerTier): Promise<number> {
    return this.countByField('tier', tier);
  }
}

// Made with Bob