import { Routes } from '@angular/router';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { permissionGuard } from '@core/presentation/guards/permission.guard';
import { Permission } from '@core/domain/auth/permission.constants';

/**
 * Admin feature routes.
 *
 * Grouped into their own lazily-loaded route table (referenced from the root
 * `app.routes.ts` via `loadChildren`) so the root routes stay free of
 * feature-specific guard/permission wiring. As more admin screens land
 * (roles, audit log) they slot in here without touching the root routes.
 *
 * Every leaf stacks `permissionGuard` after `authGuard`: authenticated *and*
 * holding the relevant admin permission.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: 'users',
    canActivate: [authGuard, permissionGuard(Permission.MANAGE_OPERATORS)],
    loadComponent: () =>
      import('./operator-list/operator-list.component').then((m) => m.OperatorListComponent),
    title: 'Users & Roles · Capy-POS',
  },
  {
    path: 'roles',
    canActivate: [authGuard, permissionGuard(Permission.MANAGE_ROLES)],
    loadComponent: () =>
      import('./role-management/role-management.component').then((m) => m.RoleManagementComponent),
    title: 'Roles & Permissions · Capy-POS',
  },
];
