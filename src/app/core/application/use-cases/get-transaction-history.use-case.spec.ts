import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import { GetTransactionHistoryUseCase } from './get-transaction-history.use-case';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@core/domain/entities/transaction.entity';
import { TransactionBuilder } from '@core/domain/entities/transaction.builder';

/**
 * GetTransactionHistoryUseCase Unit Tests
 *
 * Tests the application layer use case responsible for
 * retrieving paginated transaction history from the repository.
 *
 * TDD: RED → GREEN → REFACTOR
 */
describe('GetTransactionHistoryUseCase', () => {
  let useCase: GetTransactionHistoryUseCase;
  let mockRepository: Record<string, Mock>;

  const createMockTransaction = (
    overrides: Partial<{
      id: string;
      total: number;
      status: TransactionStatus;
      createdAt: Date;
      paymentIds: string[];
      items: {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
        subtotal: number;
      }[];
      receiptNumber: string;
    }> = {}
  ): Transaction => {
    const builder = new TransactionBuilder()
      .withId(overrides.id ?? `TXN-${Math.random().toString(36).slice(2)}`)
      .withItems(
        overrides.items ?? [
          { productId: 'P1', productName: 'Product 1', quantity: 2, unitPrice: 10, subtotal: 20 },
          { productId: 'P2', productName: 'Product 2', quantity: 1, unitPrice: 15, subtotal: 15 },
        ]
      )
      .withSubtotal(overrides.total ?? 35)
      .withTaxRate(0.08)
      .withTaxAmount((overrides.total ?? 35) * 0.08)
      .withTotal(overrides.total ?? 35)
      .withStatus(overrides.status ?? TransactionStatus.COMPLETED)
      .withType(TransactionType.SALE)
      .withCreatedAt(overrides.createdAt ?? new Date('2026-06-09T10:00:00Z'))
      .withUpdatedAt(overrides.createdAt ?? new Date('2026-06-09T10:00:00Z'))
      .withPaymentIds(overrides.paymentIds ?? []);

    if (overrides.receiptNumber) {
      builder.withReceiptNumber(overrides.receiptNumber);
    }

    return builder.build();
  };

  beforeEach(() => {
    mockRepository = {
      findCompleted: vi.fn().mockResolvedValue([]),
      findByDateRange: vi.fn().mockResolvedValue([]),
      findByStatus: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      count: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        GetTransactionHistoryUseCase,
        { provide: 'ITransactionRepository' as never, useValue: mockRepository },
      ],
    });

    useCase = TestBed.inject(GetTransactionHistoryUseCase);
  });

  describe('execute', () => {
    it('should return empty result when no transactions exist', async () => {
      mockRepository['findCompleted'].mockResolvedValue([]);

      const result = await useCase.execute({ page: 1, pageSize: 20 });

      expect(result.transactions).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(0);
    });

    it('should fetch completed transactions by default', async () => {
      const transactions = [
        createMockTransaction({ id: 'TXN-1', total: 50 }),
        createMockTransaction({ id: 'TXN-2', total: 75 }),
      ];
      mockRepository['findCompleted'].mockResolvedValue(transactions);

      const result = await useCase.execute({ page: 1, pageSize: 20 });

      expect(mockRepository['findCompleted']).toHaveBeenCalled();
      expect(result.transactions).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should map transaction to summary DTO correctly', async () => {
      const transaction = createMockTransaction({
        id: 'TXN-CASH-001',
        total: 42.5,
        status: TransactionStatus.COMPLETED,
        createdAt: new Date('2026-06-09T14:30:00Z'),
        paymentIds: ['PAY-CASH-001'],
        items: [
          { productId: 'P1', productName: 'Coffee', quantity: 2, unitPrice: 5, subtotal: 10 },
          { productId: 'P2', productName: 'Muffin', quantity: 1, unitPrice: 3.5, subtotal: 3.5 },
        ],
        receiptNumber: 'REC-001',
      });
      mockRepository['findCompleted'].mockResolvedValue([transaction]);

      const result = await useCase.execute({ page: 1, pageSize: 20 });
      const summary = result.transactions[0];

      expect(summary.id).toBe('TXN-CASH-001');
      expect(summary.total).toBe(42.5);
      expect(summary.status).toBe(TransactionStatus.COMPLETED);
      expect(summary.paymentMethod).toBe('cash');
      expect(summary.itemCount).toBe(2);
      expect(summary.receiptNumber).toBe('REC-001');
    });

    it('should sort transactions by most recent first', async () => {
      const transactions = [
        createMockTransaction({ id: 'TXN-OLD', createdAt: new Date('2026-06-01T10:00:00Z') }),
        createMockTransaction({ id: 'TXN-NEW', createdAt: new Date('2026-06-09T10:00:00Z') }),
        createMockTransaction({ id: 'TXN-MID', createdAt: new Date('2026-06-05T10:00:00Z') }),
      ];
      mockRepository['findCompleted'].mockResolvedValue(transactions);

      const result = await useCase.execute({ page: 1, pageSize: 20 });

      expect(result.transactions[0].id).toBe('TXN-NEW');
      expect(result.transactions[1].id).toBe('TXN-MID');
      expect(result.transactions[2].id).toBe('TXN-OLD');
    });

    it('should paginate results correctly - page 1', async () => {
      const transactions = Array.from({ length: 25 }, (_, i) =>
        createMockTransaction({
          id: `TXN-${i}`,
          createdAt: new Date(2026, 5, 9, 10, i),
        })
      );
      mockRepository['findCompleted'].mockResolvedValue(transactions);

      const result = await useCase.execute({ page: 1, pageSize: 10 });

      expect(result.transactions).toHaveLength(10);
      expect(result.total).toBe(25);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(3);
    });

    it('should paginate results correctly - page 2', async () => {
      const transactions = Array.from({ length: 25 }, (_, i) =>
        createMockTransaction({
          id: `TXN-${i}`,
          createdAt: new Date(2026, 5, 9, 10, i),
        })
      );
      mockRepository['findCompleted'].mockResolvedValue(transactions);

      const result = await useCase.execute({ page: 2, pageSize: 10 });

      expect(result.transactions).toHaveLength(10);
      expect(result.page).toBe(2);
    });

    it('should paginate results correctly - last page with fewer items', async () => {
      const transactions = Array.from({ length: 25 }, (_, i) =>
        createMockTransaction({
          id: `TXN-${i}`,
          createdAt: new Date(2026, 5, 9, 10, i),
        })
      );
      mockRepository['findCompleted'].mockResolvedValue(transactions);

      const result = await useCase.execute({ page: 3, pageSize: 10 });

      expect(result.transactions).toHaveLength(5);
      expect(result.page).toBe(3);
    });

    it('should filter by date range when dateFrom and dateTo provided', async () => {
      const dateFrom = new Date('2026-06-01');
      const dateTo = new Date('2026-06-09');
      mockRepository['findByDateRange'].mockResolvedValue([createMockTransaction({ id: 'TXN-1' })]);

      const result = await useCase.execute({ page: 1, pageSize: 20, dateFrom, dateTo });

      expect(mockRepository['findByDateRange']).toHaveBeenCalledWith(dateFrom, dateTo);
      expect(result.transactions).toHaveLength(1);
    });

    it('should filter by status when status provided', async () => {
      mockRepository['findByStatus'].mockResolvedValue([
        createMockTransaction({ id: 'TXN-1', status: TransactionStatus.REFUNDED }),
      ]);

      const result = await useCase.execute({
        page: 1,
        pageSize: 20,
        status: TransactionStatus.REFUNDED,
      });

      expect(mockRepository['findByStatus']).toHaveBeenCalledWith(TransactionStatus.REFUNDED);
      expect(result.transactions).toHaveLength(1);
    });

    it('should apply both date range and status filter', async () => {
      const dateFrom = new Date('2026-06-01');
      const dateTo = new Date('2026-06-09');
      const transactions = [
        createMockTransaction({ id: 'TXN-1', status: TransactionStatus.COMPLETED }),
        createMockTransaction({ id: 'TXN-2', status: TransactionStatus.REFUNDED }),
      ];
      mockRepository['findByDateRange'].mockResolvedValue(transactions);

      const result = await useCase.execute({
        page: 1,
        pageSize: 20,
        dateFrom,
        dateTo,
        status: TransactionStatus.COMPLETED,
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].id).toBe('TXN-1');
    });

    it('should infer cash payment method from paymentIds', async () => {
      const transaction = createMockTransaction({
        id: 'TXN-1',
        paymentIds: ['PAY-CASH-abc123'],
      });
      mockRepository['findCompleted'].mockResolvedValue([transaction]);

      const result = await useCase.execute({ page: 1, pageSize: 20 });

      expect(result.transactions[0].paymentMethod).toBe('cash');
    });

    it('should infer card payment method from paymentIds', async () => {
      const transaction = createMockTransaction({
        id: 'TXN-1',
        paymentIds: ['PAY-CARD-abc123'],
      });
      mockRepository['findCompleted'].mockResolvedValue([transaction]);

      const result = await useCase.execute({ page: 1, pageSize: 20 });

      expect(result.transactions[0].paymentMethod).toBe('card');
    });

    it('should infer mobile payment method from paymentIds', async () => {
      const transaction = createMockTransaction({
        id: 'TXN-1',
        paymentIds: ['PAY-MOBILE-abc123'],
      });
      mockRepository['findCompleted'].mockResolvedValue([transaction]);

      const result = await useCase.execute({ page: 1, pageSize: 20 });

      expect(result.transactions[0].paymentMethod).toBe('mobile');
    });

    it('should return unknown payment method when no paymentIds', async () => {
      const transaction = createMockTransaction({ id: 'TXN-1', paymentIds: [] });
      mockRepository['findCompleted'].mockResolvedValue([transaction]);

      const result = await useCase.execute({ page: 1, pageSize: 20 });

      expect(result.transactions[0].paymentMethod).toBe('unknown');
    });

    it('should handle repository errors gracefully', async () => {
      mockRepository['findCompleted'].mockRejectedValue(new Error('Database connection failed'));

      const result = await useCase.execute({ page: 1, pageSize: 20 });

      expect(result.transactions).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(useCase.error()).toBe('Database connection failed');
    });

    it('should handle unknown errors gracefully', async () => {
      mockRepository['findCompleted'].mockRejectedValue('unknown error');

      const result = await useCase.execute({ page: 1, pageSize: 20 });

      expect(result.transactions).toEqual([]);
      expect(useCase.error()).toBe('Unknown error fetching transaction history');
    });
  });

  describe('signals', () => {
    it('should set loading to true during execution', async () => {
      let loadingDuringExecution = false;
      mockRepository['findCompleted'].mockImplementation(async () => {
        loadingDuringExecution = useCase.loading();
        return [];
      });

      await useCase.execute({ page: 1, pageSize: 20 });

      expect(loadingDuringExecution).toBe(true);
      expect(useCase.loading()).toBe(false);
    });

    it('should set loading to false after execution', async () => {
      mockRepository['findCompleted'].mockResolvedValue([]);

      await useCase.execute({ page: 1, pageSize: 20 });

      expect(useCase.loading()).toBe(false);
    });

    it('should set loading to false after error', async () => {
      mockRepository['findCompleted'].mockRejectedValue(new Error('fail'));

      await useCase.execute({ page: 1, pageSize: 20 });

      expect(useCase.loading()).toBe(false);
    });

    it('should clear error on new execution', async () => {
      mockRepository['findCompleted'].mockRejectedValueOnce(new Error('fail'));
      await useCase.execute({ page: 1, pageSize: 20 });
      expect(useCase.error()).toBe('fail');

      mockRepository['findCompleted'].mockResolvedValue([]);
      await useCase.execute({ page: 1, pageSize: 20 });
      expect(useCase.error()).toBeNull();
    });

    it('should update result signal after successful execution', async () => {
      const transactions = [createMockTransaction({ id: 'TXN-1' })];
      mockRepository['findCompleted'].mockResolvedValue(transactions);

      expect(useCase.result()).toBeNull();

      await useCase.execute({ page: 1, pageSize: 20 });

      expect(useCase.result()).not.toBeNull();
      expect(useCase.result()!.transactions).toHaveLength(1);
    });
  });
});
