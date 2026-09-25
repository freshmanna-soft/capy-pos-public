import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Router, NavigationEnd } from '@angular/router';
import { SyncService } from './sync.service';
import { SyncKioskModeService } from './sync-kiosk-mode.service';

describe('SyncKioskModeService', () => {
  let events$: Subject<NavigationEnd>;
  let updateConfig: ReturnType<typeof vi.fn>;

  function navigate(url: string): void {
    events$.next(new NavigationEnd(1, url, url));
  }

  beforeEach(() => {
    events$ = new Subject();
    updateConfig = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        SyncKioskModeService,
        { provide: SyncService, useValue: { updateConfig } },
        { provide: Router, useValue: { events: events$.asObservable() } },
      ],
    });

    // Construct the service so its constructor subscription is set up.
    TestBed.inject(SyncKioskModeService);
  });

  it('sets kioskMode true when navigating to a /kiosk route', () => {
    navigate('/kiosk/shop');

    expect(updateConfig).toHaveBeenCalledWith({ kioskMode: true });
  });

  it('sets kioskMode true when navigating to a /shop route', () => {
    navigate('/shop');

    expect(updateConfig).toHaveBeenCalledWith({ kioskMode: true });
  });

  it('sets kioskMode false when navigating away from a kiosk route', () => {
    navigate('/kiosk/shop');
    updateConfig.mockClear();

    navigate('/pos');

    expect(updateConfig).toHaveBeenCalledWith({ kioskMode: false });
  });

  it('does not push a duplicate update when the mode has not changed', () => {
    navigate('/kiosk/shop');
    updateConfig.mockClear();

    // Second kiosk-prefix navigation — same mode, should be suppressed.
    navigate('/kiosk/checkout');

    expect(updateConfig).not.toHaveBeenCalled();
  });
});
