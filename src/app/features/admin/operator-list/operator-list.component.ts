import { Component, ChangeDetectionStrategy, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HasPermissionDirective } from '@shared/ui/directives/has-permission.directive';
import { ListTenantOperatorsUseCase } from '@core/application/auth/list-tenant-operators.use-case';
import { ManageOperatorMembershipUseCase } from '@core/application/auth/manage-operator-membership.use-case';
import { OperatorSummaryDto } from '@core/application/auth/dtos/operator-summary.dto';
import { RoleSummaryDto } from '@core/application/auth/dtos/role-summary.dto';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { ToastService } from '@shared/ui/toast/toast.service';
import { Permission } from '@core/domain/auth/permission.constants';

/**
 * OperatorListComponent
 *
 * Admin screen (story #44): lists the operators of the active tenant and lets an
 * admin reassign each operator's role or revoke their membership in that tenant.
 *
 * Defence in depth:
 *   - the /admin/users route is gated by `permissionGuard(MANAGE_OPERATORS)`;
 *   - the table + controls are additionally gated by `*appHasPermission`;
 *   - the use-cases assert `MANAGE_OPERATORS` at the application layer (the real
 *     security control — the guard/directive are UX only).
 *
 * When an admin changes their OWN membership, the session is refreshed so their
 * guards and gated UI update live (AC4).
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
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (operator of operators(); track operator.id) {
                <tr [attr.data-testid]="'operator-row-' + operator.id">
                  <td data-testid="operator-name">{{ operator.displayName }}</td>
                  <td>{{ operator.email }}</td>
                  <td>
                    <label class="sr-only" [attr.for]="'role-' + operator.id">Role</label>
                    <select
                      class="role-select"
                      [id]="'role-' + operator.id"
                      [value]="operator.roleId"
                      [disabled]="busy()"
                      (change)="onRoleChange(operator, asValue($event))"
                      [attr.data-testid]="'operator-role-select-' + operator.id"
                    >
                      @for (role of assignableRoles(); track role.id) {
                        <option [value]="role.id" [selected]="role.id === operator.roleId">
                          {{ role.name }}
                        </option>
                      }
                    </select>
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
                  <td>
                    <button
                      type="button"
                      class="revoke-btn"
                      [disabled]="busy()"
                      (click)="onRevoke(operator)"
                      [attr.data-testid]="'operator-revoke-' + operator.id"
                    >
                      Revoke
                    </button>
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
        max-width: 900px;
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

      .role-select {
        padding: 0.375rem 0.5rem;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: white;
        font-size: 0.875rem;
        color: #374151;
        min-width: 8rem;
        text-transform: capitalize;
      }

      .role-select:disabled {
        opacity: 0.6;
        cursor: not-allowed;
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

      .revoke-btn {
        padding: 0.375rem 0.75rem;
        border: 1px solid #fca5a5;
        border-radius: 8px;
        background: #fef2f2;
        color: #b91c1c;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        min-height: 36px;
      }

      .revoke-btn:hover:not(:disabled) {
        background: #fee2e2;
      }

      .revoke-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
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
  private readonly membership = inject(ManageOperatorMembershipUseCase);
  private readonly currentUser = inject(CurrentUserService);
  private readonly toast = inject(ToastService);

  /** Bound in the template to the `*appHasPermission` directive. */
  protected readonly manageOperators = Permission.MANAGE_OPERATORS;

  protected readonly operators = signal<OperatorSummaryDto[]>([]);
  protected readonly assignableRoles = signal<RoleSummaryDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  /** Read the changed <select>'s value (typed narrow so the template stays clean). */
  protected asValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected async onRoleChange(operator: OperatorSummaryDto, roleId: string): Promise<void> {
    if (roleId === operator.roleId) return;
    this.busy.set(true);
    try {
      await this.membership.assignRole(operator.id, roleId);
      this.toast.success(`Updated ${operator.displayName}'s role.`);
      await this.afterMutation(operator.id);
    } catch {
      this.toast.error(`Could not update ${operator.displayName}'s role.`);
      await this.load(); // resync the dropdown to the persisted value
    } finally {
      this.busy.set(false);
    }
  }

  protected async onRevoke(operator: OperatorSummaryDto): Promise<void> {
    if (!confirm(`Revoke ${operator.displayName}'s access to this store?`)) return;
    this.busy.set(true);
    try {
      await this.membership.revokeMembership(operator.id);
      this.toast.success(`Revoked ${operator.displayName}'s access.`);
      await this.afterMutation(operator.id);
    } catch {
      this.toast.error(`Could not revoke ${operator.displayName}'s access.`);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Reload the list and, when the change touched the CURRENT operator's own
   * membership, refresh the session so their guards/gated UI update live (AC4).
   */
  private async afterMutation(mutatedUserId: string): Promise<void> {
    if (mutatedUserId === this.currentUser.operatorId()) {
      await this.currentUser.refresh().catch(() => undefined);
    }
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [operators, roles] = await Promise.all([
        this.listOperators.execute(),
        this.membership.listAssignableRoles(),
      ]);
      this.operators.set(operators);
      this.assignableRoles.set(roles);
    } catch {
      // AuthorizationError or a storage failure — surface a neutral message.
      this.error.set('You do not have permission to view operators, or they could not be loaded.');
      this.operators.set([]);
      this.assignableRoles.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
