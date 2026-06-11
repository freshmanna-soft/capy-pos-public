import { TestBed } from '@angular/core/testing';
import { GetDailySalesReportUseCase } from './get-daily-sales-report.use-case';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@core/domain/entities/transaction.entity';

/**
 * GetDailySalesReportUseCase Unit Tests
 *
 * Tests the daily sales report aggregation logic:
 * - Total revenue calculation
 * - Transaction count
 * - Average transaction value
 * - Payment method breakdown (cash vs card)
 * - Date range filtering
 * - Edge cases (no transactions, single transaction)
 * - Error handling
 */
describe('GetDailySalesReportUseCase', () => {
  let useCase: GetDailySalesReportUseCase;
  let mockRepository: { findByDateRange: ReturnType<typeof vi.fn> };

  const today = new Date('2026-06-09T00:00:00');
  const endOfToday = new Date('2026-06-09T23:59:59.999');

  /**
   * Helper to create a mock Transaction entity
   */
  function createMockTransaction(overrides: {
    id: string;
    total: number;
    paymentIds: string[];
    createdAt?: Date;
    status?: TransactionStatus;
  }): Transaction {
    return new Transaction({
      id: overrides.id,
      type: TransactionType.SALE,
      status: overrides.status ?? TransactionStatus.COMPLETED,
      items: [
        {
          productId: 'prod-1',
          productName: 'Test Product',
          quantity: 1,
          unitPrice: overrides.total,
          subtotal: overrides.total,
        },
      ],
      subtotal: overrides.total * 0.92,
      taxRate: 0.085,
      taxAmount: overrides.total * 0.08,
      discountAmount: 0,
      total: overrides.total,
      paymentIds: overrides.paymentIds,
      receiptNumber: `RCP-${overrides.id}`,
      createdAt: overrides.createdAt ?? today,
    });
  }

  beforeEach(() => {
    mockRepository = {
      findByDateRange: vi.fn().mockResolvedValue([]),
    };

    TestBed.configureTestingModule({
      providers: [
        GetDailySalesReportUseCase,
        { provide: 'ITransactionRepository', useValue: mockRepository },
      ],
    });

    useCase = TestBed.inject(GetDailySalesReportUseCase);
  });

  // =========================================================================
  // Initial State
  // =========================================================================
  describe('Initial State', () => {
    it('should have loading as false initially', () => {
      expect(useCase.loading()).toBe(false);
    });

    it('should have error as null initially', () => {
      expect(useCase.error()).toBeNull();
    });

    it('should have result as null initially', () => {
      expect(useCase.result()).toBeNull();
    });
  });

  // =========================================================================
  // Successful Execution
  // =========================================================================
  describe('Successful Execution', () => {
    it('should call repository with correct date range', async () => {
      await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(mockRepository.findByDateRange).toHaveBeenCalledWith(today, endOfToday);
    });

    it('should set loading to true during execution', async () => {
      let loadingDuringExecution = false;
      mockRepository.findByDateRange.mockImplementation(async () => {
        loadingDuringExecution = useCase.loading();
        return [];
      });

      await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(loadingDuringExecution).toBe(true);
    });

    it('should set loading to false after execution', async () => {
      await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(useCase.loading()).toBe(false);
    });

    it('should calculate total revenue from all transactions', async () => {
      const transactions = [
        createMockTransaction({ id: '1', total: 25.5, paymentIds: ['PAY-CASH-1'] }),
        createMockTransaction({ id: '2', total: 42.0, paymentIds: ['PAY-CARD-1'] }),
        createMockTransaction({ id: '3', total: 15.75, paymentIds: ['PAY-CASH-2'] }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      const result = useCase.result();
      expect(result).not.toBeNull();
      expect(result!.totalRevenue).toBeCloseTo(83.25, 2);
    });

    it('should calculate correct transaction count', async () => {
      const transactions = [
        createMockTransaction({ id: '1', total: 10, paymentIds: ['PAY-CASH-1'] }),
        createMockTransaction({ id: '2', total: 20, paymentIds: ['PAY-CARD-1'] }),
        createMockTransaction({ id: '3', total: 30, paymentIds: ['PAY-CASH-2'] }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(useCase.result()!.transactionCount).toBe(3);
    });

    it('should calculate correct average transaction value', async () => {
      const transactions = [
        createMockTransaction({ id: '1', total: 10, paymentIds: ['PAY-CASH-1'] }),
        createMockTransaction({ id: '2', total: 20, paymentIds: ['PAY-CARD-1'] }),
        createMockTransaction({ id: '3', total: 30, paymentIds: ['PAY-CASH-2'] }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(useCase.result()!.averageTransactionValue).toBeCloseTo(20, 2);
    });

    it('should calculate payment breakdown for cash transactions', async () => {
      const transactions = [
        createMockTransaction({ id: '1', total: 25.0, paymentIds: ['PAY-CASH-1'] }),
        createMockTransaction({ id: '2', total: 15.0, paymentIds: ['PAY-CASH-2'] }),
        createMockTransaction({ id: '3', total: 50.0, paymentIds: ['PAY-CARD-1'] }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      const result = useCase.result()!;
      expect(result.paymentBreakdown.cash).toBeCloseTo(40.0, 2);
    });

    it('should calculate payment breakdown for card transactions', async () => {
      const transactions = [
        createMockTransaction({ id: '1', total: 25.0, paymentIds: ['PAY-CASH-1'] }),
        createMockTransaction({ id: '2', total: 50.0, paymentIds: ['PAY-CARD-1'] }),
        createMockTransaction({ id: '3', total: 30.0, paymentIds: ['PAY-CARD-2'] }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      const result = useCase.result()!;
      expect(result.paymentBreakdown.card).toBeCloseTo(80.0, 2);
    });

    it('should include cash and card transaction counts in breakdown', async () => {
      const transactions = [
        createMockTransaction({ id: '1', total: 25.0, paymentIds: ['PAY-CASH-1'] }),
        createMockTransaction({ id: '2', total: 50.0, paymentIds: ['PAY-CARD-1'] }),
        createMockTransaction({ id: '3', total: 30.0, paymentIds: ['PAY-CARD-2'] }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      const result = useCase.result()!;
      expect(result.paymentBreakdown.cashCount).toBe(1);
      expect(result.paymentBreakdown.cardCount).toBe(2);
    });

    it('should only count completed transactions', async () => {
      const transactions = [
        createMockTransaction({
          id: '1',
          total: 25.0,
          paymentIds: ['PAY-CASH-1'],
          status: TransactionStatus.COMPLETED,
        }),
        createMockTransaction({
          id: '2',
          total: 50.0,
          paymentIds: ['PAY-CARD-1'],
          status: TransactionStatus.CANCELLED,
        }),
        createMockTransaction({
          id: '3',
          total: 30.0,
          paymentIds: ['PAY-CASH-2'],
          status: TransactionStatus.COMPLETED,
        }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      const result = useCase.result()!;
      expect(result.transactionCount).toBe(2);
      expect(result.totalRevenue).toBeCloseTo(55.0, 2);
    });

    it('should store the date range in the result', async () => {
      await useCase.execute({ startDate: today, endDate: endOfToday });

      const result = useCase.result()!;
      expect(result.startDate).toEqual(today);
      expect(result.endDate).toEqual(endOfToday);
    });

    it('should set result signal with report data', async () => {
      const transactions = [
        createMockTransaction({ id: '1', total: 100, paymentIds: ['PAY-CASH-1'] }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      const returnedResult = await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(useCase.result()).toEqual(returnedResult);
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================
  describe('Edge Cases', () => {
    it('should return zero values when no transactions exist', async () => {
      mockRepository.findByDateRange.mockResolvedValue([]);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      const result = useCase.result()!;
      expect(result.totalRevenue).toBe(0);
      expect(result.transactionCount).toBe(0);
      expect(result.averageTransactionValue).toBe(0);
      expect(result.paymentBreakdown.cash).toBe(0);
      expect(result.paymentBreakdown.card).toBe(0);
      expect(result.paymentBreakdown.cashCount).toBe(0);
      expect(result.paymentBreakdown.cardCount).toBe(0);
    });

    it('should handle single transaction correctly', async () => {
      const transactions = [
        createMockTransaction({ id: '1', total: 42.5, paymentIds: ['PAY-CARD-1'] }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      const result = useCase.result()!;
      expect(result.totalRevenue).toBeCloseTo(42.5, 2);
      expect(result.transactionCount).toBe(1);
      expect(result.averageTransactionValue).toBeCloseTo(42.5, 2);
      expect(result.paymentBreakdown.card).toBeCloseTo(42.5, 2);
      expect(result.paymentBreakdown.cash).toBe(0);
    });

    it('should handle transactions with unknown payment method', async () => {
      const transactions = [
        createMockTransaction({ id: '1', total: 20, paymentIds: ['PAY-MOBILE-1'] }),
      ];
      mockRepository.findByDateRange.mockResolvedValue(transactions);

      await useCase.execute({ startDate: today, endDate: endOfToday });

      const result = useCase.result()!;
      // Unknown payment methods should still count in total but not in cash/card breakdown
      expect(result.totalRevenue).toBeCloseTo(20, 2);
      expect(result.transactionCount).toBe(1);
      expect(result.paymentBreakdown.cash).toBe(0);
      expect(result.paymentBreakdown.card).toBe(0);
    });
  });

  // =========================================================================
  // Error Handling
  // =========================================================================
  describe('Error Handling', () => {
    it('should set error signal when repository throws', async () => {
      mockRepository.findByDateRange.mockRejectedValue(new Error('Database connection failed'));

      await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(useCase.error()).toBe('Failed to generate daily sales report');
    });

    it('should set loading to false when error occurs', async () => {
      mockRepository.findByDateRange.mockRejectedValue(new Error('Failure'));

      await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(useCase.loading()).toBe(false);
    });

    it('should return empty report when error occurs', async () => {
      mockRepository.findByDateRange.mockRejectedValue(new Error('Failure'));

      const result = await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(result.totalRevenue).toBe(0);
      expect(result.transactionCount).toBe(0);
      expect(result.averageTransactionValue).toBe(0);
    });

    it('should handle non-Error exceptions gracefully', async () => {
      mockRepository.findByDateRange.mockRejectedValue('string error');

      await useCase.execute({ startDate: today, endDate: endOfToday });

      expect(useCase.error()).toBe('Failed to generate daily sales report');
    });

    it('should clear previous error on new execution', async () => {
      mockRepository.findByDateRange.mockRejectedValueOnce(new Error('First error'));
      await useCase.execute({ startDate: today, endDate: endOfToday });
      expect(useCase.error()).toBe('Failed to generate daily sales report');

      mockRepository.findByDateRange.mockResolvedValueOnce([]);
      await useCase.execute({ startDate: today, endDate: endOfToday });
      expect(useCase.error()).toBeNull();
    });
  });
});
