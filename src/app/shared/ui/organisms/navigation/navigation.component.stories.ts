import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { NavigationComponent } from '@shared/ui/organisms/navigation/navigation.component';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { Permission } from '@core/domain/auth';

/**
 * Navigation Component Stories
 *
 * Mobile-first navigation: a bottom tab bar below `md` and a collapsible side
 * bar above it — resize the preview to see both. Items are RBAC-gated, so each
 * story pins a different permission set rather than a different input.
 *
 * `CurrentUserService` is stubbed here: the real one talks to the auth gateway,
 * which has no place in a component gallery.
 */
const currentUserStub = (permissions: Permission[]) => ({
  hasPermission: (permission: Permission) => permissions.includes(permission),
  logout: () => Promise.resolve(),
  session: signal(null),
  isAuthenticated: signal(true),
});

const withPermissions = (permissions: Permission[]) =>
  applicationConfig({
    providers: [
      provideRouter([]),
      { provide: CurrentUserService, useValue: currentUserStub(permissions) },
    ],
  });

const allPermissions = Object.values(Permission) as Permission[];

const meta: Meta<NavigationComponent> = {
  title: 'Organisms/Navigation',
  component: NavigationComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<NavigationComponent>;

/**
 * Full access - every RBAC-gated item is visible
 */
export const AllPermissions: Story = {
  decorators: [withPermissions(allPermissions)],
  render: () => ({ template: '<app-navigation />' }),
};

/**
 * No gated permissions - only the ungated items survive the RBAC filter
 */
export const NoGatedPermissions: Story = {
  decorators: [withPermissions([])],
  render: () => ({ template: '<app-navigation />' }),
};

/**
 * Sales-only operator - a clerk with no inventory or reporting access
 */
export const SalesOnly: Story = {
  decorators: [withPermissions([Permission.PROCESS_SALE, Permission.VIEW_TRANSACTIONS])],
  render: () => ({ template: '<app-navigation />' }),
};
