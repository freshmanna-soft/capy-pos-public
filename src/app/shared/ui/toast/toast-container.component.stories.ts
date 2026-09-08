import { signal } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { ToastContainerComponent } from '@shared/ui/toast/toast-container.component';
import { ToastService, type Toast } from '@shared/ui/toast/toast.service';

/**
 * ToastContainer Component Stories
 *
 * The app mounts this once at the root; it renders whatever `ToastService`
 * currently holds. Each story pins a fixed set of toasts through a stubbed
 * service so a variant stays on screen instead of auto-dismissing mid-look.
 */
const TOAST_CONTAINER_TEMPLATE = '<app-toast-container />';

const toastServiceStub = (toasts: Toast[]) => ({
  toasts: signal(toasts),
  dismiss: () => undefined,
  clear: () => undefined,
});

const withToasts = (toasts: Toast[]) =>
  applicationConfig({
    providers: [{ provide: ToastService, useValue: toastServiceStub(toasts) }],
  });

const toast = (id: number, message: string, variant: Toast['variant']): Toast => ({
  id,
  message,
  variant,
});

const meta: Meta<ToastContainerComponent> = {
  title: 'Shared/ToastContainer',
  component: ToastContainerComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<ToastContainerComponent>;

/**
 * Success - role="status", announced politely
 */
export const Success: Story = {
  decorators: [withToasts([toast(1, 'Transaction completed', 'success')])],
  render: () => ({ template: TOAST_CONTAINER_TEMPLATE }),
};

/**
 * Error - role="alert", announced assertively
 */
export const Error: Story = {
  decorators: [withToasts([toast(1, 'Payment declined — try another card', 'error')])],
  render: () => ({ template: TOAST_CONTAINER_TEMPLATE }),
};

/**
 * Warning - also assertive
 */
export const Warning: Story = {
  decorators: [withToasts([toast(1, 'Offline — queuing transactions locally', 'warning')])],
  render: () => ({ template: TOAST_CONTAINER_TEMPLATE }),
};

/**
 * Info - polite
 */
export const Info: Story = {
  decorators: [withToasts([toast(1, 'Catalogue synced', 'info')])],
  render: () => ({ template: TOAST_CONTAINER_TEMPLATE }),
};

/**
 * Stacked - every variant at once, split across the polite and assertive regions
 */
export const Stacked: Story = {
  decorators: [
    withToasts([
      toast(1, 'Catalogue synced', 'info'),
      toast(2, 'Transaction completed', 'success'),
      toast(3, 'Offline — queuing transactions locally', 'warning'),
      toast(4, 'Payment declined — try another card', 'error'),
    ]),
  ],
  render: () => ({ template: TOAST_CONTAINER_TEMPLATE }),
};

/**
 * Empty - both live regions stay mounted so announcements are not missed
 */
export const Empty: Story = {
  decorators: [withToasts([])],
  render: () => ({ template: TOAST_CONTAINER_TEMPLATE }),
};
