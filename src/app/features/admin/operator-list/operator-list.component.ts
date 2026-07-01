import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HasPermissionDirective } from '@shared/ui/directives/has-permission.directive';
import { ListTenantOperatorsUseCase } from '@core/application/auth/list-tenant-operators.use-case';
import { OperatorSummaryDto } from '@core/application/auth/dtos/operator-summary.dto';
import { Permission } from '@core/domain/auth/permission.constants';

/**
 * OperatorListComponent
 *
 * Admin screen (story #44, phase 1): lists the operators of the active tenant
 * with the role each holds in that tenant. Read-only for now — invite,
 * deactivate and role reassignment are deferred to follow-ups so they can be
 * designed alongside the in-flight multi-tenant membership work (#43).
 *
 * Defence in depth:
 *   - the /admin/users route is gated by `permissionGuard(MANAGE_OPERATORS)`;
 *   - the table markup is additionally gated by `*appHasPermission`;
 *   - the underlying use-case asserts `MANAGE_OPERATORS` at the application layer.
 * Any one of these failing denies access; the directive/guard are UX, the
 * use-case assertion is the security control.
 */
@Component({
  selector: 'app-operator-list',
  standalone: true,
  imports: [CommonModule, HasPermissionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-container" data-testid="operators-page">
      <div class="page-header">
        <h1>👥 Users &amp; Roles</h1>
        <p class="page-subtitle">Operators with access to the current store.</p>
      </div>

      <section *appHasPermission="manageOperators" data-testid="operators-section">
        @if (loading()) {
          <p class="state-msg" data-testid="operators-loading">Loading operators…</p>
        } @else if (error()) {
          <p class="state-msg state-error" role="alert" data-testid="operators-error">
            {{ error() }}
          </p>
        } @else if (operators().length === 0) {
          <p class="state-msg" data-testid="operators-empty">No operators found for this store.</p>
        } @else {
          <table class="operators-table" data-testid="operators-table">
            <caption class="sr-only">
              Operators in the current store
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (operator of operators(); track operator.id) {
                <tr [attr.data-testid]="'operator-row-' + operator.id">
                  <td data-testid="operator-name">{{ operator.displayName }}</td>
                  <td>{{ operator.email }}</td>
                  <td>
                    <span class="role-badge" data-testid="operator-role">{{
                      operator.roleName
                    }}</span>
                  </td>
                  <td>
                    <span
                      class="status-badge"
                      [class.status-active]="operator.isActive"
                      [class.status-inactive]="!operator.isActive"
                      data-testid="operator-status"
                    >
                      {{ operator.isActive ? 'Active' : 'Inactive' }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .page-container {
        padding: 2rem;
        max-width: 800px;
        margin: 0 auto;
      }

      .page-header h1 {
        font-size: 1.75rem;
        font-weight: 700;
        color: #111827;
        margin: 0;
      }

      .page-subtitle {
        color: #6b7280;
        margin: 0.25rem 0 0;
      }

      .state-msg {
        margin-top: 2rem;
        color: #6b7280;
      }

      .state-error {
        color: #b91c1c;
      }

      .operators-table {
        margin-top: 1.5rem;
        width: 100%;
        border-collapse: collapse;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        overflow: hidden;
      }

      .operators-table th,
      .operators-table td {
        text-align: left;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #f3f4f6;
        font-size: 0.9375rem;
      }

      .operators-table th {
        background: #f9fafb;
        color: #374151;
        font-weight: 600;
      }

      .operators-table tbody tr:last-child td {
        border-bottom: none;
      }

      .role-badge {
        display: inline-block;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        background: #eef2ff;
        color: #4338ca;
        font-size: 0.8125rem;
        font-weight: 600;
        text-transform: capitalize;
      }

      .status-badge {
        display: inline-block;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.8125rem;
        font-weight: 600;
      }

      .status-active {
        background: #dcfce7;
        color: #166534;
      }

      .status-inactive {
        background: #fee2e2;
        color: #991b1b;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      /* Mobile: let the table scroll horizontally rather than break layout. */
      @media (max-width: 640px) {
        .operators-table {
          display: block;
          overflow-x: auto;
          white-space: nowrap;
        }
      }
    `,
  ],
})
export class OperatorListComponent implements OnInit {
  private readonly listOperators = inject(ListTenantOperatorsUseCase);

  /** Bound in the template to the `*appHasPermission` directive. */
  protected readonly manageOperators = Permission.MANAGE_OPERATORS;

  protected readonly operators = signal<OperatorSummaryDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.operators.set(await this.listOperators.execute());
    } catch {
      // AuthorizationError or a storage failure — surface a neutral message.
      // The route guard and directive already prevent unauthorised rendering;
      // this is the last-resort fallback so the page never shows a blank crash.
      this.error.set('You do not have permission to view operators, or they could not be loaded.');
      this.operators.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
