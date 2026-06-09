import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  GetTransactionHistoryUseCase,
  TransactionSummaryDTO,
} from '@core/application/use-cases/get-transaction-history.use-case';

/**
 * Transaction History Component
 *
 * Displays a paginated list of past transactions with filtering.
 * Each entry shows date/time, total amount, payment method, and item count.
 * Clicking a transaction expands to show full details.
 *
 * @example
 * ```html
 * <app-transaction-history />
 * ```
 */
@Component({
  selector: 'app-transaction-history',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="history-container" data-testid="transaction-history">
      <!-- Header -->
      <div class="history-header">
        <div class="header-left">
          <a routerLink="/pos" class="back-link" data-testid="back-to-pos"> ← Back to POS </a>
          <h1 class="history-title">📋 Transaction History</h1>
          <p class="history-subtitle">View and review past sales activity</p>
        </div>
      </div>

      <!-- Loading State -->
      @if (loading()) {
        <div class="loading-state" data-testid="loading-indicator">
          <div class="spinner"></div>
          <p>Loading transactions...</p>
        </div>
      }

      <!-- Error State -->
      @if (error()) {
        <div class="error-state" data-testid="error-message">
          <span class="error-icon">⚠️</span>
          <p>{{ error() }}</p>
          <button class="btn-retry" (click)="loadTransactions()" data-testid="btn-retry">
            Retry
          </button>
        </div>
      }

      <!-- Empty State -->
      @if (!loading() && !error() && transactions().length === 0) {
        <div class="empty-state" data-testid="empty-state">
          <span class="empty-icon">🧾</span>
          <h3>No transactions yet</h3>
          <p>Completed transactions will appear here.</p>
          <a routerLink="/pos" class="btn-start" data-testid="btn-start-selling"> Start Selling </a>
        </div>
      }

      <!-- Transaction List -->
      @if (!loading() && transactions().length > 0) {
        <div class="transaction-list" data-testid="transaction-list">
          @for (txn of transactions(); track txn.id) {
            <div
              class="transaction-card"
              role="button"
              tabindex="0"
              [class.expanded]="selectedTransaction() === txn.id"
              (click)="toggleTransaction(txn.id)"
              (keydown.enter)="toggleTransaction(txn.id)"
              (keydown.space)="toggleTransaction(txn.id)"
              [attr.data-testid]="'transaction-' + txn.id"
            >
              <!-- Summary Row -->
              <div class="txn-summary">
                <div class="txn-date">
                  <span class="date-primary">{{ txn.date | date: 'MMM d, y' }}</span>
                  <span class="date-secondary">{{ txn.date | date: 'h:mm a' }}</span>
                </div>
                <div class="txn-info">
                  <span class="txn-method" [attr.data-testid]="'method-' + txn.id">
                    {{ getMethodIcon(txn.paymentMethod) }}
                    {{ txn.paymentMethod | titlecase }}
                  </span>
                  <span class="txn-items" [attr.data-testid]="'items-' + txn.id">
                    {{ txn.itemCount }} {{ txn.itemCount === 1 ? 'item' : 'items' }}
                  </span>
                </div>
                <div class="txn-total" [attr.data-testid]="'total-' + txn.id">
                  {{ txn.total | currency }}
                </div>
                <div class="txn-expand">
                  {{ selectedTransaction() === txn.id ? '▲' : '▼' }}
                </div>
              </div>

              <!-- Expanded Details -->
              @if (selectedTransaction() === txn.id) {
                <div class="txn-details" [attr.data-testid]="'details-' + txn.id">
                  <div class="detail-row">
                    <span class="detail-label">Transaction ID</span>
                    <span class="detail-value mono">{{ txn.id }}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Status</span>
                    <span
                      class="detail-value status-badge"
                      [class]="'status-' + txn.status.toLowerCase()"
                    >
                      {{ txn.status }}
                    </span>
                  </div>
                  @if (txn.receiptNumber) {
                    <div class="detail-row">
                      <span class="detail-label">Receipt #</span>
                      <span class="detail-value mono">{{ txn.receiptNumber }}</span>
                    </div>
                  }
                  <div class="detail-row">
                    <span class="detail-label">Payment Method</span>
                    <span class="detail-value"
                      >{{ getMethodIcon(txn.paymentMethod) }}
                      {{ txn.paymentMethod | titlecase }}</span
                    >
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Items</span>
                    <span class="detail-value"
                      >{{ txn.itemCount }} {{ txn.itemCount === 1 ? 'item' : 'items' }}</span
                    >
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Total</span>
                    <span class="detail-value total-highlight">{{ txn.total | currency }}</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Pagination -->
        @if (totalPages() > 1) {
          <div class="pagination" data-testid="pagination">
            <button
              class="btn-page"
              [disabled]="currentPage() === 1"
              (click)="goToPage(currentPage() - 1)"
              data-testid="btn-prev"
            >
              ← Previous
            </button>
            <span class="page-info" data-testid="page-info">
              Page {{ currentPage() }} of {{ totalPages() }}
            </span>
            <button
              class="btn-page"
              [disabled]="currentPage() === totalPages()"
              (click)="goToPage(currentPage() + 1)"
              data-testid="btn-next"
            >
              Next →
            </button>
          </div>
        }

        <!-- Summary Footer -->
        <div class="history-footer" data-testid="history-footer">
          <span>Showing {{ transactions().length }} of {{ totalTransactions() }} transactions</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .history-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 1.5rem;
        min-height: 100vh;
        background: #f9fafb;
      }

      .history-header {
        margin-bottom: 1.5rem;
      }

      .back-link {
        display: inline-block;
        font-size: 0.875rem;
        color: #2563eb;
        text-decoration: none;
        margin-bottom: 0.5rem;
        font-weight: 500;
      }

      .back-link:hover {
        color: #1d4ed8;
        text-decoration: underline;
      }

      .history-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: #111827;
        margin: 0;
      }

      .history-subtitle {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0.25rem 0 0;
      }

      .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4rem 2rem;
        color: #6b7280;
      }

      .spinner {
        width: 2rem;
        height: 2rem;
        border: 3px solid #e5e7eb;
        border-top-color: #2563eb;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 1rem;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .error-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 3rem 2rem;
        background: #fef2f2;
        border-radius: 12px;
        border: 1px solid #fecaca;
      }

      .error-icon {
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }

      .error-state p {
        color: #991b1b;
        margin: 0 0 1rem;
      }

      .btn-retry {
        padding: 0.5rem 1.5rem;
        background: #dc2626;
        color: white;
        border: none;
        border-radius: 6px;
        font-weight: 600;
        cursor: pointer;
      }

      .btn-retry:hover {
        background: #b91c1c;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 4rem 2rem;
        text-align: center;
      }

      .empty-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
      }

      .empty-state h3 {
        font-size: 1.125rem;
        font-weight: 600;
        color: #374151;
        margin: 0 0 0.5rem;
      }

      .empty-state p {
        color: #6b7280;
        margin: 0 0 1.5rem;
      }

      .btn-start {
        padding: 0.75rem 1.5rem;
        background: #2563eb;
        color: white;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.875rem;
      }

      .btn-start:hover {
        background: #1d4ed8;
      }

      .transaction-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .transaction-card {
        background: white;
        border-radius: 10px;
        border: 1px solid #e5e7eb;
        overflow: hidden;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .transaction-card:hover {
        border-color: #d1d5db;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      }

      .transaction-card.expanded {
        border-color: #2563eb;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.1);
      }

      .txn-summary {
        display: grid;
        grid-template-columns: 1fr 1fr auto auto;
        align-items: center;
        padding: 1rem 1.25rem;
        gap: 1rem;
      }

      .txn-date {
        display: flex;
        flex-direction: column;
      }

      .date-primary {
        font-size: 0.875rem;
        font-weight: 600;
        color: #111827;
      }

      .date-secondary {
        font-size: 0.75rem;
        color: #6b7280;
      }

      .txn-info {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }

      .txn-method {
        font-size: 0.8125rem;
        color: #374151;
        font-weight: 500;
      }

      .txn-items {
        font-size: 0.75rem;
        color: #6b7280;
      }

      .txn-total {
        font-size: 1rem;
        font-weight: 700;
        color: #111827;
        font-family: 'JetBrains Mono', monospace;
      }

      .txn-expand {
        font-size: 0.75rem;
        color: #9ca3af;
        padding: 0.25rem;
      }

      .txn-details {
        padding: 0 1.25rem 1.25rem;
        border-top: 1px solid #f3f4f6;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-top: 1rem;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.8125rem;
      }

      .detail-label {
        color: #6b7280;
      }

      .detail-value {
        color: #111827;
        font-weight: 500;
      }

      .detail-value.mono {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.75rem;
        background: #f3f4f6;
        padding: 0.125rem 0.5rem;
        border-radius: 4px;
      }

      .detail-value.total-highlight {
        font-size: 1rem;
        font-weight: 700;
        color: #059669;
      }

      .status-badge {
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
      }

      .status-completed {
        background: #ecfdf5;
        color: #065f46;
      }

      .status-refunded {
        background: #fef3c7;
        color: #92400e;
      }

      .status-cancelled {
        background: #fef2f2;
        color: #991b1b;
      }

      .status-pending {
        background: #eff6ff;
        color: #1e40af;
      }

      .pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        padding: 1.5rem 0;
      }

      .btn-page {
        padding: 0.5rem 1rem;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: white;
        font-size: 0.8125rem;
        font-weight: 500;
        color: #374151;
        cursor: pointer;
        transition: all 0.15s;
      }

      .btn-page:hover:not(:disabled) {
        background: #f9fafb;
        border-color: #d1d5db;
      }

      .btn-page:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .page-info {
        font-size: 0.8125rem;
        color: #6b7280;
        font-weight: 500;
      }

      .history-footer {
        text-align: center;
        padding: 1rem 0;
        font-size: 0.75rem;
        color: #9ca3af;
      }
    `,
  ],
})
export class TransactionHistoryComponent implements OnInit {
  private readonly getTransactionHistory = inject(GetTransactionHistoryUseCase);

  /** Page size for pagination */
  private readonly PAGE_SIZE = 10;

  /** Currently selected/expanded transaction */
  readonly selectedTransaction = signal<string | null>(null);

  /** Current page */
  readonly currentPage = signal<number>(1);

  /** Computed signals from use case */
  readonly loading = computed(() => this.getTransactionHistory.loading());
  readonly error = computed(() => this.getTransactionHistory.error());

  readonly transactions = computed<TransactionSummaryDTO[]>(() => {
    const result = this.getTransactionHistory.result();
    return result?.transactions ?? [];
  });

  readonly totalPages = computed(() => {
    const result = this.getTransactionHistory.result();
    return result?.totalPages ?? 0;
  });

  readonly totalTransactions = computed(() => {
    const result = this.getTransactionHistory.result();
    return result?.total ?? 0;
  });

  ngOnInit(): void {
    this.loadTransactions();
  }

  /**
   * Load transactions for the current page
   */
  async loadTransactions(): Promise<void> {
    await this.getTransactionHistory.execute({
      page: this.currentPage(),
      pageSize: this.PAGE_SIZE,
    });
  }

  /**
   * Navigate to a specific page
   */
  async goToPage(page: number): Promise<void> {
    this.currentPage.set(page);
    this.selectedTransaction.set(null);
    await this.loadTransactions();
  }

  /**
   * Toggle transaction detail expansion
   */
  toggleTransaction(id: string): void {
    if (this.selectedTransaction() === id) {
      this.selectedTransaction.set(null);
    } else {
      this.selectedTransaction.set(id);
    }
  }

  /**
   * Get payment method icon
   */
  getMethodIcon(method: string): string {
    const icons: Record<string, string> = {
      cash: '💵',
      card: '💳',
      mobile: '📱',
      unknown: '❓',
    };
    return icons[method] ?? '💰';
  }
}
