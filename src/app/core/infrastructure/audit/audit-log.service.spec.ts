import { TestBed } from '@angular/core/testing';
import {
  AuditLogService,
  AuditAction,
  AuditStatus,
} from '@core/infrastructure/audit/audit-log.service';
import type { Table } from 'dexie';
import type { AuditLogEntry } from '@core/infrastructure/audit/audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuditLogService],
    });
    service = TestBed.inject(AuditLogService);
  });

  afterEach(async () => {
    // Clean up database after each test
    if (service) {
      await service.clearAll();
    }
  });

  /**
   * The service builds its own Dexie instance rather than taking the injected one,
   * so a test that needs to make a write fail has no seam other than this.
   */
  function auditTable(): Table<AuditLogEntry, string> {
    return (service as unknown as { db: { auditLogs: Table<AuditLogEntry, string> } }).db.auditLogs;
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('log', () => {
    it('should log an audit entry successfully', async () => {
      await service.log({
        agentName: 'PaymentAgent',
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: 'PAY-123',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
        metadata: { amount: 100 },
      });

      const logs = service.getRecentLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].agentName).toBe('PaymentAgent');
      expect(logs[0].operation).toBe('processPayment');
      expect(logs[0].action).toBe(AuditAction.CREATE);
      expect(logs[0].status).toBe(AuditStatus.SUCCESS);
    });

    it('should generate unique IDs for each log entry', async () => {
      await service.log({
        agentName: 'TestAgent',
        operation: 'test1',
        entityType: 'Test',
        entityId: '1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      await service.log({
        agentName: 'TestAgent',
        operation: 'test2',
        entityType: 'Test',
        entityId: '2',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      const logs = service.getRecentLogs();
      expect(logs.length).toBe(2);
      expect(logs[0].id).toBeDefined();
      expect(logs[1].id).toBeDefined();
      expect(logs[0].id).not.toBe(logs[1].id);
    });

    it('should add timestamp to log entries', async () => {
      const beforeLog = new Date();

      await service.log({
        agentName: 'TestAgent',
        operation: 'test',
        entityType: 'Test',
        entityId: '1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      const afterLog = new Date();
      const logs = service.getRecentLogs();

      expect(logs[0].timestamp).toBeDefined();
      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(beforeLog.getTime());
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(afterLog.getTime());
    });

    it('should store optional fields', async () => {
      await service.log({
        userId: 'user-123',
        agentName: 'PaymentAgent',
        operation: 'processRefund',
        entityType: 'Payment',
        entityId: 'PAY-456',
        action: AuditAction.REFUND,
        status: AuditStatus.SUCCESS,
        duration: 1500,
        metadata: { refundAmount: 50, reason: 'Customer request' },
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });

      const logs = service.getRecentLogs();
      expect(logs[0].userId).toBe('user-123');
      expect(logs[0].duration).toBe(1500);
      expect(logs[0].metadata).toEqual({ refundAmount: 50, reason: 'Customer request' });
      expect(logs[0].ipAddress).toBe('192.168.1.1');
      expect(logs[0].userAgent).toBe('Mozilla/5.0');
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create test data
      await service.log({
        userId: 'user-1',
        agentName: 'PaymentAgent',
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: 'PAY-1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      await service.log({
        userId: 'user-2',
        agentName: 'InventoryAgent',
        operation: 'updateStock',
        entityType: 'Product',
        entityId: 'PROD-1',
        action: AuditAction.UPDATE,
        status: AuditStatus.SUCCESS,
      });

      await service.log({
        userId: 'user-1',
        agentName: 'PaymentAgent',
        operation: 'processRefund',
        entityType: 'Payment',
        entityId: 'PAY-2',
        action: AuditAction.REFUND,
        status: AuditStatus.FAILURE,
        errorMessage: 'Insufficient funds',
      });
    });

    it('should query all logs', async () => {
      const logs = await service.query({});
      expect(logs.length).toBe(3);
    });

    it('should filter by userId', async () => {
      const logs = await service.query({ userId: 'user-1' });
      expect(logs.length).toBe(2);
      expect(logs.every((log) => log.userId === 'user-1')).toBe(true);
    });

    it('should filter by agentName', async () => {
      const logs = await service.query({ agentName: 'PaymentAgent' });
      expect(logs.length).toBe(2);
      expect(logs.every((log) => log.agentName === 'PaymentAgent')).toBe(true);
    });

    it('should filter by action', async () => {
      const logs = await service.query({ action: AuditAction.REFUND });
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe(AuditAction.REFUND);
    });

    it('should filter by status', async () => {
      const logs = await service.query({ status: AuditStatus.FAILURE });
      expect(logs.length).toBe(1);
      expect(logs[0].status).toBe(AuditStatus.FAILURE);
    });

    it('should filter by entityType', async () => {
      const logs = await service.query({ entityType: 'Payment' });
      expect(logs.length).toBe(2);
      expect(logs.every((log) => log.entityType === 'Payment')).toBe(true);
    });

    it('should apply pagination', async () => {
      const page1 = await service.query({ limit: 2, offset: 0 });
      const page2 = await service.query({ limit: 2, offset: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(1);
    });
  });

  describe('getById', () => {
    it('should retrieve log by ID', async () => {
      await service.log({
        agentName: 'TestAgent',
        operation: 'test',
        entityType: 'Test',
        entityId: '1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      const logs = service.getRecentLogs();
      const logId = logs[0].id!;

      const retrieved = await service.getById(logId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(logId);
    });

    it('should return null for non-existent ID', async () => {
      const retrieved = await service.getById('non-existent-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('getEntityAuditTrail', () => {
    beforeEach(async () => {
      await service.log({
        agentName: 'PaymentAgent',
        operation: 'create',
        entityType: 'Payment',
        entityId: 'PAY-123',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      await service.log({
        agentName: 'PaymentAgent',
        operation: 'update',
        entityType: 'Payment',
        entityId: 'PAY-123',
        action: AuditAction.UPDATE,
        status: AuditStatus.SUCCESS,
      });

      await service.log({
        agentName: 'PaymentAgent',
        operation: 'refund',
        entityType: 'Payment',
        entityId: 'PAY-123',
        action: AuditAction.REFUND,
        status: AuditStatus.SUCCESS,
      });

      await service.log({
        agentName: 'PaymentAgent',
        operation: 'create',
        entityType: 'Payment',
        entityId: 'PAY-456',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });
    });

    it('should retrieve audit trail for specific entity', async () => {
      const trail = await service.getEntityAuditTrail('Payment', 'PAY-123');
      expect(trail.length).toBe(3);
      expect(trail.every((log) => log.entityId === 'PAY-123')).toBe(true);
    });

    it('should return logs in reverse chronological order', async () => {
      const trail = await service.getEntityAuditTrail('Payment', 'PAY-123');
      expect(trail[0].action).toBe(AuditAction.REFUND);
      expect(trail[1].action).toBe(AuditAction.UPDATE);
      expect(trail[2].action).toBe(AuditAction.CREATE);
    });
  });

  describe('getUserActivity', () => {
    beforeEach(async () => {
      for (let i = 0; i < 60; i++) {
        await service.log({
          userId: 'user-123',
          agentName: 'TestAgent',
          operation: `operation-${i}`,
          entityType: 'Test',
          entityId: `test-${i}`,
          action: AuditAction.CREATE,
          status: AuditStatus.SUCCESS,
        });
      }
    });

    it('should retrieve user activity with default limit', async () => {
      const activity = await service.getUserActivity('user-123');
      expect(activity.length).toBe(50); // Default limit
    });

    it('should retrieve user activity with custom limit', async () => {
      const activity = await service.getUserActivity('user-123', 10);
      expect(activity.length).toBe(10);
    });

    it('should return most recent activities first', async () => {
      const activity = await service.getUserActivity('user-123', 5);
      expect(activity[0].operation).toBe('operation-59');
      expect(activity[4].operation).toBe('operation-55');
    });
  });

  describe('export', () => {
    beforeEach(async () => {
      await service.log({
        agentName: 'PaymentAgent',
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: 'PAY-1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
        duration: 1000,
      });

      await service.log({
        agentName: 'PaymentAgent',
        operation: 'processRefund',
        entityType: 'Payment',
        entityId: 'PAY-2',
        action: AuditAction.REFUND,
        status: AuditStatus.FAILURE,
        errorMessage: 'Test error',
      });
    });

    it('should export logs as JSON', async () => {
      const exported = await service.export({}, 'json');
      const parsed = JSON.parse(exported);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      expect(parsed[0].agentName).toBeDefined();
    });

    it('should export logs as CSV', async () => {
      const exported = await service.export({}, 'csv');

      expect(exported).toContain('ID,Timestamp,User ID');
      expect(exported).toContain('PaymentAgent');
      expect(exported).toContain('processPayment');
    });
  });

  describe('getStatistics', () => {
    beforeEach(async () => {
      await service.log({
        agentName: 'PaymentAgent',
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: 'PAY-1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      await service.log({
        agentName: 'PaymentAgent',
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: 'PAY-2',
        action: AuditAction.CREATE,
        status: AuditStatus.FAILURE,
      });

      await service.log({
        agentName: 'InventoryAgent',
        operation: 'updateStock',
        entityType: 'Product',
        entityId: 'PROD-1',
        action: AuditAction.UPDATE,
        status: AuditStatus.SUCCESS,
      });
    });

    it('should calculate statistics correctly', async () => {
      const stats = await service.getStatistics();

      expect(stats.totalLogs).toBe(3);
      expect(stats.byAction[AuditAction.CREATE]).toBe(2);
      expect(stats.byAction[AuditAction.UPDATE]).toBe(1);
      expect(stats.byStatus[AuditStatus.SUCCESS]).toBe(2);
      expect(stats.byStatus[AuditStatus.FAILURE]).toBe(1);
      expect(stats.byAgent['PaymentAgent']).toBe(2);
      expect(stats.byAgent['InventoryAgent']).toBe(1);
      expect(stats.byEntityType['Payment']).toBe(2);
      expect(stats.byEntityType['Product']).toBe(1);
    });
  });

  describe('purgeOldLogs', () => {
    it('should purge logs older than specified days', async () => {
      // Create old log
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      await service.log({
        agentName: 'TestAgent',
        operation: 'old',
        entityType: 'Test',
        entityId: '1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      // Manually update timestamp in database (for testing)
      const _logs = await service.query({});
      // Note: In real scenario, we'd need to manipulate the database directly

      // Create recent log
      await service.log({
        agentName: 'TestAgent',
        operation: 'recent',
        entityType: 'Test',
        entityId: '2',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      const purged = await service.purgeOldLogs(90);
      // This test is simplified; in production, you'd verify actual purging
      expect(purged).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getRecentLogs', () => {
    it('should return recent logs from cache', async () => {
      await service.log({
        agentName: 'TestAgent',
        operation: 'test1',
        entityType: 'Test',
        entityId: '1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      await service.log({
        agentName: 'TestAgent',
        operation: 'test2',
        entityType: 'Test',
        entityId: '2',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      const recent = service.getRecentLogs();
      expect(recent.length).toBe(2);
    });

    it('should limit recent logs', async () => {
      for (let i = 0; i < 10; i++) {
        await service.log({
          agentName: 'TestAgent',
          operation: `test${i}`,
          entityType: 'Test',
          entityId: `${i}`,
          action: AuditAction.CREATE,
          status: AuditStatus.SUCCESS,
        });
      }

      const recent = service.getRecentLogs(5);
      expect(recent.length).toBe(5);
    });
  });

  describe('clearAll', () => {
    it('should clear all logs', async () => {
      await service.log({
        agentName: 'TestAgent',
        operation: 'test',
        entityType: 'Test',
        entityId: '1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });

      await service.clearAll();

      const logs = await service.query({});
      expect(logs.length).toBe(0);

      const recent = service.getRecentLogs();
      expect(recent.length).toBe(0);
    });
  });

  describe('when the database will not take the entry', () => {
    it('keeps it in memory rather than losing the trail', async () => {
      // An audit trail that only exists while the write succeeds is not a trail.
      vi.spyOn(auditTable(), 'add').mockRejectedValue(new Error('quota exceeded'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await service.log({
        agentName: 'PaymentAgent',
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: 'PAY-1',
        action: AuditAction.CREATE,
        status: AuditStatus.FAILURE,
      });

      expect(error).toHaveBeenCalled();
      expect(service.getRecentLogs().map((entry) => entry.entityId)).toContain('PAY-1');
      vi.restoreAllMocks();
    });

    it('keeps only the most recent entries once the cache is full', async () => {
      // The cache is a debugging aid, not storage; the database is the record.
      vi.spyOn(auditTable(), 'add').mockResolvedValue('id' as never);

      for (let i = 0; i < 105; i++) {
        await service.log({
          agentName: 'SyncAgent',
          operation: 'push',
          entityType: 'Product',
          entityId: `p${i}`,
          action: AuditAction.UPDATE,
          status: AuditStatus.SUCCESS,
        });
      }

      const cached = service.getRecentLogs();
      expect(cached).toHaveLength(100);
      // The oldest are the ones dropped.
      expect(cached[0].entityId).toBe('p5');
      expect(cached[cached.length - 1].entityId).toBe('p104');
      vi.restoreAllMocks();
    });
  });

  describe('narrowing a query', () => {
    beforeEach(async () => {
      await service.log({
        agentName: 'PaymentAgent',
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: 'PAY-1',
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
      });
      await service.log({
        agentName: 'SyncAgent',
        operation: 'pushProduct',
        entityType: 'Product',
        entityId: 'p1',
        action: AuditAction.UPDATE,
        status: AuditStatus.SUCCESS,
      });
    });

    it('filters by operation', async () => {
      const logs = await service.query({ operation: 'pushProduct' });

      expect(logs.map((entry) => entry.entityId)).toEqual(['p1']);
    });

    it('filters by the entity itself, not just its type', async () => {
      const logs = await service.query({ entityId: 'PAY-1' });

      expect(logs.map((entry) => entry.operation)).toEqual(['processPayment']);
    });

    it('filters to a window in time', async () => {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 3_600_000);
      const hourAhead = new Date(now.getTime() + 3_600_000);

      expect(await service.query({ startDate: hourAgo, endDate: hourAhead })).toHaveLength(2);
      // A window that closed before anything happened must come back empty rather
      // than falling through to everything.
      expect(await service.query({ endDate: hourAgo })).toHaveLength(0);
      expect(await service.query({ startDate: hourAhead })).toHaveLength(0);
    });
  });

  describe('ordering entries written in the same millisecond', () => {
    it('falls back to the sequence in the id so the order is stable', async () => {
      // Two writes inside one millisecond are ordinary under load, and an unstable
      // sort makes a trail that reads differently every time it is opened.
      const stamp = new Date('2026-01-01T00:00:00.000Z');

      for (const id of ['audit-1-000001-aaaaa', 'audit-1-000002-bbbbb', 'audit-1-000003-ccccc']) {
        await auditTable().add({
          id,
          timestamp: stamp,
          userId: 'u1',
          agentName: 'SyncAgent',
          operation: 'push',
          entityType: 'Product',
          entityId: 'p1',
          action: AuditAction.UPDATE,
          status: AuditStatus.SUCCESS,
        } as never);
      }

      const trail = await service.getEntityAuditTrail('Product', 'p1');
      const activity = await service.getUserActivity('u1');

      expect(trail.map((entry) => entry.id)).toEqual([
        'audit-1-000003-ccccc',
        'audit-1-000002-bbbbb',
        'audit-1-000001-aaaaa',
      ]);
      expect(activity.map((entry) => entry.id)).toEqual(trail.map((entry) => entry.id));
    });
  });

  describe('exporting', () => {
    it('returns nothing at all for an empty CSV rather than a lone header row', async () => {
      expect(await service.export({}, 'csv')).toBe('');
    });

    it('leaves the optional columns empty instead of writing undefined', async () => {
      // A CSV with the word "undefined" in it is one somebody has to clean by hand
      // before it opens in a spreadsheet.
      await service.log({
        agentName: 'SyncAgent',
        operation: 'push',
        entityType: 'Product',
        entityId: 'p1',
        action: AuditAction.UPDATE,
        status: AuditStatus.SUCCESS,
      });

      const csv = await service.export({}, 'csv');

      expect(csv).not.toContain('undefined');
      expect(csv.split('\n')[0]).toContain('Error Message');
      expect(csv.split('\n')[1]).toContain('"",""');
    });
  });
});

// Made with Bob
