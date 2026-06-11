import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportsComponent } from './reports.component';
import {
  GetDailySalesReportUseCase,
  DailySalesReportResult,
} from '@core/application/use-cases/get-daily-sales-report.use-case';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

/**
 * ReportsComponent Unit Tests
 *
 * Tests the daily sales report UI component:
 * - Renders report data correctly
 * - Date filter presets work
 * - Loading/error states display
 * - Payment breakdown displays
 * - Currency formatting
 */
describe('ReportsComponent', () => {
  let component: ReportsComponent;
  let fixture: ComponentFixture<ReportsComponent>;
  let mockUseCase: {
    loading: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    result: ReturnType<typeof signal<DailySalesReportResult | null>>;
    execute: ReturnType<typeof vi.fn>;
  };

  const mockReport: DailySalesReportResult = {
    totalRevenue: 245.75,
    transactionCount: 5,
    averageTransactionValue: 49.15,
    paymentBreakdown: {
      cash: 120.5,
      card: 125.25,
      mobile: 0,
      cashCount: 2,
      cardCount: 3,
      mobileCount: 0,
    },
    startDate: new Date('2026-06-09T00:00:00'),
    endDate: new Date('2026-06-09T23:59:59.999'),
  };

  beforeEach(async () => {
    mockUseCase = {
      loading: signal(false),
      error: signal(null),
      result: signal(null),
      execute: vi.fn().mockResolvedValue(mockReport),
    };

    await TestBed.configureTestingModule({
      imports: [ReportsComponent],
      providers: [
        provideRouter([]),
        { provide: GetDailySalesReportUseCase, useValue: mockUseCase },
        { provide: 'ITransactionRepository', useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportsComponent);
    component = fixture.componentInstance;
  });

  // =========================================================================
  // Rendering
  // =========================================================================
  describe('Rendering', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should render the reports page container', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="reports-page"]');
      expect(el).toBeTruthy();
    });

    it('should render the page title', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('h1');
      expect(el.textContent).toContain('Daily Sales Report');
    });

    it('should render back to POS link', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="back-to-pos"]');
      expect(el).toBeTruthy();
      expect(el.textContent).toContain('Back to POS');
    });

    it('should render date filter section', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="date-filter"]');
      expect(el).toBeTruthy();
    });
  });

  // =========================================================================
  // Report Data Display
  // =========================================================================
  describe('Report Data Display', () => {
    beforeEach(() => {
      mockUseCase.result.set(mockReport);
      fixture.detectChanges();
    });

    it('should display total revenue', () => {
      const el = fixture.nativeElement.querySelector('[data-testid="value-revenue"]');
      expect(el.textContent.trim()).toBe('$245.75');
    });

    it('should display transaction count', () => {
      const el = fixture.nativeElement.querySelector('[data-testid="value-transactions"]');
      expect(el.textContent.trim()).toBe('5');
    });

    it('should display average transaction value', () => {
      const el = fixture.nativeElement.querySelector('[data-testid="value-average"]');
      expect(el.textContent.trim()).toBe('$49.15');
    });

    it('should display cash breakdown total', () => {
      const el = fixture.nativeElement.querySelector('[data-testid="cash-total"]');
      expect(el.textContent.trim()).toBe('$120.50');
    });

    it('should display card breakdown total', () => {
      const el = fixture.nativeElement.querySelector('[data-testid="card-total"]');
      expect(el.textContent.trim()).toBe('$125.25');
    });

    it('should display cash transaction count', () => {
      const el = fixture.nativeElement.querySelector('[data-testid="cash-count"]');
      expect(el.textContent).toContain('2 transactions');
    });

    it('should display card transaction count', () => {
      const el = fixture.nativeElement.querySelector('[data-testid="card-count"]');
      expect(el.textContent).toContain('3 transactions');
    });

    it('should display summary cards section', () => {
      const el = fixture.nativeElement.querySelector('[data-testid="summary-cards"]');
      expect(el).toBeTruthy();
    });

    it('should display payment breakdown section', () => {
      const el = fixture.nativeElement.querySelector('[data-testid="payment-breakdown"]');
      expect(el).toBeTruthy();
    });
  });

  // =========================================================================
  // Loading State
  // =========================================================================
  describe('Loading State', () => {
    it('should show loading indicator when loading', () => {
      mockUseCase.loading.set(true);
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="loading-indicator"]');
      expect(el).toBeTruthy();
    });

    it('should hide loading indicator when not loading', () => {
      mockUseCase.loading.set(false);
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="loading-indicator"]');
      expect(el).toBeFalsy();
    });
  });

  // =========================================================================
  // Error State
  // =========================================================================
  describe('Error State', () => {
    it('should show error message when error exists', () => {
      mockUseCase.error.set('Database connection failed');
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="error-message"]');
      expect(el).toBeTruthy();
      expect(el.textContent).toContain('Database connection failed');
    });

    it('should show retry button on error', () => {
      mockUseCase.error.set('Some error');
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="btn-retry"]');
      expect(el).toBeTruthy();
    });

    it('should not show error when no error', () => {
      mockUseCase.error.set(null);
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="error-message"]');
      expect(el).toBeFalsy();
    });
  });

  // =========================================================================
  // Date Filter
  // =========================================================================
  describe('Date Filter', () => {
    it('should default to today preset', () => {
      fixture.detectChanges();
      expect(component.activePreset()).toBe('today');
    });

    it('should call execute on init (today)', () => {
      fixture.detectChanges();
      expect(mockUseCase.execute).toHaveBeenCalled();
    });

    it('should switch to yesterday preset', () => {
      fixture.detectChanges();
      component.selectPreset('yesterday');
      expect(component.activePreset()).toBe('yesterday');
      expect(mockUseCase.execute).toHaveBeenCalledTimes(2);
    });

    it('should switch to custom preset without loading', () => {
      fixture.detectChanges();
      const callsBefore = mockUseCase.execute.mock.calls.length;
      component.selectPreset('custom');
      expect(component.activePreset()).toBe('custom');
      // Should NOT call execute when switching to custom (user needs to pick dates)
      expect(mockUseCase.execute).toHaveBeenCalledTimes(callsBefore);
    });

    it('should show custom date inputs when custom is selected', () => {
      component.selectPreset('custom');
      fixture.detectChanges();
      const startInput = fixture.nativeElement.querySelector('[data-testid="input-start-date"]');
      const endInput = fixture.nativeElement.querySelector('[data-testid="input-end-date"]');
      expect(startInput).toBeTruthy();
      expect(endInput).toBeTruthy();
    });

    it('should call execute when apply custom is clicked', () => {
      fixture.detectChanges();
      component.selectPreset('custom');
      const callsBefore = mockUseCase.execute.mock.calls.length;
      component.applyCustomRange();
      expect(mockUseCase.execute).toHaveBeenCalledTimes(callsBefore + 1);
    });
  });

  // =========================================================================
  // Empty State
  // =========================================================================
  describe('Empty State', () => {
    it('should show empty state when transaction count is 0', () => {
      mockUseCase.result.set({
        ...mockReport,
        transactionCount: 0,
        totalRevenue: 0,
        averageTransactionValue: 0,
        paymentBreakdown: {
          cash: 0,
          card: 0,
          mobile: 0,
          cashCount: 0,
          cardCount: 0,
          mobileCount: 0,
        },
      });
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="empty-state"]');
      expect(el).toBeTruthy();
      expect(el.textContent).toContain('No transactions for this period');
    });

    it('should not show empty state when transactions exist', () => {
      mockUseCase.result.set(mockReport);
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('[data-testid="empty-state"]');
      expect(el).toBeFalsy();
    });
  });

  // =========================================================================
  // Currency Formatting
  // =========================================================================
  describe('Currency Formatting', () => {
    it('should format currency with dollar sign and 2 decimals', () => {
      expect(component.formatCurrency(42.5)).toBe('$42.50');
    });

    it('should format zero correctly', () => {
      expect(component.formatCurrency(0)).toBe('$0.00');
    });

    it('should format large numbers correctly', () => {
      expect(component.formatCurrency(1234.56)).toBe('$1234.56');
    });
  });

  // =========================================================================
  // Refresh
  // =========================================================================
  describe('Refresh', () => {
    it('should call execute when refresh is called', () => {
      fixture.detectChanges();
      const callsBefore = mockUseCase.execute.mock.calls.length;
      component.refresh();
      expect(mockUseCase.execute).toHaveBeenCalledTimes(callsBefore + 1);
    });
  });
});
