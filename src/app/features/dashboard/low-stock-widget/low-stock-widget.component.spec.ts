import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LowStockWidgetComponent } from './low-stock-widget.component';
import { GetLowStockAlertsUseCase } from '@core/application/use-cases/get-low-stock-alerts.use-case';
import { LowStockSettingsService } from '@core/application/services/low-stock-settings.service';
import { Router } from '@angular/router';
import { signal } from '@angular/core';

describe('LowStockWidgetComponent', () => {
  let component: LowStockWidgetComponent;
  let fixture: ComponentFixture<LowStockWidgetComponent>;
  let mockUseCase: {
    execute: ReturnType<typeof vi.fn>;
    loading: ReturnType<typeof signal>;
    error: ReturnType<typeof signal>;
    alertCount: ReturnType<typeof signal>;
  };
  let mockSettings: {
    loadThreshold: ReturnType<typeof vi.fn>;
    threshold: ReturnType<typeof signal>;
    loading: ReturnType<typeof signal>;
  };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockUseCase = {
      execute: vi.fn().mockResolvedValue({
        alerts: [
          {
            productId: '1',
            productName: 'Seasonal Blend',
            currentStock: 0,
            threshold: 10,
            category: 'Beverages',
            severity: 'critical',
          },
          {
            productId: '2',
            productName: 'Muffin',
            currentStock: 3,
            threshold: 10,
            category: 'Food',
            severity: 'warning',
          },
        ],
        totalCount: 2,
        criticalCount: 1,
        warningCount: 1,
      }),
      loading: signal(false),
      error: signal(null),
      alertCount: signal(2),
    };

    mockSettings = {
      loadThreshold: vi.fn().mockResolvedValue(10),
      threshold: signal(10),
      loading: signal(false),
    };

    mockRouter = {
      navigate: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [LowStockWidgetComponent],
      providers: [
        { provide: GetLowStockAlertsUseCase, useValue: mockUseCase },
        { provide: LowStockSettingsService, useValue: mockSettings },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LowStockWidgetComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load alerts on init', async () => {
    await component.ngOnInit();
    expect(mockSettings.loadThreshold).toHaveBeenCalled();
    expect(mockUseCase.execute).toHaveBeenCalledWith(10);
  });

  it('should display alert count after loading', async () => {
    await component.ngOnInit();
    expect(component.totalCount()).toBe(2);
    expect(component.criticalCount()).toBe(1);
    expect(component.warningCount()).toBe(1);
  });

  it('should show top 3 alerts', async () => {
    await component.ngOnInit();
    expect(component.topAlerts().length).toBe(2);
    expect(component.topAlerts()[0].productName).toBe('Seasonal Blend');
  });

  it('should show healthy state when no alerts', async () => {
    mockUseCase.execute.mockResolvedValue({
      alerts: [],
      totalCount: 0,
      criticalCount: 0,
      warningCount: 0,
    });

    await component.ngOnInit();

    expect(component.totalCount()).toBe(0);
    expect(component.criticalCount()).toBe(0);
    expect(component.warningCount()).toBe(0);
    expect(component.loading()).toBe(false);
  });

  it('should navigate to inventory on button click', async () => {
    await component.ngOnInit();
    component.navigateToInventory();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/inventory'], {
      queryParams: { filter: 'low-stock' },
    });
  });

  it('should set loading to false after load completes', async () => {
    await component.ngOnInit();
    expect(component.loading()).toBe(false);
  });

  it('should render widget container', async () => {
    await component.ngOnInit();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="low-stock-widget"]')).toBeTruthy();
  });

  it('should show alert summary when alerts exist', async () => {
    await component.ngOnInit();

    expect(component.totalCount()).toBe(2);
    expect(component.criticalCount()).toBe(1);
    expect(component.warningCount()).toBe(1);
    expect(component.topAlerts().length).toBe(2);
  });
});
