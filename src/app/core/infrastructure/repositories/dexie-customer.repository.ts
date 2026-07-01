import { Injectable, inject } from '@angular/core';
import { BaseDexieRepository } from '@core/infrastructure/repositories/base-dexie.repository';
import { Customer, CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';
import { CustomerBuilder } from '@core/domain/entities/customer.builder';
import { ICustomerRepository } from '@core/domain/interfaces/customer.repository.interface';
import { DexieDatabase, ICustomerDB } from '@core/infrastructure/database/dexie-database.service';

/**
 * Dexie Customer Repository
 * Implements customer-specific operations using Dexie ORM
 */
@Injectable({
  providedIn: 'root',
})
export class DexieCustomerRepository
  extends BaseDexieRepository<Customer, ICustomerDB>
  implements ICustomerRepository
{
  private readonly db: DexieDatabase;

  constructor() {
    const db = inject(DexieDatabase);

    super(db.customers);

    this.db = db;
  }

  /**
   * Map database record to Customer entity
   */
  protected mapToEntity(record: ICustomerDB): Customer {
    const builder = new CustomerBuilder()
      .withId(record.id)
      .withName(record.name)
      .withEmail(record.email)
      .withPhone(record.phone)
      .withStatus(record.status as CustomerStatus)
      .withLoyaltyPoints(record.loyaltyPoints)
      .withTier(record.tier as CustomerTier)
      .withCreatedAt(record.createdAt)
      .withUpdatedAt(record.updatedAt)
      .withCountry(record.country ?? 'USA');

    if (record.createdBy) builder.withCreatedBy(record.createdBy);
    if (record.updatedBy) builder.withUpdatedBy(record.updatedBy);
    if (record.deletedAt) builder.withDeletedAt(record.deletedAt);
    if (record.deletedBy) builder.withDeletedBy(record.deletedBy);
    if (record.address) builder.withAddress(record.address);
    if (record.city) builder.withCity(record.city);
    if (record.state) builder.withState(record.state);
    if (record.zipCode) builder.withZipCode(record.zipCode);
    if (record.dateOfBirth) builder.withDateOfBirth(record.dateOfBirth);
    if (record.notes) builder.withNotes(record.notes);

    return builder.build();
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
      deletedBy: entity.deletedBy,
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
  async search(query: string, limit = 50): Promise<Customer[]> {
    const lowerQuery = query.toLowerCase();

    const records = await this.table
      .filter((record) => {
        if (record.deletedAt) return false;

        const name = record.name.toLowerCase();
        const email = record.email.toLowerCase();
        const phone = record.phone.toLowerCase();

        return (
          name.includes(lowerQuery) || email.includes(lowerQuery) || phone.includes(lowerQuery)
        );
      })
      .limit(limit)
      .toArray();

    return this.mapRecords(records);
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
      .filter((record) => {
        if (record.deletedAt) return false;
        return record.loyaltyPoints >= minPoints;
      })
      .toArray();

    return this.mapRecords(records);
  }

  /**
   * Get top customers by loyalty points.
   *
   * `loyaltyPoints` is not a Dexie index (see the customers store definition),
   * so ordering happens in memory rather than via `orderBy('loyaltyPoints')`,
   * which would throw a SchemaError. Records are mapped through the resilient
   * mapper first so a single corrupt record can't crash the whole list.
   */
  async getTopCustomers(limit = 10): Promise<Customer[]> {
    const records = await this.table.filter((record) => !record.deletedAt).toArray();

    return this.mapRecords(records)
      .sort((a, b) => b.loyaltyPoints - a.loyaltyPoints)
      .slice(0, limit);
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
      updatedAt: customer.updatedAt,
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
      updatedAt: customer.updatedAt,
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

    return {
      total: allCustomers.length,
      active: allCustomers.filter((c) => c.status === CustomerStatus.ACTIVE).length,
      vip: allCustomers.filter((c) => c.status === CustomerStatus.VIP).length,
      blocked: allCustomers.filter((c) => c.status === CustomerStatus.BLOCKED).length,
      byTier: {
        [CustomerTier.BRONZE]: allCustomers.filter((c) => c.tier === CustomerTier.BRONZE).length,
        [CustomerTier.SILVER]: allCustomers.filter((c) => c.tier === CustomerTier.SILVER).length,
        [CustomerTier.GOLD]: allCustomers.filter((c) => c.tier === CustomerTier.GOLD).length,
        [CustomerTier.PLATINUM]: allCustomers.filter((c) => c.tier === CustomerTier.PLATINUM)
          .length,
      },
    };
  }

  /**
   * Get customers sorted by name.
   *
   * `name` is not a Dexie index (see the customers store definition), so the
   * inherited `findSorted` — which calls `orderBy('name')` — would throw a
   * SchemaError. Sort in memory instead, mapping through the resilient mapper
   * first so a single corrupt record can't crash the list (mirrors getTopCustomers).
   */
  async findSortedByName(direction: 'asc' | 'desc' = 'asc'): Promise<Customer[]> {
    const records = await this.table.filter((record) => !record.deletedAt).toArray();
    const sorted = this.mapRecords(records).sort((a, b) => a.name.localeCompare(b.name));
    return direction === 'desc' ? sorted.reverse() : sorted;
  }

  /**
   * Get customers sorted by loyalty points.
   *
   * `loyaltyPoints` is not a Dexie index, so ordering happens in memory (see the
   * note on getTopCustomers) rather than via `orderBy`, which would throw a
   * SchemaError. Records pass through the resilient mapper first.
   */
  async findSortedByLoyaltyPoints(direction: 'asc' | 'desc' = 'desc'): Promise<Customer[]> {
    const records = await this.table.filter((record) => !record.deletedAt).toArray();
    const sorted = this.mapRecords(records).sort((a, b) => a.loyaltyPoints - b.loyaltyPoints);
    return direction === 'desc' ? sorted.reverse() : sorted;
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
