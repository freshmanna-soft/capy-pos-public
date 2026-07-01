import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HasPermissionDirective } from '@shared/ui/directives/has-permission.directive';
import { ManageRolesUseCase } from '@core/application/auth/manage-roles.use-case';
import { RoleSummaryDto } from '@core/application/auth/dtos/role-summary.dto';
import { ToastService } from '@shared/ui/toast/toast.service';
import { ALL_PERMISSIONS, Permission } from '@core/domain/auth/permission.constants';

/** Permissions grouped by their `area:` prefix for a tidy checkbox layout. */
interface PermissionGroup {
  area: string;
  permissions: Permission[];
}

/**
 * RoleManagementComponent
 *
 * Admin screen (story #44): author data-driven roles — create custom roles with a
 * chosen permission set, edit a custom role's permissions, and delete custom roles.
 * Built-in roles (operator/manager/admin) are shown read-only.
 *
 * Defence in depth: `/admin/roles` is gated by `permissionGuard(MANAGE_ROLES)`, the
 * body by `*appHasPermission`, and `ManageRolesUseCase` asserts `MANAGE_ROLES` at
 * the application layer (the real control). Built-in protection is enforced by the
 * port; the UI only hides the affordances.
 */
@Component({
  selector: 'app-role-management',
  standalone: true,
  imports: [CommonModule, FormsModule, HasPermissionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-container" data-testid="roles-page">
      <div class="page-header">
        <h1>🛡️ Roles &amp; Permissions</h1>
        <p class="page-subtitle">Define what each role can do in this store.</p>
      </div>

      <section *appHasPermission="manageRoles" data-testid="roles-section">
        @if (loading()) {
          <p class="state-msg" data-testid="roles-loading">Loading roles…</p>
        } @else if (error()) {
          <p class="state-msg state-error" role="alert" data-testid="roles-error">{{ error() }}</p>
        } @else {
          <!-- Create a custom role -->
          <form class="role-form" (ngSubmit)="submitCreate()" data-testid="role-create-form">
            <h2>New role</h2>
            <input
              class="name-input"
              type="text"
              placeholder="Role name (e.g. kiosk-attendant)"
              [(ngModel)]="newName"
              name="newName"
              [disabled]="busy()"
              data-testid="role-name-input"
            />
            <div class="perm-groups">
              @for (group of groups(); track group.area) {
                <fieldset class="perm-group">
                  <legend>{{ group.area }}</legend>
                  @for (perm of group.permissions; track perm) {
                    <label class="perm-check">
                      <input
                        type="checkbox"
                        [checked]="newPerms().has(perm)"
                        (change)="toggle(newPerms, perm)"
                        [attr.data-testid]="'new-perm-' + perm"
                      />
                      {{ actionOf(perm) }}
                    </label>
                  }
                </fieldset>
              }
            </div>
            <button
              type="submit"
              class="btn-primary"
              [disabled]="busy() || !newName().trim()"
              data-testid="role-create-btn"
            >
              Create role
            </button>
          </form>

          <!-- Existing roles -->
          <ul class="role-list" data-testid="roles-list">
            @for (role of roles(); track role.id) {
              <li class="role-card" [attr.data-testid]="'role-card-' + role.id">
                <div class="role-head">
                  <span class="role-name">{{ role.name }}</span>
                  @if (role.isBuiltIn) {
                    <span class="builtin-badge" data-testid="builtin-badge">built-in</span>
                  } @else {
                    <span class="custom-actions">
                      @if (editingId() === role.id) {
                        <button
                          type="button"
                          class="btn-link"
                          [disabled]="busy()"
                          (click)="saveEdit(role)"
                          [attr.data-testid]="'role-save-' + role.id"
                        >
                          Save
                        </button>
                        <button type="button" class="btn-link" (click)="cancelEdit()">
                          Cancel
                        </button>
                      } @else {
                        <button
                          type="button"
                          class="btn-link"
                          (click)="startEdit(role)"
                          [attr.data-testid]="'role-edit-' + role.id"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="btn-link danger"
                          [disabled]="busy()"
                          (click)="remove(role)"
                          [attr.data-testid]="'role-delete-' + role.id"
                        >
                          Delete
                        </button>
                      }
                    </span>
                  }
                </div>

                @if (editingId() === role.id) {
                  <div class="perm-groups">
                    @for (group of groups(); track group.area) {
                      <fieldset class="perm-group">
                        <legend>{{ group.area }}</legend>
                        @for (perm of group.permissions; track perm) {
                          <label class="perm-check">
                            <input
                              type="checkbox"
                              [checked]="editPerms().has(perm)"
                              (change)="toggle(editPerms, perm)"
                              [attr.data-testid]="'edit-perm-' + perm"
                            />
                            {{ actionOf(perm) }}
                          </label>
                        }
                      </fieldset>
                    }
                  </div>
                } @else {
                  <div class="perm-chips">
                    @for (perm of role.permissions; track perm) {
                      <span class="perm-chip">{{ perm }}</span>
                    } @empty {
                      <span class="perm-none">No permissions</span>
                    }
                  </div>
                }
              </li>
            }
          </ul>
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
      .role-form {
        margin-top: 1.5rem;
        padding: 1rem 1.25rem;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
      }
      .role-form h2 {
        font-size: 1.05rem;
        margin: 0 0 0.75rem;
        color: #374151;
      }
      .name-input {
        width: 100%;
        max-width: 22rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 0.9375rem;
      }
      .perm-groups {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin: 1rem 0;
      }
      .perm-group {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
        min-width: 12rem;
      }
      .perm-group legend {
        font-weight: 600;
        color: #4338ca;
        text-transform: capitalize;
        padding: 0 0.25rem;
      }
      .perm-check {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.875rem;
        color: #374151;
        padding: 0.125rem 0;
        text-transform: capitalize;
      }
      .btn-primary {
        padding: 0.5rem 1rem;
        background: linear-gradient(to right, #4f46e5, #7c3aed);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        min-height: 40px;
      }
      .btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .role-list {
        list-style: none;
        padding: 0;
        margin: 1.5rem 0 0;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .role-card {
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 0.875rem 1rem;
        background: white;
      }
      .role-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .role-name {
        font-weight: 700;
        color: #111827;
        text-transform: capitalize;
      }
      .builtin-badge {
        font-size: 0.75rem;
        font-weight: 600;
        color: #6b7280;
        background: #f3f4f6;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
      }
      .custom-actions {
        display: flex;
        gap: 0.5rem;
      }
      .btn-link {
        background: none;
        border: none;
        color: #4f46e5;
        font-weight: 600;
        cursor: pointer;
        font-size: 0.875rem;
      }
      .btn-link.danger {
        color: #b91c1c;
      }
      .btn-link:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .perm-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
        margin-top: 0.5rem;
      }
      .perm-chip {
        font-size: 0.75rem;
        background: #eef2ff;
        color: #4338ca;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
      }
      .perm-none {
        font-size: 0.8125rem;
        color: #9ca3af;
        font-style: italic;
      }
    `,
  ],
})
export class RoleManagementComponent implements OnInit {
  private readonly rolesUseCase = inject(ManageRolesUseCase);
  private readonly toast = inject(ToastService);

  /** Bound in the template to the `*appHasPermission` directive. */
  protected readonly manageRoles = Permission.MANAGE_ROLES;

  protected readonly roles = signal<RoleSummaryDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly newName = signal('');
  protected readonly newPerms = signal<Set<Permission>>(new Set());
  protected readonly editingId = signal<string | null>(null);
  protected readonly editPerms = signal<Set<Permission>>(new Set());

  protected readonly groups = computed<PermissionGroup[]>(() => {
    const byArea = new Map<string, Permission[]>();
    for (const p of ALL_PERMISSIONS) {
      const area = p.split(':')[0];
      byArea.set(area, [...(byArea.get(area) ?? []), p]);
    }
    return [...byArea.entries()].map(([area, permissions]) => ({ area, permissions }));
  });

  ngOnInit(): void {
    void this.load();
  }

  protected actionOf(perm: Permission): string {
    return perm.split(':')[1].replace(/[-_]/g, ' ');
  }

  /** Toggle a permission in a Set-valued signal (immutably, so OnPush updates). */
  protected toggle(target: typeof this.newPerms, perm: Permission): void {
    const next = new Set(target());
    if (next.has(perm)) {
      next.delete(perm);
    } else {
      next.add(perm);
    }
    target.set(next);
  }

  protected async submitCreate(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    this.busy.set(true);
    try {
      await this.rolesUseCase.createRole({ name, permissions: [...this.newPerms()] });
      this.toast.success(`Role “${name}” created.`);
      this.newName.set('');
      this.newPerms.set(new Set());
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'Could not create role.');
    } finally {
      this.busy.set(false);
    }
  }

  protected startEdit(role: RoleSummaryDto): void {
    this.editingId.set(role.id);
    this.editPerms.set(new Set(role.permissions));
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
  }

  protected async saveEdit(role: RoleSummaryDto): Promise<void> {
    this.busy.set(true);
    try {
      await this.rolesUseCase.updateRolePermissions(role.id, [...this.editPerms()]);
      this.toast.success(`Updated “${role.name}”.`);
      this.editingId.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'Could not update role.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(role: RoleSummaryDto): Promise<void> {
    if (!confirm(`Delete the “${role.name}” role?`)) return;
    this.busy.set(true);
    try {
      await this.rolesUseCase.deleteRole(role.id);
      this.toast.success(`Deleted “${role.name}”.`);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'Could not delete role.');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.roles.set(await this.rolesUseCase.listRoles());
    } catch {
      this.error.set('You do not have permission to manage roles, or they could not be loaded.');
      this.roles.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
