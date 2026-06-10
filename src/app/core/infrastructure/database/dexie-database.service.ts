import Dexie, { Table } from 'dexie';
import { Injectable } from '@angular/core';

/**
 * Database table interfaces matching our domain entities
 */
export interface IProductDB {
  id: string;
  name: string;
  description?: string;
  sku: string;
  barcode?: string;
  category: string;
  price: number;
  cost: number;
  quantity: number;
  minStockLevel: number;
  maxStockLevel?: number;
  unit: string;
  taxRate: number;
  isActive: boolean;
  imageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

export interface ICustomerDB {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  loyaltyPoints: number;
  tier: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country: string;
  dateOfBirth?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

export interface ITransactionDB {
  id: string;
  customerId?: string;
  items: string; // JSON string of ITransactionItem[]
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  status: string;
  type: string;
  refundedAmount: number;
  paymentIds: string; // JSON string of string[]
  receiptNumber?: string;
  notes?: string;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

export interface ITransactionItemDB {
  id: string;
  transactionId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  subtotal: number;
  total: number;
  createdAt: Date;
}

export interface IPaymentDB {
  id: string;
  orderId: string; // Maps to transactionId in Payment entity
  amount: number;
  method: string;
  status: string;
  currency: string;
  refundedAmount: number;
  completedAt?: Date;
  failureReason?: string;
  transactionId?: string; // Payment gateway transaction ID
  cardLast4?: string;
  cardBrand?: string;
  receiptNumber?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface IStockReservationDB {
  id: string;
  productId: string;
  quantity: number;
  reservedFor: string;
  expiresAt: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface IStockAdjustmentDB {
  id: string;
  productId: string;
  quantityChange: number;
  reason: string;
  notes?: string;
  createdAt: Date;
  createdBy?: string;
}

export interface ILoyaltyTransactionDB {
  id: string;
  customerId: string;
  transactionId?: string;
  points: number;
  type: string;
  description?: string;
  createdAt: Date;
}

export interface IRewardDB {
  id: string;
  name: string;
  description?: string;
  pointsCost: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRewardRedemptionDB {
  id: string;
  customerId: string;
  rewardId: string;
  pointsUsed: number;
  status: string;
  redeemedAt: Date;
  usedAt?: Date;
}

export interface ISyncQueueDB {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  data: string;
  status: string;
  retryCount: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISettingsDB {
  id: string;
  key: string;
  value: string;
  updatedAt: Date;
}

/**
 * Dexie Database Service
 * Provides ORM-like interface for IndexedDB
 * Supports offline-first architecture with automatic indexing
 */
@Injectable({
  providedIn: 'root',
})
export class DexieDatabase extends Dexie {
  // Tables
  products!: Table<IProductDB, string>;
  customers!: Table<ICustomerDB, string>;
  transactions!: Table<ITransactionDB, string>;
  transactionItems!: Table<ITransactionItemDB, string>;
  payments!: Table<IPaymentDB, string>;
  stockReservations!: Table<IStockReservationDB, string>;
  stockAdjustments!: Table<IStockAdjustmentDB, string>;
  loyaltyTransactions!: Table<ILoyaltyTransactionDB, string>;
  rewards!: Table<IRewardDB, string>;
  rewardRedemptions!: Table<IRewardRedemptionDB, string>;
  syncQueue!: Table<ISyncQueueDB, string>;
  settings!: Table<ISettingsDB, string>;

  constructor() {
    super('CapyPOSDB');

    // Define schema version 1
    this.version(1).stores({
      // Products table with indexes
      products: 'id, sku, barcode, category, isActive, [category+isActive], deletedAt',

      // Customers table with indexes
      customers: 'id, email, phone, status, tier, [status+tier], deletedAt',

      // Transactions table with indexes
      transactions: 'id, customerId, status, type, createdAt, completedAt, cancelledAt, deletedAt',

      // Transaction items table with indexes
      transactionItems: 'id, transactionId, productId, [transactionId+productId]',

      // Payments table with indexes
      payments: 'id, orderId, method, status, createdAt, completedAt',

      // Stock reservations table with indexes
      stockReservations: 'id, productId, status, expiresAt, [productId+status]',

      // Stock adjustments table with indexes
      stockAdjustments: 'id, productId, createdAt',

      // Loyalty transactions table with indexes
      loyaltyTransactions: 'id, customerId, transactionId, type, createdAt',

      // Rewards table with indexes
      rewards: 'id, isActive, expiresAt',

      // Reward redemptions table with indexes
      rewardRedemptions: 'id, customerId, rewardId, status, redeemedAt',

      // Sync queue table with indexes
      syncQueue: 'id, entityType, entityId, status, createdAt, [entityType+status]',
    });

    // Version 2: Add settings table for app configuration
    this.version(2).stores({
      settings: 'id, key',
    });

    // Map tables to classes (optional, for better type safety)
    this.products.mapToClass(ProductDBRecord);
    this.customers.mapToClass(CustomerDBRecord);
  }

  /**
   * Initialize database with seed data
   */
  async initializeWithSeedData(): Promise<void> {
    const productCount = await this.products.count();

    if (productCount === 0) {
      // Seed products
      await this.products.bulkAdd([
        {
          id: '1',
          name: 'Coffee',
          description: 'Fresh brewed coffee',
          sku: 'BEV-COF-001',
          barcode: '1234567890123',
          category: 'Beverages',
          price: 2.5,
          cost: 0.8,
          quantity: 150,
          minStockLevel: 30,
          maxStockLevel: 300,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          name: 'Cappuccino',
          description: 'Espresso with steamed milk and foam',
          sku: 'BEV-CAP-001',
          barcode: '1234567890124',
          category: 'Beverages',
          price: 4.5,
          cost: 1.8,
          quantity: 100,
          minStockLevel: 20,
          maxStockLevel: 200,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '3',
          name: 'Croissant',
          description: 'Buttery, flaky pastry',
          sku: 'FOOD-CRO-001',
          barcode: '1234567890125',
          category: 'Food',
          price: 3,
          cost: 1,
          quantity: 50,
          minStockLevel: 10,
          maxStockLevel: 100,
          unit: 'piece',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '4',
          name: 'Latte',
          description: 'Espresso with steamed milk',
          sku: 'BEV-LAT-001',
          barcode: '1234567890126',
          category: 'Beverages',
          price: 4,
          cost: 1,
          quantity: 100,
          minStockLevel: 20,
          maxStockLevel: 200,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '5',
          name: 'Muffin',
          description: 'Freshly baked muffin',
          sku: 'FOOD-MUF-001',
          barcode: '1234567890127',
          category: 'Food',
          price: 2.5,
          cost: 0.8,
          quantity: 30,
          minStockLevel: 10,
          maxStockLevel: 80,
          unit: 'piece',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '6',
          name: 'Seasonal Blend',
          description: 'Limited edition seasonal coffee blend - currently unavailable',
          sku: 'BEV-SEA-001',
          barcode: '1234567890128',
          category: 'Beverages',
          price: 5.5,
          cost: 2.5,
          quantity: 0,
          minStockLevel: 10,
          maxStockLevel: 50,
          unit: 'cup',
          taxRate: 0.08,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Seed rewards
      await this.rewards.bulkAdd([
        {
          id: '1',
          name: 'Free Coffee',
          description: 'Redeem for any regular coffee',
          pointsCost: 100,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          name: '10% Discount',
          description: '10% off your next purchase',
          pointsCost: 200,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '3',
          name: 'Free Pastry',
          description: 'Redeem for any pastry',
          pointsCost: 150,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      console.log('Database initialized with seed data');
    }
  }

  /**
   * Clear all data from database
   */
  async clearAllData(): Promise<void> {
    await this.transaction('rw', this.tables, async () => {
      await Promise.all(this.tables.map((table) => table.clear()));
    });
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};

    for (const table of this.tables) {
      stats[table.name] = await table.count();
    }

    return stats;
  }

  /**
   * Export database to JSON
   */
  async exportToJSON(): Promise<string> {
    const data: Record<string, unknown[]> = {};

    for (const table of this.tables) {
      data[table.name] = await table.toArray();
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * Import database from JSON
   */
  async importFromJSON(jsonData: string): Promise<void> {
    const data = JSON.parse(jsonData);

    await this.transaction('rw', this.tables, async () => {
      for (const tableName in data) {
        const table = (this as unknown as Record<string, Table>)[tableName];
        if (table) {
          await table.clear();
          await table.bulkAdd(data[tableName]);
        }
      }
    });
  }
}

/**
 * Optional: Map database records to classes for better type safety
 */
class ProductDBRecord implements IProductDB {
  id!: string;
  name!: string;
  description?: string;
  sku!: string;
  barcode?: string;
  category!: string;
  price!: number;
  cost!: number;
  quantity!: number;
  minStockLevel!: number;
  maxStockLevel?: number;
  unit!: string;
  taxRate!: number;
  isActive!: boolean;
  imageUrl?: string;
  createdAt!: Date;
  updatedAt!: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

class CustomerDBRecord implements ICustomerDB {
  id!: string;
  name!: string;
  email!: string;
  phone!: string;
  status!: string;
  loyaltyPoints!: number;
  tier!: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country!: string;
  dateOfBirth?: Date;
  notes?: string;
  createdAt!: Date;
  updatedAt!: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: Date;
  deletedBy?: string;
}

// Made with Bob
