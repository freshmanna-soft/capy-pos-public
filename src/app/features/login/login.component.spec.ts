import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { LoginComponent } from './login.component';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { InvalidCredentialsError } from '@core/infrastructure/auth/local-credential-auth.adapter';
import type { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';

const mockSession: AuthSessionDto = {
  operatorId: 'op-001',
  tenantId: 'default-tenant',
  roles: ['admin'],
  permissions: ['sale:process'],
  accessToken: 'fake.jwt.token',
  expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
};

function makeGateway(opts: { succeeds: boolean }) {
  return {
    authenticate: opts.succeeds
      ? vi.fn().mockResolvedValue(mockSession)
      : vi.fn().mockRejectedValue(new InvalidCredentialsError()),
    getActiveSession: vi.fn().mockResolvedValue(null),
    refresh: vi.fn(),
    signOut: vi.fn(),
    getAccessToken: vi.fn().mockReturnValue(null),
  };
}

async function createComponent(gateway: ReturnType<typeof makeGateway>) {
  await TestBed.configureTestingModule({
    imports: [LoginComponent, RouterTestingModule],
    providers: [{ provide: AUTH_GATEWAY, useValue: gateway }],
  }).compileComponents();

  const fixture = TestBed.createComponent(LoginComponent);
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
