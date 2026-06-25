import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings.component';
import { LowStockSettingsService } from '@core/application/services/low-stock-settings.service';
import { ThemeService, Theme } from '@core/application/services/theme.service';
import { signal } from '@angular/core';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let mockSettingsService: {
    loadThreshold: ReturnType<typeof vi.fn>;
    saveThreshold: ReturnType<typeof vi.fn>;
    threshold: ReturnType<typeof signal<number>>;
    loading: ReturnType<typeof signal<boolean>>;
    getThreshold: ReturnType<typeof vi.fn>;
  };
  let mockThemeService: {
    theme: ReturnType<typeof signal<Theme>>;
    toggleTheme: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockSettingsService = {
      loadThreshold: vi.fn().mockResolvedValue(10),
      saveThreshold: vi.fn().mockResolvedValue(undefined),
      threshold: signal(10),
      loading: signal(false),
      getThreshold: vi.fn().mockReturnValue(10),
    };

    mockThemeService = {
      theme: signal<Theme>('light'),
      toggleTheme: vi.fn().mockImplementation(async () => {
        mockThemeService.theme.set(mockThemeService.theme() === 'dark' ? 'light' : 'dark');
      }),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: LowStockSettingsService, useValue: mockSettingsService },
        { provide: ThemeService, useValue: mockThemeService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load threshold on init', async () => {
    await component.ngOnInit();
    expect(mockSettingsService.loadThreshold).toHaveBeenCalled();
    expect(component.thresholdInput()).toBe(10);
  });

  it('should display settings page with correct title', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="settings-page"]')).toBeTruthy();
    expect(compiled.querySelector('h1')?.textContent).toContain('Settings');
  });

  it('should display low stock settings section', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="low-stock-settings"]')).toBeTruthy();
  });

  it('should increase threshold when + button clicked', () => {
    component.thresholdInput.set(10);
    component.increaseThreshold();
    expect(component.thresholdInput()).toBe(11);
  });

  it('should decrease threshold when - button clicked', () => {
    component.thresholdInput.set(10);
    component.decreaseThreshold();
    expect(component.thresholdInput()).toBe(9);
  });

  it('should not decrease below 1', () => {
    component.thresholdInput.set(1);
    component.decreaseThreshold();
    expect(component.thresholdInput()).toBe(1);
  });

  it('should not increase above 999', () => {
    component.thresholdInput.set(999);
    component.increaseThreshold();
    expect(component.thresholdInput()).toBe(999);
  });

  it('should save threshold and show success message', async () => {
    component.thresholdInput.set(15);
    await component.saveThreshold();

    expect(mockSettingsService.saveThreshold).toHaveBeenCalledWith(15);
    expect(component.saveSuccess()).toBe(true);
    expect(component.saveError()).toBeNull();
  });

  it('should show error message on save failure', async () => {
    mockSettingsService.saveThreshold.mockRejectedValue(new Error('DB error'));
    component.thresholdInput.set(15);

    await component.saveThreshold();

    expect(component.saveSuccess()).toBe(false);
    expect(component.saveError()).toBe('DB error');
  });

  it('should render threshold input with current value', async () => {
    await component.ngOnInit();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '[data-testid="input-threshold"]'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  describe('dark mode', () => {
    it('should display the appearance section with a toggle', () => {
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('[data-testid="appearance-settings"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="btn-toggle-dark-mode"]')).toBeTruthy();
    });

    it('should report dark mode off when theme is light', () => {
      mockThemeService.theme.set('light');
      expect(component.isDark()).toBe(false);
    });

    it('should report dark mode on when theme is dark', () => {
      mockThemeService.theme.set('dark');
      expect(component.isDark()).toBe(true);
    });

    it('should delegate toggling to the ThemeService', async () => {
      await component.toggleDarkMode();
      expect(mockThemeService.toggleTheme).toHaveBeenCalled();
      expect(component.isDark()).toBe(true);
    });

    it('should reflect the active state on the switch via aria-checked', () => {
      mockThemeService.theme.set('dark');
      fixture.detectChanges();

      const toggle = fixture.nativeElement.querySelector(
        '[data-testid="btn-toggle-dark-mode"]'
      ) as HTMLButtonElement;
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });
});
