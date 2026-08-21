import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings.component';
import { LowStockSettingsService } from '@core/application/services/low-stock-settings.service';
import { ThemeService, Theme } from '@core/application/services/theme.service';
import { signal } from '@angular/core';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import {
  PasskeyAlreadyEnrolledError,
  QUICK_AUTH_ADMIN_PORT,
  WeakPinError,
} from '@core/application/auth/ports/quick-auth-admin.port';
import {
  PasskeyCancelledError,
  PasskeyUnavailableError,
  QUICK_AUTH_GATEWAY,
} from '@core/application/auth/ports/quick-auth.port';

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
  let mockQuickAuthAdmin: {
    enrollPasskey: ReturnType<typeof vi.fn>;
    listPasskeys: ReturnType<typeof vi.fn>;
    revokePasskey: ReturnType<typeof vi.fn>;
    setPin: ReturnType<typeof vi.fn>;
    clearPin: ReturnType<typeof vi.fn>;
  };
  let mockQuickAuth: {
    capabilities: ReturnType<typeof vi.fn>;
    signInWithPasskey: ReturnType<typeof vi.fn>;
    signInWithPin: ReturnType<typeof vi.fn>;
    listPinOperators: ReturnType<typeof vi.fn>;
  };
  let operatorId: ReturnType<typeof signal<string | null>>;

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

    mockQuickAuthAdmin = {
      enrollPasskey: vi.fn().mockResolvedValue({
        credentialId: 'cred-1',
        label: 'Counter till',
        createdAt: '2026-08-20T09:00:00.000Z',
        lastUsedAt: null,
      }),
      listPasskeys: vi.fn().mockResolvedValue([]),
      revokePasskey: vi.fn().mockResolvedValue(undefined),
      setPin: vi.fn().mockResolvedValue(undefined),
      clearPin: vi.fn().mockResolvedValue(undefined),
    };

    mockQuickAuth = {
      capabilities: vi.fn().mockResolvedValue({
        passkeySupported: true,
        passkeyEnrolledHere: false,
        pinAvailable: false,
      }),
      signInWithPasskey: vi.fn(),
      signInWithPin: vi.fn(),
      listPinOperators: vi.fn().mockResolvedValue([]),
    };

    operatorId = signal<string | null>('op-001');

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: LowStockSettingsService, useValue: mockSettingsService },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: QUICK_AUTH_ADMIN_PORT, useValue: mockQuickAuthAdmin },
        { provide: QUICK_AUTH_GATEWAY, useValue: mockQuickAuth },
        { provide: CurrentUserService, useValue: { operatorId } },
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

  // -------------------------------------------------------------------------
  // Sign-in on this device
  // -------------------------------------------------------------------------

  describe('sign-in methods', () => {
    /**
     * Render, and let every async read settle before anything is asserted.
     *
     * The first `detectChanges()` is what makes Angular call `ngOnInit` itself, so the
     * explicit call afterwards is a *second* run — deliberate, and the reason this is
     * shaped so carefully. Without settling in between, that second async read lands
     * mid-test and overwrites whatever the test just did. Calling it explicitly also
     * makes the helper re-runnable, for the tests that change a mock and re-read.
     */
    async function init(): Promise<void> {
      fixture.detectChanges();
      await fixture.whenStable();
      await component.ngOnInit();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('asks for a session before offering to set anything up', async () => {
      operatorId.set(null);
      await init();

      const page = fixture.nativeElement as HTMLElement;
      expect(page.querySelector('[data-testid="signin-needs-session"]')).toBeTruthy();
      expect(page.querySelector('[data-testid="btn-add-passkey"]')).toBeNull();
      expect(mockQuickAuthAdmin.listPasskeys).not.toHaveBeenCalled();
    });

    it('lists the passkeys already enrolled for the signed-in operator', async () => {
      mockQuickAuthAdmin.listPasskeys.mockResolvedValue([
        {
          credentialId: 'c1',
          label: 'Counter till',
          createdAt: '2026-08-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ]);
      await init();

      expect(mockQuickAuthAdmin.listPasskeys).toHaveBeenCalledWith('op-001');
      expect(component.passkeys()).toHaveLength(1);
      const list = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="passkey-list"]'
      );
      expect(list?.textContent).toContain('Counter till');
    });

    it('explains itself instead of offering enrollment on a device with no reader', async () => {
      mockQuickAuth.capabilities.mockResolvedValue({
        passkeySupported: false,
        passkeyEnrolledHere: false,
        pinAvailable: false,
      });
      await init();

      const page = fixture.nativeElement as HTMLElement;
      expect(page.querySelector('[data-testid="passkey-unsupported"]')).toBeTruthy();
      expect(page.querySelector('[data-testid="btn-add-passkey"]')).toBeNull();
    });

    it('enrolls a passkey and adds it to the list', async () => {
      await init();
      component.newPasskeyLabel.set('Counter till');

      await component.addPasskey();

      expect(mockQuickAuthAdmin.enrollPasskey).toHaveBeenCalledWith('op-001', 'Counter till');
      expect(component.passkeys().map((p) => p.label)).toEqual(['Counter till']);
      // The name field is emptied so the next enrollment starts clean.
      expect(component.newPasskeyLabel()).toBe('');
      expect(component.signinMessage()).toContain('can now sign you in');
    });

    it('trims the label before enrolling', async () => {
      await init();
      component.newPasskeyLabel.set('  Back office  ');
      await component.addPasskey();
      expect(mockQuickAuthAdmin.enrollPasskey).toHaveBeenCalledWith('op-001', 'Back office');
    });

    it('says nothing when the operator dismisses the OS prompt', async () => {
      mockQuickAuthAdmin.enrollPasskey.mockRejectedValue(new PasskeyCancelledError());
      await init();

      await component.addPasskey();

      expect(component.signinError()).toBeNull();
      expect(component.passkeys()).toEqual([]);
      expect(component.enrolling()).toBe(false);
    });

    it('reports an authenticator that already holds a key for this operator', async () => {
      mockQuickAuthAdmin.enrollPasskey.mockRejectedValue(new PasskeyAlreadyEnrolledError());
      await init();

      await component.addPasskey();

      expect(component.signinError()).toContain('already has a passkey');
    });

    it('points at the PIN when the device cannot add a passkey', async () => {
      mockQuickAuthAdmin.enrollPasskey.mockRejectedValue(new PasskeyUnavailableError());
      await init();

      await component.addPasskey();

      expect(component.signinError()).toContain('Set a PIN instead');
    });

    it('removes a passkey, and says only what it can honestly claim', async () => {
      mockQuickAuthAdmin.listPasskeys.mockResolvedValue([
        { credentialId: 'c1', label: 'Counter till', createdAt: null, lastUsedAt: null },
      ]);
      await init();

      await component.removePasskey('c1');

      expect(mockQuickAuthAdmin.revokePasskey).toHaveBeenCalledWith('c1');
      expect(component.passkeys()).toEqual([]);
      // The credential still exists in the OS keychain; the wording must not imply
      // we reached into it.
      expect(component.signinMessage()).toContain('no longer accept');
    });

    it('renders a passkey whose stored date could not be read', async () => {
      mockQuickAuthAdmin.listPasskeys.mockResolvedValue([
        { credentialId: 'c1', label: 'Mystery device', createdAt: null, lastUsedAt: null },
      ]);
      await init();

      const list = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="passkey-list"]'
      );
      expect(list?.textContent).toContain('Mystery device');
      expect(list?.textContent).toContain('Added earlier');
    });

    it('sets a PIN and clears the input afterwards', async () => {
      await init();
      component.newPin.set('4917');

      await component.savePin();

      expect(mockQuickAuthAdmin.setPin).toHaveBeenCalledWith('op-001', '4917');
      expect(component.hasPin()).toBe(true);
      // Never left sitting in an input a passer-by could reveal.
      expect(component.newPin()).toBe('');
      expect(component.signinMessage()).toBe('PIN saved.');
    });

    it('passes the policy’s own explanation through when a PIN is refused', async () => {
      mockQuickAuthAdmin.setPin.mockRejectedValue(new WeakPinError('too-guessable'));
      await init();
      component.newPin.set('1234');

      await component.savePin();

      expect(component.signinError()).toContain('too easy to guess');
      expect(component.hasPin()).toBe(false);
      expect(component.newPin()).toBe('');
    });

    it('knows this operator already has a PIN, and not someone else’s', async () => {
      mockQuickAuth.listPinOperators.mockResolvedValue([
        { operatorId: 'op-999', displayName: 'Someone Else' },
      ]);
      await init();
      expect(component.hasPin()).toBe(false);

      mockQuickAuth.listPinOperators.mockResolvedValue([
        { operatorId: 'op-001', displayName: 'Me' },
      ]);
      await init();
      expect(component.hasPin()).toBe(true);
    });

    it('removes a PIN', async () => {
      mockQuickAuth.listPinOperators.mockResolvedValue([
        { operatorId: 'op-001', displayName: 'Me' },
      ]);
      await init();
      expect(component.hasPin()).toBe(true);

      await component.removePin();

      expect(mockQuickAuthAdmin.clearPin).toHaveBeenCalledWith('op-001');
      expect(component.hasPin()).toBe(false);
      expect(component.signinMessage()).toBe('PIN removed.');
    });

    it('leaves the rest of the page working when reading sign-in methods fails', async () => {
      mockQuickAuth.capabilities.mockRejectedValue(new Error('storage exploded'));
      await init();

      // The threshold still loaded, and no banner shouts about a section that is
      // only one part of this page.
      expect(component.thresholdInput()).toBe(10);
      expect(component.signinError()).toBeNull();
    });

    it('ignores a second enrollment press while one is in flight', async () => {
      await init();
      component.enrolling.set(true);

      await component.addPasskey();

      expect(mockQuickAuthAdmin.enrollPasskey).not.toHaveBeenCalled();
    });
  });
});
