import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

/**
 * Audit Action Types
 */
export enum AuditAction {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  EXECUTE = 'EXECUTE',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  VOID = 'VOID',
  REFUND = 'REFUND',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  EXPORT = 'EXPORT',
  IMPORT = 'IMPORT',
}

/**
 * Audit Status
 */
export enum AuditStatus {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
}

/**
 * Audit Change Record
 * Tracks before/after values for UPDATE operations
 */
export interface AuditChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * Audit Log Entry
 * Represents a single audit log entry for tracking critical operations
 */
export interface AuditLogEntry {
  id?: string;
  timestamp: Date;
  userId?: string;
  agentName: string;
  operation: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  status: AuditStatus;
  metadata?: Record<string, unknown>;
  changes?: AuditChange[];
  ipAddress?: string;
  userAgent?: string;
  errorMessage?: string;
  duration?: number; // in milliseconds
}

/**
 * Audit Query Options
 */
export interface AuditQueryOptions {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  agentName?: string;
  operation?: string;
  entityType?: string;
  entityId?: string;
  action?: AuditAction;
  status?: AuditStatus;
  limit?: number;
  offset?: number;
}

/**
 * Audit Database
 * Dexie database for storing audit logs
 */
class AuditDatabase extends Dexie {
  auditLogs!: Table<AuditLogEntry, string>;

  constructor() {
    super('AuditLogDatabase');

    this.version(1).stores({
      auditLogs:
        'id, timestamp, userId, agentName, operation, entityType, entityId, action, status',
    });
  }
}

/**
 * Audit Log Service
 * Provides comprehensive audit logging for critical operations
 *
 * Features:
 * - Persistent storage using Dexie
 * - Flexible querying and filtering
 * - Change tracking for updates
 * - Export capabilities
 * - Compliance support (log purging)
 * - Performance metrics
 */
@Injectable({
  providedIn: 'root',
})
export class AuditLogService {
  private readonly db: AuditDatabase;
  private inMemoryCache: AuditLogEntry[] = [];
  private readonly maxCacheSize = 100;
  private sequenceCounter = 0;

  constructor() {
    this.db = new AuditDatabase();
  }

