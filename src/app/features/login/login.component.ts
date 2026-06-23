import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { InvalidCredentialsError } from '@core/infrastructure/auth/local-credential-auth.adapter';

/**
 * LoginComponent
 *
 * Standalone login page.  Validates credentials via AUTH_GATEWAY, then
 * redirects to /pos on success.  Route guards (Story #41) will enforce
 * authentication on protected routes.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login-page" role="main">
      <div class="login-card">
        <div class="login-header">
          <h1 class="login-title">Capy POS</h1>
          <p class="login-subtitle">Sign in to continue</p>
        </div>

        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          novalidate
          aria-label="Login form"
          class="login-form"
        >
          <!-- Email field -->
          <div class="form-field">
            <label for="email" class="field-label">Email address</label>
            <input
              id="email"
              type="email"
              formControlName="email"
              class="field-input"
              [class.field-input--error]="showEmailError()"
              autocomplete="username"
              aria-required="true"
              [attr.aria-invalid]="showEmailError() ? 'true' : null"
              aria-describedby="email-error"
              data-testid="input-email"
            />
            @if (showEmailError()) {
              <span id="email-error" class="field-error" role="alert" data-testid="email-error">
                Please enter a valid email address.
              </span>
            }
          </div>

          <!-- Password field -->
          <div class="form-field">
            <label for="password" class="field-label">Password</label>
            <input
              id="password"
              type="password"
              formControlName="password"
              class="field-input"
              [class.field-input--error]="showPasswordError()"
              autocomplete="current-password"
              aria-required="true"
              [attr.aria-invalid]="showPasswordError() ? 'true' : null"
              aria-describedby="password-error"
              data-testid="input-password"
            />
            @if (showPasswordError()) {
              <span
                id="password-error"
                class="field-error"
                role="alert"
                data-testid="password-error"
              >
                Password is required.
              </span>
            }
          </div>

          <!-- Server-side error region -->
          @if (authError()) {
            <div class="auth-error" role="alert" aria-live="assertive" data-testid="auth-error">
              {{ authError() }}
            </div>
          }

          <!-- Submit -->
          <button
            type="submit"
            class="btn-login"
            [disabled]="loading() || form.invalid"
            data-testid="btn-login"
            aria-label="Sign in"
          >
            {{ loading() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [
    `
      .login-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        padding: 1rem;
      }

      .login-card {
        width: 100%;
        max-width: 400px;
        background: #fff;
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
      }

      .login-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .login-title {
        font-size: 1.75rem;
        font-weight: 700;
        color: #111827;
        margin: 0 0 0.25rem;
      }

      .login-subtitle {
        color: #6b7280;
        margin: 0;
        font-size: 0.9375rem;
      }

      .login-form {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .field-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: #374151;
      }

      .field-input {
        padding: 0.625rem 0.875rem;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 1rem;
        color: #111827;
        outline: none;
        transition: border-color 0.15s;
      }

      .field-input:focus {
        border-color: #2563eb;
      }

      .field-input--error {
        border-color: #dc2626;
      }

      .field-error {
        font-size: 0.8125rem;
        color: #dc2626;
      }

      .auth-error {
        padding: 0.75rem 1rem;
        background: #fef2f2;
        border: 1px solid #fca5a5;
        border-radius: 8px;
        font-size: 0.875rem;
        color: #991b1b;
      }

      .btn-login {
        width: 100%;
        padding: 0.75rem;
        background: #2563eb;
        color: #fff;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }

      .btn-login:hover:not(:disabled) {
        background: #1d4ed8;
      }

      .btn-login:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      @media (max-width: 480px) {
        .login-card {
          padding: 1.25rem;
        }
      }
    `,
  ],
})
export class LoginComponent {
  private readonly gateway = inject(AUTH_GATEWAY);
  private readonly currentUser = inject(CurrentUserService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  readonly loading = signal(false);
  readonly authError = signal<string | null>(null);

  /** Driven by the submit attempt — avoids non-signal form state in computed. */
  readonly showEmailError = signal(false);
  readonly showPasswordError = signal(false);

  async submit(): Promise<void> {
    // Mark fields to show validation state
    this.form.markAllAsTouched();
    this.showEmailError.set(!!this.form.get('email')?.invalid);
    this.showPasswordError.set(!!this.form.get('password')?.invalid);

    if (this.form.invalid || this.loading()) return;

    this.authError.set(null);
    this.loading.set(true);

    try {
      const { email, password } = this.form.getRawValue() as {
        email: string;
        password: string;
      };
      const session = await this.gateway.authenticate({ email, password });
      // Populate the in-memory principal so guards & directives react immediately
      this.currentUser.setSession(session);
      await this.router.navigate(['/pos']);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        this.authError.set('Invalid email or password. Please try again.');
      } else {
        this.authError.set('An unexpected error occurred. Please try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }
}
