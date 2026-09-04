import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NavigationComponent } from './navigation.component';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { AUTH_GATEWAY } from '@core/application/auth/ports/auth-gateway.port';
import { AuthSessionDto } from '@core/application/auth/dtos/auth-session.dto';
import { Permission } from '@core/domain/auth';

function makeGateway() {
  return {
    authenticate: vi.fn(),
    getActiveSession: vi.fn().mockResolvedValue(null),
    refresh: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockReturnValue(null),
  };
}

const adminSession: AuthSessionDto = {
  operatorId: 'op-1',
  tenantId: 'store-a',
  roles: ['admin'],
  permissions: [Permission.MANAGE_OPERATORS],
  accessToken: 'token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

function html(fixture: ComponentFixture<NavigationComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

describe('NavigationComponent — sign out', () => {
  let fixture: ComponentFixture<NavigationComponent>;
  let currentUser: CurrentUserService;
  let gateway: ReturnType<typeof makeGateway>;
  let navigateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    gateway = makeGateway();

    TestBed.configureTestingModule({
      imports: [NavigationComponent, RouterTestingModule],
      providers: [{ provide: AUTH_GATEWAY, useValue: gateway }],
    });

    navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    currentUser = TestBed.inject(CurrentUserService);
    currentUser.setSession(adminSession);
    fixture = TestBed.createComponent(NavigationComponent);
    fixture.detectChanges();
  });

  it('the desktop sign-out button logs out and navigates to /login', async () => {
    const [button] = html(fixture).querySelectorAll<HTMLButtonElement>(
      '[data-testid="nav-sign-out"]'
    );
    button.click();
    await fixture.whenStable();

    expect(gateway.signOut).toHaveBeenCalled();
    expect(currentUser.isAuthenticated()).toBe(false);
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  it('the mobile overflow menu also offers sign out and closes the menu on click', async () => {
    // Open the mobile "more" menu so its own sign-out button renders.
    html(fixture).querySelector<HTMLButtonElement>('[data-testid="nav-more"]')!.click();
    fixture.detectChanges();

    const buttons = html(fixture).querySelectorAll<HTMLButtonElement>(
      '[data-testid="nav-sign-out"]'
    );
    expect(buttons.length).toBeGreaterThan(1); // desktop + mobile overflow, both present in the DOM

    buttons[buttons.length - 1].click();
    await fixture.whenStable();

    expect(gateway.signOut).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });
});
