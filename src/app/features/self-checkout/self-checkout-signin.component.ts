import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { customerEmailValidator } from './customer-email.validator';
import { LANE_ROUTE } from './self-checkout-routes';
import { describeSignInRefusal, SignInRefusalCopy } from './self-checkout-signin-errors';

const REFUSAL_ID = 'signin-refusal';

/** Returning-customer sign-in; anonymous scanning remains a first-class exit. */
@Component({
  selector: 'app-self-checkout-signin',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './self-checkout-signin.component.html',
})
export class SelfCheckoutSignInComponent {
  private readonly gateway = inject(CUSTOMER_AUTH_GATEWAY);
  private readonly currentCustomer = inject(CurrentCustomerService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group({
    email: ['', [Validators.required, customerEmailValidator]],
    password: ['', Validators.required],
  });

  protected readonly submitting = signal(false);
  protected readonly refusal = signal<SignInRefusalCopy | null>(null);

  protected emailError(): string | null {
    const email = this.form.controls.email;
    if (!this.shouldReport(email)) return null;
    return email.hasError('required')
      ? 'Enter your email address.'
      : 'That does not look like an email address — check for a typo.';
  }

  protected passwordError(): string | null {
    const password = this.form.controls.password;
    return this.shouldReport(password) ? 'Enter your password.' : null;
  }

  protected fieldInvalid(field: 'email' | 'password'): boolean {
    return (
      (field === 'email' ? this.emailError() : this.passwordError()) !== null ||
      this.refusal()?.field === field
    );
  }

  protected describedBy(field: 'email' | 'password'): string | null {
    const ids: string[] = [];
    if (field === 'email' ? this.emailError() : this.passwordError()) {
      ids.push(`signin-${field}-error`);
    }
    if (this.refusal()?.field === field) ids.push(REFUSAL_ID);
    return ids.length > 0 ? ids.join(' ') : null;
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.refusal.set(null);
    const credentials = this.form.getRawValue();

    try {
      const session = await this.gateway.authenticate({
        email: credentials.email ?? '',
        password: credentials.password ?? '',
      });
      this.currentCustomer.setSession(session);
      await this.router.navigate([LANE_ROUTE]);
    } catch (error) {
      this.refusal.set(describeSignInRefusal(error));
    } finally {
      this.submitting.set(false);
    }
  }

  protected continueWithoutAccount(): void {
    void this.router.navigate([LANE_ROUTE]);
  }

  private shouldReport(control: AbstractControl): boolean {
    return control.invalid && control.touched;
  }
}
