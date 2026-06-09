import { Injectable, inject, signal, computed } from '@angular/core';
import { ITransactionRepository } from '@core/domain/interfaces/transaction.repository.interface';
import { Transaction, TransactionStatus } from '@core/domain/entities/transaction.entity';

/**
 * Request DTO for fetching transaction history
 */
export interface GetTransactionHistoryRequest {
  /** Page number (1-based) */
  page: number;
  /** Number of items per page */
  pageSize: number;
  /** Optional status filter */
  status?: TransactionStatus;
  /** Optional start date filter */
  dateFrom?: Date;
  /** Optional end date filter */
  dateTo?: Date;
}

/**
 * Summary DTO for a single transaction in the history list
 */
export interface TransactionSummaryDTO {
  /** Transaction ID */
  id: string;
  /** Date/time of transaction */
  date: Date;
  /** Total amount */
  total: number;
  /** Payment method used */
  paymentMethod: string;
  /** Number of items in the transaction */
  itemCount: number;
  /** Transaction status */
  status: TransactionStatus;
  /** Receipt number if available */
  receiptNumber?: string;
}

/**
 * Result DTO for transaction history
 */
export interface GetTransactionHistoryResult {
  /** List of transaction summaries */
  transactions: TransactionSummaryDTO[];
  /** Total number of transactions matching the filter */
  total: number;
  /** Current page number */
  page: number;
  /** Page size */
  pageSize: number;
  /** Total number of pages */
  totalPages: number;
}

/**
 * Get Transaction History Use Case
 *
 * Application layer use case responsible for retrieving paginated
 * transaction history from the repository.
 *
 * Supports filtering by status and date range.
 * Returns paginated results sorted by most recent first.
 *
 * @example
 * ```typescript
 * const useCase = inject(GetTransactionHistoryUseCase);
 * await useCase.execute({ page: 1, pageSize: 20 });
 * const history = useCase.result();
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class GetTransactionHistoryUseCase {
  private readonly transactionRepository: ITransactionRepository = inject<ITransactionRepository>(
    'ITransactionRepository' as never,
  );

  /** Loading state signal */
  private readonly _loading = signal<boolean>(false);

  /** Error state signal */
  private readonly _error = signal<string | null>(null);

  /** Result state signal */
  private readonly _result = signal<GetTransactionHistoryResult | null>(null);

  /** Public readonly signals */
  readonly loading = computed(() => this._loading());
  readonly error = computed(() => this._error());
  readonly result = computed(() => this._result());

  /**
   * Executes the get transaction history use case.
   * Fetches paginated transactions from the repository.
   *
   * @param request - The request DTO with pagination and filter params
   * @returns Promise resolving to the paginated transaction history
   */
  async execute(request: GetTransactionHistoryRequest): Promise<GetTransactionHistoryResult> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const { page, pageSize, status, dateFrom, dateTo } = request;

      // Fetch transactions based on filters
      let allTransactions: Transaction[];

      if (dateFrom && dateTo) {
        allTransactions = await this.transactionRepository.findByDateRange(dateFrom, dateTo);
      } else if (status) {
        allTransactions = await this.transactionRepository.findByStatus(status);
      } else {
        allTransactions = await this.transactionRepository.findCompleted();
      }

      // Apply status filter if date range was used
      if (dateFrom && dateTo && status) {
        allTransactions = allTransactions.filter((t) => t.status === status);
      }

      // Sort by most recent first (createdAt descending)
      allTransactions.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });

      // Calculate pagination
      const total = allTransactions.length;
      const totalPages = Math.ceil(total / pageSize);
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedTransactions = allTransactions.slice(startIndex, endIndex);

      // Map to summary DTOs
      const transactions: TransactionSummaryDTO[] = paginatedTransactions.map((t) =>
        this.mapToSummary(t),
      );

      const result: GetTransactionHistoryResult = {
        transactions,
        total,
        page,
        pageSize,
        totalPages,
      };

      this._result.set(result);
      this._loading.set(false);

      return result;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error fetching transaction history';
      this._error.set(errorMessage);
      this._loading.set(false);

      return {
        transactions: [],
        total: 0,
        page: request.page,
        pageSize: request.pageSize,
        totalPages: 0,
      };
    }
  }

  /**
   * Maps a Transaction entity to a TransactionSummaryDTO
   */
  private mapToSummary(transaction: Transaction): TransactionSummaryDTO {
    return {
      id: transaction.id,
      date: transaction.createdAt ?? new Date(),
      total: transaction.total,
      paymentMethod: this.inferPaymentMethod(transaction),
      itemCount: transaction.items?.length ?? 0,
      status: transaction.status,
      receiptNumber: transaction.receiptNumber,
    };
  }

  /**
   * Infers payment method from transaction data.
   * Since Transaction entity stores paymentIds, we infer from the ID prefix.
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