  /**
   * Log an audit entry
   */
  async log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: new Date(),
    };

    try {
      // Store in database
      await this.db.auditLogs.add(fullEntry);

      // Add to cache
      this.addToCache(fullEntry);

      console.log(
        `[AuditLog] Logged: ${entry.action} on ${entry.entityType}:${entry.entityId} by ${entry.agentName}`,
      );
    } catch (error) {
      console.error('[AuditLog] Failed to log entry:', error);
      // Still add to cache as fallback
      this.addToCache(fullEntry);
    }
  }

  /**
   * Query audit logs with flexible filtering
   */
  async query(options: AuditQueryOptions): Promise<AuditLogEntry[]> {
    let collection = this.db.auditLogs.toCollection();

    // Apply filters
    if (options.startDate) {
      collection = collection.filter((entry) => entry.timestamp >= options.startDate!);
    }
    if (options.endDate) {
      collection = collection.filter((entry) => entry.timestamp <= options.endDate!);
    }
    if (options.userId) {
      collection = collection.filter((entry) => entry.userId === options.userId);
    }
    if (options.agentName) {
      collection = collection.filter((entry) => entry.agentName === options.agentName);
    }
    if (options.operation) {
      collection = collection.filter((entry) => entry.operation === options.operation);
    }
    if (options.entityType) {
      collection = collection.filter((entry) => entry.entityType === options.entityType);
    }
    if (options.entityId) {
      collection = collection.filter((entry) => entry.entityId === options.entityId);
    }
    if (options.action) {
      collection = collection.filter((entry) => entry.action === options.action);
    }
    if (options.status) {
      collection = collection.filter((entry) => entry.status === options.status);
    }

    // Apply pagination
    if (options.offset) {
      collection = collection.offset(options.offset);
    }
    if (options.limit) {
      collection = collection.limit(options.limit);
    }

    return await collection.reverse().sortBy('timestamp');
  }

  /**
   * Get audit log by ID
   */
  async getById(id: string): Promise<AuditLogEntry | null> {
    const entry = await this.db.auditLogs.get(id);
    return entry || null;
  }

  /**
   * Get audit trail for a specific entity
   */
  async getEntityAuditTrail(entityType: string, entityId: string): Promise<AuditLogEntry[]> {
    const results = await this.db.auditLogs
      .where('entityId')
      .equals(entityId)
      .filter((entry) => entry.entityType === entityType)
      .toArray();

    // Sort in reverse chronological order (newest first), use ID as tiebreaker
    return results.sort((a, b) => {
      const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
      if (timeDiff !== 0) return timeDiff;
      // Use ID for stable sort when timestamps are equal (IDs contain sequence numbers)
      return (b.id || '').localeCompare(a.id || '');
    });
  }

  /**
   * Get user activity logs
   */
  async getUserActivity(userId: string, limit = 50): Promise<AuditLogEntry[]> {
    const results = await this.db.auditLogs.where('userId').equals(userId).toArray();

    // Sort in reverse chronological order (newest first), use ID as tiebreaker
    return [...results]
      .sort((a, b) => {
        const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
        if (timeDiff !== 0) return timeDiff;
        return (b.id || '').localeCompare(a.id || '');
      })
      .slice(0, limit);
  }

  /**
   * Get recent logs from cache
   */
  getRecentLogs(limit?: number): AuditLogEntry[] {
    if (limit) {
      return this.inMemoryCache.slice(-limit);
    }
    return [...this.inMemoryCache];
  }

  /**
   * Export audit logs
   */
  async export(options: AuditQueryOptions, format: 'json' | 'csv'): Promise<string> {
    const logs = await this.query(options);

    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    } else {
      return this.convertToCSV(logs);
    }
  }

  /**
   * Purge old audit logs (for compliance)
   */
  async purgeOldLogs(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const oldLogs = await this.db.auditLogs.where('timestamp').below(cutoffDate).toArray();

    await this.db.auditLogs.where('timestamp').below(cutoffDate).delete();

    console.log(`[AuditLog] Purged ${oldLogs.length} logs older than ${olderThanDays} days`);
    return oldLogs.length;
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    totalLogs: number;
    byAction: Record<string, number>;
    byStatus: Record<string, number>;
    byAgent: Record<string, number>;
    byEntityType: Record<string, number>;
  }> {
    const allLogs = await this.db.auditLogs.toArray();

    const byAction: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    const byEntityType: Record<string, number> = {};

    for (const log of allLogs) {
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      byStatus[log.status] = (byStatus[log.status] || 0) + 1;
      byAgent[log.agentName] = (byAgent[log.agentName] || 0) + 1;
      byEntityType[log.entityType] = (byEntityType[log.entityType] || 0) + 1;
    }

    return {
      totalLogs: allLogs.length,
      byAction,
      byStatus,
      byAgent,
      byEntityType,
    };
  }

  /**
   * Clear all audit logs (use with caution!)
   */
  async clearAll(): Promise<void> {
    await this.db.auditLogs.clear();
    this.inMemoryCache = [];
    console.log('[AuditLog] All logs cleared');
  }

  /**
   * Private helper methods
   */

  private addToCache(entry: AuditLogEntry): void {
    this.inMemoryCache.push(entry);

    // Trim cache if it exceeds max size
    if (this.inMemoryCache.length > this.maxCacheSize) {
      this.inMemoryCache = this.inMemoryCache.slice(-this.maxCacheSize);
    }
  }

  private generateId(): string {
    this.sequenceCounter++;
    return `audit-${Date.now()}-${String(this.sequenceCounter).padStart(6, '0')}-${Math.random().toString(36).substr(2, 5)}`;
  }

  private convertToCSV(logs: AuditLogEntry[]): string {
    if (logs.length === 0) {
      return '';
    }

    // CSV headers
    const headers = [
      'ID',
      'Timestamp',
      'User ID',
      'Agent Name',
      'Operation',
      'Entity Type',
      'Entity ID',
      'Action',
      'Status',
      'Duration (ms)',
      'Error Message',
    ];

    // CSV rows
    const rows = logs.map((log) => [
      log.id || '',
      log.timestamp.toISOString(),
      log.userId || '',
      log.agentName,
      log.operation,
      log.entityType,
      log.entityId,
      log.action,
      log.status,
      log.duration?.toString() || '',
      log.errorMessage || '',
    ]);

    // Combine headers and rows
    return [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join(
      '\n',
    );
  }
}

// Made with Bob
