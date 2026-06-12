import { Injectable, inject, signal, computed } from '@angular/core';
import { ITransactionRepository } from '@core/domain/interfaces/transaction.repository.interface';
import { Transaction, TransactionStatus } from '@core/domain/entities/transaction.entity';
import { InvalidDateRangeException, ReportGenerationException } from '@core/application/exceptions';

/**
 * Request DTO for daily sales report
 */
export interface GetDailySalesReportRequest {
  /** Start of the date range */
  startDate: Date;
  /** End of the date range */
  endDate: Date;
}

/**
 * Payment method breakdown in the report
 */
export interface PaymentBreakdown {
  /** Total revenue from cash payments */
  cash: number;
  /** Total revenue from card payments */
  card: number;
  /** Total revenue from mobile payments */
  mobile: number;
  /** Number of cash transactions */
  cashCount: number;
  /** Number of card transactions */
  cardCount: number;
  /** Number of mobile transactions */
  mobileCount: number;
}

/**
 * Response DTO for daily sales report
 */
export interface DailySalesReportResult {
  /** Total revenue for the period */
  totalRevenue: number;
  /** Number of completed transactions */
  transactionCount: number;
  /** Average transaction value */
  averageTransactionValue: number;
  /** Breakdown by payment method */
  paymentBreakdown: PaymentBreakdown;
  /** Start of the reporting period */
  startDate: Date;
  /** End of the reporting period */
  endDate: Date;
}

/**
 * Get Daily Sales Report Use Case
 *
 * Application layer use case responsible for aggregating transaction data
 * into a daily sales summary report.
 *
 * Calculates total revenue, transaction count, average value,
 * and payment method breakdown for a given date range.
 *
 * @example
 * ```typescript
 * const useCase = inject(GetDailySalesReportUseCase);
 * await useCase.execute({ startDate: todayStart, endDate: todayEnd });
 * const report = useCase.result();
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class GetDailySalesReportUseCase {
  private readonly transactionRepository: ITransactionRepository = inject<ITransactionRepository>(
    'ITransactionRepository' as never
  );

  /** Loading state signal */
  private readonly _loading = signal<boolean>(false);

  /** Error state signal */
  private readonly _error = signal<string | null>(null);

  /** Result state signal */
  private readonly _result = signal<DailySalesReportResult | null>(null);

  /** Public readonly signals */
  readonly loading = computed(() => this._loading());
  readonly error = computed(() => this._error());
  readonly result = computed(() => this._result());

  /**
   * Executes the daily sales report generation.
   * Fetches transactions for the date range and aggregates metrics.
   *
   * @param request - The request DTO with date range
   * @returns Promise resolving to the daily sales report
   */
  async execute(request: GetDailySalesReportRequest): Promise<DailySalesReportResult> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const { startDate, endDate } = request;

      // Validate date range
      if (startDate > endDate) {
        throw new InvalidDateRangeException(startDate, endDate);
      }

      // Fetch all transactions in the date range
      const allTransactions = await this.transactionRepository.findByDateRange(startDate, endDate);

      // Filter to only completed transactions
      const completedTransactions = allTransactions.filter(
        (t) => t.status === TransactionStatus.COMPLETED
      );

      // Aggregate metrics
      const result = this.aggregateReport(completedTransactions, startDate, endDate);

      this._result.set(result);
      this._loading.set(false);

      return result;
    } catch (error: unknown) {
      const exception =
        error instanceof InvalidDateRangeException
          ? error
          : new ReportGenerationException('daily sales', error);
      this._error.set(exception.message);
      this._loading.set(false);

      const emptyResult: DailySalesReportResult = {
        totalRevenue: 0,
        transactionCount: 0,
        averageTransactionValue: 0,
        paymentBreakdown: {
          cash: 0,
          card: 0,
          mobile: 0,
          cashCount: 0,
          cardCount: 0,
          mobileCount: 0,
        },
        startDate: request.startDate,
        endDate: request.endDate,
      };

      this._result.set(emptyResult);
      return emptyResult;
    }
  }

  /**
   * Aggregates transaction data into a report summary.
   */
  private aggregateReport(
    transactions: Transaction[],
    startDate: Date,
    endDate: Date
  ): DailySalesReportResult {
    const transactionCount = transactions.length;
    const totalRevenue = transactions.reduce((sum, t) => sum + t.total, 0);
    const averageTransactionValue = transactionCount > 0 ? totalRevenue / transactionCount : 0;

    const paymentBreakdown = this.calculatePaymentBreakdown(transactions);

    return {
      totalRevenue,
      transactionCount,
      averageTransactionValue,
      paymentBreakdown,
      startDate,
      endDate,
    };
  }

  /**
   * Calculates the payment method breakdown from transactions.
   */
  private calculatePaymentBreakdown(transactions: Transaction[]): PaymentBreakdown {
    let cash = 0;
    let card = 0;
    let mobile = 0;
    let cashCount = 0;
    let cardCount = 0;
    let mobileCount = 0;

    for (const transaction of transactions) {
      const method = this.inferPaymentMethod(transaction);

      if (method === 'cash') {
        cash += transaction.total;
        cashCount++;
      } else if (method === 'card') {
        card += transaction.total;
        cardCount++;
      } else if (method === 'mobile') {
        mobile += transaction.total;
        mobileCount++;
      }
    }

    return { cash, card, mobile, cashCount, cardCount, mobileCount };
  }

  /**
   * Infers payment method from transaction payment IDs.
   */
  private inferPaymentMethod(transaction: Transaction): string {
    const paymentIds = transaction.paymentIds ?? [];
    if (paymentIds.length === 0) return 'unknown';

    const firstPaymentId = paymentIds[0];
    if (firstPaymentId.includes('CASH')) return 'cash';
    if (firstPaymentId.includes('CARD')) return 'card';
    if (firstPaymentId.includes('MOBILE')) return 'mobile';

    return 'other';
  }
}
