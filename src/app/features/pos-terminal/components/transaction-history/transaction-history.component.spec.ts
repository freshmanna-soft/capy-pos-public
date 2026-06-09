import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import { provideRouter } from '@angular/router';
import { TransactionHistoryComponent } from './transaction-history.component';
import {
  GetTransactionHistoryUseCase,
  GetTransactionHistoryResult,
  TransactionSummaryDTO,
} from '@core/application/use-cases/get-transaction-history.use-case';
import { TransactionStatus } from '@core/domain/entities/transaction.entity';
import { signal } from '@angular/core';

describe('TransactionHistoryComponent', () => {
  let component: TransactionHistoryComponent;
  let fixture: ComponentFixture<TransactionHistoryComponent>;
  let mockUseCase: {
    execute: Mock;
    loading: ReturnType<typeof signal>;
    error: ReturnType<typeof signal>;
    result: ReturnType<typeof signal>;
  };

  const mockTransactions: TransactionSummaryDTO[] = [
    {
      id: 'TXN-CASH-001',
      date: new Date('2026-06-09T14:30:00Z'),
      total: 42.5,
      paymentMethod: 'cash',
      itemCount: 3,
      status: TransactionStatus.COMPLETED,
      receiptNumber: 'REC-001',
    },
    {
      id: 'TXN-CARD-002',
      date: new Date('2026-06-09T12:00:00Z'),
      total: 89.99,
      paymentMethod: 'card',
      itemCount: 5,
      status: TransactionStatus.COMPLETED,
    },
    {
      id: 'TXN-CASH-003',
      date: new Date('2026-06-08T09:15:00Z'),
      total: 15.0,
      paymentMethod: 'cash',
      itemCount: 1,
      status: TransactionStatus.REFUNDED,
    },
  ];

  const mockResult: GetTransactionHistoryResult = {
    transactions: mockTransactions,
    total: 3,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  };

  beforeEach(async () => {
    const loadingSignal = signal(false);
    const errorSignal = signal<string | null>(null);
    const resultSignal = signal<GetTransactionHistoryResult | null>(null);

    mockUseCase = {
      execute: vi.fn().mockResolvedValue(mockResult),
      loading: loadingSignal,
      error: errorSignal,
      result: resultSignal,
    };

    await TestBed.configureTestingModule({
      imports: [TransactionHistoryComponent],
      providers: [
        provideRouter([]),
        { provide: GetTransactionHistoryUseCase, useValue: mockUseCase },
        { provide: 'ITransactionRepository' as never, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionHistoryComponent);
    component = fixture.componentInstance;
  });

  describe('initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should call loadTransactions on init', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockUseCase.execute).toHaveBeenCalledWith({
        page: 1,
        pageSize: 10,
      });
    });
  });

  describe('empty state', () => {
    it('should display empty state when no transactions', () => {
      mockUseCase.result.set({
        transactions: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      });
      fixture.detectChanges();

      const emptyState = fixture.nativeElement.querySelector('[data-testid="empty-state"]');
      expect(emptyState).toBeTruthy();
      expect(emptyState.textContent).toContain('No transactions yet');
    });

    it('should show Start Selling link in empty state', () => {
      mockUseCase.result.set({
        transactions: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      });
      fixture.detectChanges();

      const startBtn = fixture.nativeElement.querySelector('[data-testid="btn-start-selling"]');
      expect(startBtn).toBeTruthy();
    });
  });

  describe('loading state', () => {
    it('should display loading indicator when loading', () => {
      mockUseCase.loading.set(true);
      fixture.detectChanges();

      const loading = fixture.nativeElement.querySelector('[data-testid="loading-indicator"]');
      expect(loading).toBeTruthy();
      expect(loading.textContent).toContain('Loading transactions');
    });

    it('should hide loading indicator when not loading', () => {
      mockUseCase.loading.set(false);
      fixture.detectChanges();

      const loading = fixture.nativeElement.querySelector('[data-testid="loading-indicator"]');
      expect(loading).toBeFalsy();
    });
  });

  describe('error state', () => {
    it('should display error message when error occurs', () => {
      mockUseCase.error.set('Database connection failed');
      fixture.detectChanges();

      const error = fixture.nativeElement.querySelector('[data-testid="error-message"]');
      expect(error).toBeTruthy();
      expect(error.textContent).toContain('Database connection failed');
    });

    it('should show retry button on error', () => {
      mockUseCase.error.set('Some error');
      fixture.detectChanges();

      const retryBtn = fixture.nativeElement.querySelector('[data-testid="btn-retry"]');
      expect(retryBtn).toBeTruthy();
    });

    it('should reload transactions when retry is clicked', async () => {
      mockUseCase.error.set('Some error');
      fixture.detectChanges();

      const retryBtn = fixture.nativeElement.querySelector('[data-testid="btn-retry"]');
      retryBtn.click();
      await fixture.whenStable();

      expect(mockUseCase.execute).toHaveBeenCalled();
    });
  });

  describe('transaction list', () => {
    beforeEach(() => {
      mockUseCase.result.set(mockResult);
      fixture.detectChanges();
    });

    it('should display transaction list', () => {
      const list = fixture.nativeElement.querySelector('[data-testid="transaction-list"]');
      expect(list).toBeTruthy();
    });

    it('should display correct number of transactions', () => {
      const cards = fixture.nativeElement.querySelectorAll('.transaction-card');
      expect(cards.length).toBe(3);
    });

    it('should display transaction total amount', () => {
      const total = fixture.nativeElement.querySelector('[data-testid="total-TXN-CASH-001"]');
      expect(total).toBeTruthy();
      expect(total.textContent).toContain('$42.50');
    });

    it('should display payment method', () => {
      const method = fixture.nativeElement.querySelector('[data-testid="method-TXN-CASH-001"]');
      expect(method).toBeTruthy();
      expect(method.textContent).toContain('Cash');
    });

    it('should display item count', () => {
      const items = fixture.nativeElement.querySelector('[data-testid="items-TXN-CASH-001"]');
      expect(items).toBeTruthy();
      expect(items.textContent).toContain('3 items');
    });

    it('should display singular item for count of 1', () => {
      const items = fixture.nativeElement.querySelector('[data-testid="items-TXN-CASH-003"]');
      expect(items).toBeTruthy();
      expect(items.textContent).toContain('1 item');
    });

    it('should show footer with transaction count', () => {
      const footer = fixture.nativeElement.querySelector('[data-testid="history-footer"]');
      expect(footer).toBeTruthy();
      expect(footer.textContent).toContain('3 of 3');
    });
  });

  describe('transaction expansion', () => {
    beforeEach(() => {
      mockUseCase.result.set(mockResult);
      fixture.detectChanges();
    });

    it('should expand transaction details on click', () => {
      const card = fixture.nativeElement.querySelector('[data-testid="transaction-TXN-CASH-001"]');
      card.click();
      fixture.detectChanges();

      const details = fixture.nativeElement.querySelector('[data-testid="details-TXN-CASH-001"]');
      expect(details).toBeTruthy();
    });

    it('should show transaction ID in expanded details', () => {
      component.toggleTransaction('TXN-CASH-001');
      fixture.detectChanges();

      const details = fixture.nativeElement.querySelector('[data-testid="details-TXN-CASH-001"]');
      expect(details.textContent).toContain('TXN-CASH-001');
    });

    it('should show receipt number in expanded details when available', () => {
      component.toggleTransaction('TXN-CASH-001');
      fixture.detectChanges();

      const details = fixture.nativeElement.querySelector('[data-testid="details-TXN-CASH-001"]');
      expect(details.textContent).toContain('REC-001');
    });

    it('should collapse transaction on second click', () => {
      component.toggleTransaction('TXN-CASH-001');
      fixture.detectChanges();

      let details = fixture.nativeElement.querySelector('[data-testid="details-TXN-CASH-001"]');
      expect(details).toBeTruthy();

      component.toggleTransaction('TXN-CASH-001');
      fixture.detectChanges();

      details = fixture.nativeElement.querySelector('[data-testid="details-TXN-CASH-001"]');
      expect(details).toBeFalsy();
    });

    it('should only expand one transaction at a time', () => {
      component.toggleTransaction('TXN-CASH-001');
      fixture.detectChanges();

      component.toggleTransaction('TXN-CARD-002');
      fixture.detectChanges();

      const details1 = fixture.nativeElement.querySelector('[data-testid="details-TXN-CASH-001"]');
      const details2 = fixture.nativeElement.querySelector('[data-testid="details-TXN-CARD-002"]');
      expect(details1).toBeFalsy();
      expect(details2).toBeTruthy();
    });
  });

  describe('pagination', () => {
    it('should not show pagination when only one page', () => {
      mockUseCase.result.set(mockResult);
      fixture.detectChanges();

      const pagination = fixture.nativeElement.querySelector('[data-testid="pagination"]');
      expect(pagination).toBeFalsy();
    });

    it('should show pagination when multiple pages', () => {
      mockUseCase.result.set({
        ...mockResult,
        total: 25,
        totalPages: 3,
      });
      fixture.detectChanges();

      const pagination = fixture.nativeElement.querySelector('[data-testid="pagination"]');
      expect(pagination).toBeTruthy();
    });

    it('should display current page info', () => {
      mockUseCase.result.set({
        ...mockResult,
        total: 25,
        totalPages: 3,
      });
      fixture.detectChanges();

      const pageInfo = fixture.nativeElement.querySelector('[data-testid="page-info"]');
      expect(pageInfo.textContent).toContain('Page 1 of 3');
    });

    it('should disable previous button on first page', () => {
      mockUseCase.result.set({
        ...mockResult,
        total: 25,
        totalPages: 3,
      });
      fixture.detectChanges();

      const prevBtn = fixture.nativeElement.querySelector('[data-testid="btn-prev"]');
      expect(prevBtn.disabled).toBe(true);
    });

    it('should enable next button when not on last page', () => {
      mockUseCase.result.set({
        ...mockResult,
        total: 25,
        totalPages: 3,
      });
      fixture.detectChanges();

      const nextBtn = fixture.nativeElement.querySelector('[data-testid="btn-next"]');
      expect(nextBtn.disabled).toBe(false);
    });

    it('should navigate to next page on click', async () => {
      mockUseCase.result.set({
        ...mockResult,
        total: 25,
        totalPages: 3,
      });
      fixture.detectChanges();

      const nextBtn = fixture.nativeElement.querySelector('[data-testid="btn-next"]');
      nextBtn.click();
      await fixture.whenStable();

      expect(mockUseCase.execute).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
      });
    });
  });

  describe('navigation', () => {
    it('should have back to POS link', () => {
      fixture.detectChanges();

      const backLink = fixture.nativeElement.querySelector('[data-testid="back-to-pos"]');
      expect(backLink).toBeTruthy();
      expect(backLink.textContent).toContain('Back to POS');
    });
  });

  describe('getMethodIcon', () => {
    it('should return cash icon for cash method', () => {
      expect(component.getMethodIcon('cash')).toBe('💵');
    });

    it('should return card icon for card method', () => {
      expect(component.getMethodIcon('card')).toBe('💳');
    });

    it('should return mobile icon for mobile method', () => {
      expect(component.getMethodIcon('mobile')).toBe('📱');
    });

    it('should return unknown icon for unknown method', () => {
      expect(component.getMethodIcon('unknown')).toBe('❓');
    });

    it('should return default icon for unrecognized method', () => {
      expect(component.getMethodIcon('crypto')).toBe('💰');
    });
  });
});
