import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { SessionExpiryWarningComponent } from '@shared/ui/session-expiry/session-expiry-warning.component';
import { CurrentUserService } from '@core/application/auth/current-user.service';

/**
 * SessionExpiryWarning Component Stories
 *
 * Mounted once at the application root and rendered entirely off
 * `CurrentUserService.expiryWarningActive()` — there is no input to flip, so each
 * story stubs the service with a different session state. The countdown reads
 * `sessionExpiresAt()`, an exact wall-clock instant, so the seconds shown here
 * tick down for real.
 */
const currentUserStub = (options: { warningActive: boolean; secondsLeft?: number }) => ({
  expiryWarningActive: signal(options.warningActive),
  sessionExpiresAt: signal(
    options.secondsLeft === undefined ? null : Date.now() + options.secondsLeft * 1000
  ),
  refresh: () => Promise.resolve(),
  logout: () => Promise.resolve(),
});

const withSession = (options: { warningActive: boolean; secondsLeft?: number }) =>
  applicationConfig({
    providers: [
      provideRouter([]),
      { provide: CurrentUserService, useValue: currentUserStub(options) },
    ],
  });

const meta: Meta<SessionExpiryWarningComponent> = {
  title: 'Shared/SessionExpiryWarning',
  component: SessionExpiryWarningComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<SessionExpiryWarningComponent>;

/**
 * Warning showing - a full minute of lead time left
 */
export const Warning: Story = {
  decorators: [withSession({ warningActive: true, secondsLeft: 60 })],
  render: () => ({ template: '<app-session-expiry-warning />' }),
};

/**
 * Final seconds - the countdown is about to run out
 */
export const AboutToExpire: Story = {
  decorators: [withSession({ warningActive: true, secondsLeft: 5 })],
  render: () => ({ template: '<app-session-expiry-warning />' }),
};

/**
 * Healthy session - the component renders nothing at all
 */
export const Dormant: Story = {
  decorators: [withSession({ warningActive: false })],
  render: () => ({ template: '<app-session-expiry-warning />' }),
};
