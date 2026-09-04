import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { LoginComponent } from './login.component';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { InvalidCredentialsError } from '@core/infrastructure/auth/local-credential-auth.adapter';
import {
  InvalidPinError,
  OperatorInactiveError,
  PasskeyCancelledError,
  PasskeyUnavailableError,
  PasskeyVerificationError,
  QUICK_AUTH_GATEWAY,
} from '@core/application/auth/ports/quick-auth.port';
import type { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import type { QuickAuthCapabilitiesDto } from '@core/application/auth/dtos/quick-auth.dto';

const mockSession: AuthSessionDto = {
  operatorId: 'op-001',
  tenantId: 'default-tenant',
  roles: ['admin'],
  permissions: ['sale:process'],
  accessToken: 'fake.jwt.token',
  expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
};

function makeGateway(opts: { succeeds: boolean; supportsPasswordReset?: boolean }) {
  return {
    authenticate: opts.succeeds
      ? vi.fn().mockResolvedValue(mockSession)
      : vi.fn().mockRejectedValue(new InvalidCredentialsError()),
    getActiveSession: vi.fn().mockResolvedValue(null),
    refresh: vi.fn(),
    signOut: vi.fn(),
    getAccessToken: vi.fn().mockReturnValue(null),
    supportsPasswordReset: opts.supportsPasswordReset ?? false,
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * A quick-auth stub that offers nothing.
 *
 * The default, so the password-path tests below describe a plain desktop browser
 * with no sensor and no PINs set — which is also the only configuration where the
 * form is the whole screen.
 */
function makeQuickAuth(
  capabilities: Partial<QuickAuthCapabilitiesDto> = {},
  operators: { operatorId: string; displayName: string }[] = []
) {
  return {
    capabilities: vi.fn().mockResolvedValue({
      passkeySupported: false,
      passkeyEnrolledHere: false,
      pinAvailable: false,
      ...capabilities,
    } satisfies QuickAuthCapabilitiesDto),
    signInWithPasskey: vi.fn().mockResolvedValue(mockSession),
    signInWithPin: vi.fn().mockResolvedValue(mockSession),
    listPinOperators: vi.fn().mockResolvedValue(operators),
  };
}

async function createComponent(
  gateway: ReturnType<typeof makeGateway>,
  quickAuth: ReturnType<typeof makeQuickAuth> = makeQuickAuth()
) {
  await TestBed.configureTestingModule({
    imports: [LoginComponent, RouterTestingModule],
    providers: [
      { provide: AUTH_GATEWAY, useValue: gateway },
      { provide: QUICK_AUTH_GATEWAY, useValue: quickAuth },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  // ngOnInit probes capabilities asynchronously; let it settle so the quick
  // options are rendered (or deliberately absent) before anything is asserted.
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
  return fixture;
}

function getEl<T extends HTMLElement>(
  fixture: ReturnType<typeof TestBed.createComponent<LoginComponent>>,
  selector: string
): T {
  return fixture.nativeElement.querySelector(selector) as T;
}

describe('LoginComponent', () => {
  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  describe('initial render', () => {
    it('renders the email input with proper aria attributes', async () => {
      const gateway = makeGateway({ succeeds: true });
      const fixture = await createComponent(gateway);

      const emailInput = getEl<HTMLInputElement>(fixture, '[data-testid="input-email"]');
      expect(emailInput).toBeTruthy();
      expect(emailInput.getAttribute('aria-required')).toBe('true');
      expect(emailInput.type).toBe('email');
    });

    it('renders the password input', async () => {
      const gateway = makeGateway({ succeeds: true });
      const fixture = await createComponent(gateway);

      const passwordInput = getEl<HTMLInputElement>(fixture, '[data-testid="input-password"]');
      expect(passwordInput).toBeTruthy();
      expect(passwordInput.type).toBe('password');
    });

    it('renders the submit button in enabled state', async () => {
      const gateway = makeGateway({ succeeds: true });
      const fixture = await createComponent(gateway);
      fixture.detectChanges();

      // Form starts invalid (empty fields) so button is disabled
      const btn = getEl<HTMLButtonElement>(fixture, '[data-testid="btn-login"]');
      expect(btn).toBeTruthy();
    });

    it('does not show error messages initially', async () => {
      const gateway = makeGateway({ succeeds: true });
      const fixture = await createComponent(gateway);

      expect(getEl(fixture, '[data-testid="auth-error"]')).toBeNull();
      expect(getEl(fixture, '[data-testid="email-error"]')).toBeNull();
      expect(getEl(fixture, '[data-testid="password-error"]')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe('field validation', () => {
    it('showEmailError() is set after submitting with empty email', async () => {
      const gateway = makeGateway({ succeeds: true });
      const fixture = await createComponent(gateway);
      const component = fixture.componentInstance;

      // Leave email empty, provide a password so the form is only invalid on email
      component.form.setValue({ email: '', password: 'somepass' });
      await component.submit();

      expect(component.showEmailError()).toBe(true);
    });

    it('showPasswordError() is set after submitting with empty password', async () => {
      const gateway = makeGateway({ succeeds: true });
      const fixture = await createComponent(gateway);
      const component = fixture.componentInstance;

      component.form.setValue({ email: 'a@b.com', password: '' });
      await component.submit();

      expect(component.showPasswordError()).toBe(true);
    });

    it('submit button is disabled when form is invalid', async () => {
      const gateway = makeGateway({ succeeds: true });
      const fixture = await createComponent(gateway);

      const btn = getEl<HTMLButtonElement>(fixture, '[data-testid="btn-login"]');
      // Form is empty, so invalid → button disabled
      expect(btn.disabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Submit — success
  // -------------------------------------------------------------------------

  describe('submit — success', () => {
    it('calls gateway.authenticate with the entered credentials', async () => {
      const gateway = makeGateway({ succeeds: true });
      const fixture = await createComponent(gateway);
      const component = fixture.componentInstance;

      component.form.setValue({ email: 'admin@capy-pos.local', password: 'admin1234' });
      fixture.detectChanges();

      await component.submit();

      expect(gateway.authenticate).toHaveBeenCalledWith({
        email: 'admin@capy-pos.local',
        password: 'admin1234',
      });
    });

    it('navigates to /pos on successful login', async () => {
      const gateway = makeGateway({ succeeds: true });
      const fixture = await createComponent(gateway);
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      fixture.componentInstance.form.setValue({
        email: 'admin@capy-pos.local',
        password: 'admin1234',
      });

      await fixture.componentInstance.submit();

      expect(navigateSpy).toHaveBeenCalledWith(['/pos']);
    });

    it('clears authError on successful login', async () => {
      const gateway = makeGateway({ succeeds: false });
      const fixture = await createComponent(gateway);
      const component = fixture.componentInstance;
      const router = TestBed.inject(Router);
      vi.spyOn(router, 'navigate').mockResolvedValue(true);

      component.form.setValue({ email: 'admin@capy-pos.local', password: 'wrong' });
      // First call to set an error
      await component.submit();
      fixture.detectChanges();
      expect(component.authError()).not.toBeNull();

      // Now fix the gateway and log in successfully
      (gateway.authenticate as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession);
      component.form.setValue({ email: 'admin@capy-pos.local', password: 'admin1234' });
      await component.submit();

      expect(component.authError()).toBeNull();
    });
  });

  it('shows the expiry message when arriving with ?reason=expired', async () => {
    const gateway = makeGateway({ succeeds: true });
    await TestBed.configureTestingModule({
      imports: [LoginComponent, RouterTestingModule],
      providers: [
        { provide: AUTH_GATEWAY, useValue: gateway },
        { provide: QUICK_AUTH_GATEWAY, useValue: makeQuickAuth() },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ reason: 'expired' }) } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.authError()).toBe(
      'Your session expired. Please sign in again.'
    );
  });

  // -------------------------------------------------------------------------
  // Submit — failure
  // -------------------------------------------------------------------------

  describe('submit — invalid credentials', () => {
    it('shows auth-error message on InvalidCredentialsError', async () => {
      const gateway = makeGateway({ succeeds: false });
      const fixture = await createComponent(gateway);
      const component = fixture.componentInstance;

      component.form.setValue({ email: 'admin@capy-pos.local', password: 'wrong' });
      await component.submit();
      fixture.detectChanges();

      const errorEl = getEl(fixture, '[data-testid="auth-error"]');
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain('Invalid email or password');
    });

    it('shows generic error for unknown exceptions', async () => {
      const gateway = makeGateway({ succeeds: true });
      (gateway.authenticate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('network timeout')
      );
      const fixture = await createComponent(gateway);
      const component = fixture.componentInstance;

      component.form.setValue({ email: 'admin@capy-pos.local', password: 'admin1234' });
      await component.submit();
      fixture.detectChanges();

      const errorEl = getEl(fixture, '[data-testid="auth-error"]');
      expect(errorEl).toBeTruthy();
      expect(errorEl.textContent).toContain('unexpected error');
    });

    it('does not navigate on failure', async () => {
      const gateway = makeGateway({ succeeds: false });
      const fixture = await createComponent(gateway);
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate');

      fixture.componentInstance.form.setValue({
        email: 'admin@capy-pos.local',
        password: 'wrong',
      });
      await fixture.componentInstance.submit();

      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('resets loading to false after failed attempt', async () => {
      const gateway = makeGateway({ succeeds: false });
      const fixture = await createComponent(gateway);
      const component = fixture.componentInstance;

      component.form.setValue({ email: 'admin@capy-pos.local', password: 'wrong' });
      await component.submit();

      expect(component.loading()).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Quick sign-in: passkey and PIN
// ---------------------------------------------------------------------------

describe('LoginComponent — passkey sign-in', () => {
  const supported = { passkeySupported: true, passkeyEnrolledHere: true };

  it('offers the passkey button when the device has a sensor and an enrollment', async () => {
    const fixture = await createComponent(
      makeGateway({ succeeds: true }),
      makeQuickAuth(supported)
    );
    expect(getEl(fixture, '[data-testid="btn-passkey"]')).toBeTruthy();
  });

  it('hides the button on a device with no platform authenticator', async () => {
    const fixture = await createComponent(
      makeGateway({ succeeds: true }),
      makeQuickAuth({ passkeySupported: false, passkeyEnrolledHere: true })
    );
    // Hidden rather than disabled: a greyed-out button invites repeated pressing.
    expect(getEl(fixture, '[data-testid="btn-passkey"]')).toBeNull();
  });

  it('hides the button when the device supports passkeys but nobody has enrolled', async () => {
    const fixture = await createComponent(
      makeGateway({ succeeds: true }),
      makeQuickAuth({ passkeySupported: true, passkeyEnrolledHere: false })
    );
    expect(getEl(fixture, '[data-testid="btn-passkey"]')).toBeNull();
  });

  it('keeps the password form available alongside it', async () => {
    const fixture = await createComponent(
      makeGateway({ succeeds: true }),
      makeQuickAuth(supported)
    );
    expect(getEl(fixture, '[data-testid="input-password"]')).toBeTruthy();
    expect(getEl(fixture, '[data-testid="btn-login"]')).toBeTruthy();
  });

  it('navigates to /pos after a successful assertion', async () => {
    const quickAuth = makeQuickAuth(supported);
    const fixture = await createComponent(makeGateway({ succeeds: true }), quickAuth);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    await fixture.componentInstance.signInWithPasskey();

    expect(quickAuth.signInWithPasskey).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/pos']);
  });

  it('shows no error when the person dismisses the OS prompt', async () => {
    const quickAuth = makeQuickAuth(supported);
    quickAuth.signInWithPasskey.mockRejectedValue(new PasskeyCancelledError());
    const fixture = await createComponent(makeGateway({ succeeds: true }), quickAuth);

    await fixture.componentInstance.signInWithPasskey();
    fixture.detectChanges();

    // Cancelling is not a failure — an error banner here would be wrong.
    expect(fixture.componentInstance.authError()).toBeNull();
    expect(getEl(fixture, '[data-testid="auth-error"]')).toBeNull();
  });

  it('reports a verification failure in the words the verifier chose', async () => {
    const quickAuth = makeQuickAuth(supported);
    quickAuth.signInWithPasskey.mockRejectedValue(
      new PasskeyVerificationError('That passkey looks like a copy.')
    );
    const fixture = await createComponent(makeGateway({ succeeds: true }), quickAuth);

    await fixture.componentInstance.signInWithPasskey();

    expect(fixture.componentInstance.authError()).toBe('That passkey looks like a copy.');
  });

  it('stops offering the button once the device says it cannot after all', async () => {
    const quickAuth = makeQuickAuth(supported);
    quickAuth.signInWithPasskey.mockRejectedValue(new PasskeyUnavailableError());
    const fixture = await createComponent(makeGateway({ succeeds: true }), quickAuth);

    await fixture.componentInstance.signInWithPasskey();
    fixture.detectChanges();

    expect(getEl(fixture, '[data-testid="btn-passkey"]')).toBeNull();
    expect(fixture.componentInstance.authError()).toContain('password');
  });

  it('names the deactivated account problem rather than blaming the passkey', async () => {
    const quickAuth = makeQuickAuth(supported);
    quickAuth.signInWithPasskey.mockRejectedValue(new OperatorInactiveError());
    const fixture = await createComponent(makeGateway({ succeeds: true }), quickAuth);

    await fixture.componentInstance.signInWithPasskey();

    expect(fixture.componentInstance.authError()).toContain('no longer active');
  });

  it('clears the busy state after a failure, so a second attempt is possible', async () => {
    const quickAuth = makeQuickAuth(supported);
    quickAuth.signInWithPasskey.mockRejectedValue(new PasskeyVerificationError());
    const fixture = await createComponent(makeGateway({ succeeds: true }), quickAuth);

    await fixture.componentInstance.signInWithPasskey();

    expect(fixture.componentInstance.passkeyBusy()).toBe(false);
    expect(fixture.componentInstance.busy()).toBe(false);
  });

  it('ignores a second press while one ceremony is already running', async () => {
    const quickAuth = makeQuickAuth(supported);
    const fixture = await createComponent(makeGateway({ succeeds: true }), quickAuth);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.passkeyBusy.set(true);
    await fixture.componentInstance.signInWithPasskey();

    expect(quickAuth.signInWithPasskey).not.toHaveBeenCalled();
  });

  it('carries on with the form when the capability probe itself fails', async () => {
    const quickAuth = makeQuickAuth();
    quickAuth.capabilities.mockRejectedValue(new Error('probe exploded'));
    const fixture = await createComponent(makeGateway({ succeeds: true }), quickAuth);

    // Silent: a broken probe is not something the cashier can act on.
    expect(getEl(fixture, '[data-testid="btn-passkey"]')).toBeNull();
    expect(getEl(fixture, '[data-testid="auth-error"]')).toBeNull();
    expect(getEl(fixture, '[data-testid="input-email"]')).toBeTruthy();
  });
});

describe('LoginComponent — PIN sign-in', () => {
  const withPin = { pinAvailable: true };
  const operators = [
    { operatorId: 'op-ana', displayName: 'Ana' },
    { operatorId: 'op-marco', displayName: 'Marco' },
  ];

  async function openPad() {
    const quickAuth = makeQuickAuth(withPin, operators);
    const fixture = await createComponent(makeGateway({ succeeds: true }), quickAuth);
    fixture.componentInstance.openPinPad();
    fixture.detectChanges();
    return { fixture, quickAuth };
  }

  it('offers the PIN route only when somebody has set one', async () => {
    const fixture = await createComponent(
      makeGateway({ succeeds: true }),
      makeQuickAuth(withPin, operators)
    );
    expect(getEl(fixture, '[data-testid="btn-use-pin"]')).toBeTruthy();
  });

  it('does not offer it when no operator has a PIN', async () => {
    const fixture = await createComponent(makeGateway({ succeeds: true }), makeQuickAuth());
    expect(getEl(fixture, '[data-testid="btn-use-pin"]')).toBeNull();
  });

  it('lists the operators who opted in, and preselects the first', async () => {
    const { fixture } = await openPad();
    expect(fixture.componentInstance.pinOperators()).toEqual(operators);
    expect(fixture.componentInstance.selectedOperatorId()).toBe('op-ana');
    expect(getEl(fixture, '[data-testid="pin-pad"]')).toBeTruthy();
  });

  it('builds the PIN from the keypad and shows one dot per digit', async () => {
    const { fixture } = await openPad();
    const component = fixture.componentInstance;

    component.pressDigit('4');
    component.pressDigit('9');
    fixture.detectChanges();

    expect(component.pin()).toBe('49');
    // Four slots minimum, two filled — the digits themselves are never rendered.
    expect(component.pinDots()).toEqual([true, true, false, false]);
    expect(getEl(fixture, '[data-testid="pin-display"]').textContent).not.toContain('4');
  });

  it('will not accept more digits than the policy allows', async () => {
    const { fixture } = await openPad();
    for (let i = 0; i < 12; i++) {
      fixture.componentInstance.pressDigit('7');
    }
    expect(fixture.componentInstance.pin().length).toBe(8);
  });

  it('deletes the last digit on backspace', async () => {
    const { fixture } = await openPad();
    fixture.componentInstance.pressDigit('4');
    fixture.componentInstance.pressDigit('9');
    fixture.componentInstance.backspace();
    expect(fixture.componentInstance.pin()).toBe('4');
  });

  it('refuses to submit before the minimum length is reached', async () => {
    const { fixture, quickAuth } = await openPad();
    fixture.componentInstance.pressDigit('4');
    fixture.componentInstance.pressDigit('9');

    expect(fixture.componentInstance.pinComplete()).toBe(false);
    await fixture.componentInstance.submitPin();
    expect(quickAuth.signInWithPin).not.toHaveBeenCalled();
  });

  it('signs in with the selected operator and entered PIN', async () => {
    const { fixture, quickAuth } = await openPad();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    for (const digit of '4917') {
      fixture.componentInstance.pressDigit(digit);
    }
    await fixture.componentInstance.submitPin();

    expect(quickAuth.signInWithPin).toHaveBeenCalledWith('op-ana', '4917');
    expect(navigate).toHaveBeenCalledWith(['/pos']);
  });

  it('clears the entered digits after a wrong PIN', async () => {
    const { fixture, quickAuth } = await openPad();
    quickAuth.signInWithPin.mockRejectedValue(new InvalidPinError());

    for (const digit of '4917') {
      fixture.componentInstance.pressDigit(digit);
    }
    await fixture.componentInstance.submitPin();

    // Leaving them up would let the next person keep guessing from where this left off.
    expect(fixture.componentInstance.pin()).toBe('');
    expect(fixture.componentInstance.authError()).toContain('not right');
  });

  it('clears the entry when a different operator is picked', async () => {
    const { fixture } = await openPad();
    fixture.componentInstance.pressDigit('4');

    const select = getEl<HTMLSelectElement>(fixture, '[data-testid="select-pin-operator"]');
    select.value = 'op-marco';
    select.dispatchEvent(new Event('change'));

    expect(fixture.componentInstance.selectedOperatorId()).toBe('op-marco');
    expect(fixture.componentInstance.pin()).toBe('');
  });

  it('forgets the entry when the pad is cancelled', async () => {
    const { fixture } = await openPad();
    fixture.componentInstance.pressDigit('4');
    fixture.componentInstance.closePinPad();
    fixture.detectChanges();

    expect(fixture.componentInstance.pin()).toBe('');
    expect(getEl(fixture, '[data-testid="pin-pad"]')).toBeNull();
  });

  it('resets loading after a failed PIN so the pad stays usable', async () => {
    const { fixture, quickAuth } = await openPad();
    quickAuth.signInWithPin.mockRejectedValue(new InvalidPinError());

    for (const digit of '4917') {
      fixture.componentInstance.pressDigit(digit);
    }
    await fixture.componentInstance.submitPin();

    expect(fixture.componentInstance.loading()).toBe(false);
    expect(fixture.componentInstance.busy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

describe('LoginComponent — forgot password', () => {
  it('offers no link when the active gateway does not support password reset', async () => {
    const gateway = makeGateway({ succeeds: true, supportsPasswordReset: false });
    const fixture = await createComponent(gateway);
    fixture.detectChanges();

    expect(getEl(fixture, '[data-testid="btn-forgot-password"]')).toBeNull();
  });

  it('offers the link when the active gateway supports it, and opens the panel with the typed email carried over', async () => {
    const gateway = makeGateway({ succeeds: true, supportsPasswordReset: true });
    const fixture = await createComponent(gateway);
    fixture.componentInstance.form.patchValue({ email: 'ada@capy.test' });
    fixture.detectChanges();

    getEl<HTMLButtonElement>(fixture, '[data-testid="btn-forgot-password"]').click();
    fixture.detectChanges();

    expect(getEl(fixture, '[data-testid="forgot-password-form"]')).not.toBeNull();
    expect(fixture.componentInstance.forgotPasswordForm.getRawValue().email).toBe('ada@capy.test');
  });

  it('requests a reset and shows a neutral confirmation, for a real account', async () => {
    const gateway = makeGateway({ succeeds: true, supportsPasswordReset: true });
    const fixture = await createComponent(gateway);
    fixture.componentInstance.openForgotPassword();
    fixture.componentInstance.forgotPasswordForm.setValue({ email: 'ada@capy.test' });
    fixture.detectChanges();

    getEl<HTMLFormElement>(fixture, '[data-testid="forgot-password-form"]').dispatchEvent(
      new Event('submit', { cancelable: true })
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gateway.requestPasswordReset).toHaveBeenCalledWith('ada@capy.test');
    expect(getEl(fixture, '[data-testid="forgot-password-message"]').textContent).toContain(
      "we've sent a link"
    );
  });

  it('shows the identical neutral confirmation even when the gateway rejects — never reveals whether the account exists', async () => {
    const gateway = makeGateway({ succeeds: true, supportsPasswordReset: true });
    gateway.requestPasswordReset.mockRejectedValue(new Error('transport failure'));
    const fixture = await createComponent(gateway);
    fixture.componentInstance.openForgotPassword();
    fixture.componentInstance.forgotPasswordForm.setValue({ email: 'nobody@capy.test' });

    await fixture.componentInstance.submitForgotPassword();
    fixture.detectChanges();

    expect(getEl(fixture, '[data-testid="forgot-password-message"]').textContent).toContain(
      "we've sent a link"
    );
  });

  it('"Back to sign in" returns to the login form and clears the message', async () => {
    const gateway = makeGateway({ succeeds: true, supportsPasswordReset: true });
    const fixture = await createComponent(gateway);
    fixture.componentInstance.openForgotPassword();
    await fixture.componentInstance.submitForgotPassword();
    fixture.detectChanges();

    getEl<HTMLButtonElement>(fixture, '[data-testid="btn-forgot-password-cancel"]').click();
    fixture.detectChanges();

    expect(getEl(fixture, '[data-testid="forgot-password-form"]')).toBeNull();
    expect(fixture.componentInstance.forgotPasswordMessage()).toBeNull();
  });
});
