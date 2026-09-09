import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { ClerkFacade } from '@core/application/facades/clerk.facade';
import { PosFacade } from '@core/application/facades/pos.facade';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { CapybaraRenderer, ClerkMood } from '@features/clerk/canvas/capybara-renderer';
import { ClerkComponent } from './clerk.component';
import { CUSTOMER_EXIT_PATH, STAFF_EXIT_PATH } from './clerk-exit-destination';

/**
 * `/clerk` is reachable without a staff session (#219), which turns the two ways
 * out of the stage into two different journeys sharing one control: a cashier
 * steps back to the till, a customer has no till to step back to. The routing
 * decision itself is unit-tested in `clerk-exit-destination.spec.ts`; what these
 * tests cover is the wiring — that the component asks about the *session* rather
 * than assuming a cashier, and that every exit path (the HUD button, Escape, the
 * checkout hand-off, the voice checkout) goes through it.
 *
 * Without this, `clerkExitPath` could be perfectly correct and unused: every
 * `/clerk` e2e signs in as an admin, so a hard-coded `/pos` would still be green
 * everywhere and would bounce a real customer onto the staff login page.
 */
describe('ClerkComponent', () => {
  let fixture: ComponentFixture<ClerkComponent> | null;
  let navigate: ReturnType<typeof vi.fn>;
  let authenticated: WritableSignal<boolean>;
  let isCartEmpty: WritableSignal<boolean>;
  let checkoutRequested: WritableSignal<number>;
  let phase: WritableSignal<string>;
  let start: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fixture = null;
    navigate = vi.fn();
    authenticated = signal(false);
    isCartEmpty = signal(false);
    checkoutRequested = signal(0);
    phase = signal('ready');
    start = vi.fn().mockResolvedValue(undefined);

    // jsdom has no 2D context, so the capybara renderer would throw on
    // construction — same treatment as `capybara-stage.component.spec.ts`.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );
    for (const method of [
      'resize',
      'render',
      'setState',
      'setConfidence',
      'setMood',
      'plop',
    ] as const) {
      vi.spyOn(CapybaraRenderer.prototype, method).mockImplementation(() => undefined);
    }

    TestBed.configureTestingModule({
      imports: [ClerkComponent],
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: CurrentUserService, useValue: { isAuthenticated: authenticated } },
        {
          provide: PosFacade,
          useValue: { isCartEmpty, total: signal(4.5), totalItems: signal(1) },
        },
        {
          provide: CameraService,
          useValue: {
            attach: vi.fn(),
            attachPreview: vi.fn(),
            status: signal('live'),
            message: signal(''),
          },
        },
        {
          provide: ClerkFacade,
          useValue: {
            // Session lifecycle the shell drives.
            start,
            stop: vi.fn(),
            checkoutRequested,
            phase,
            // Read by the stage canvas.
            visualState: signal('idle'),
            confidence: signal(0),
            plopToken: signal(0),
            speaking: signal(false),
            lastBoundaryAt: signal(0),
            gaze: signal({ x: 0, y: 0 }),
            codes: signal([]),
            frameSize: signal({ width: 1280, height: 720 }),
            scanProgress: signal({ kind: 'hidden' as const }),
            mood: signal(ClerkMood.NEUTRAL),
            moodIntensity: signal(0.55),
            // Read by the HUD.
            caption: signal(''),
            exchanges: signal([]),
            candidateCards: signal([]),
            pendingAdd: signal(null),
            undoLabel: signal(''),
            undoMsLeft: signal(0),
            undoSecondsLeft: signal(0),
            verdict: signal('warming'),
            busy: signal(false),
            cameraEnabled: signal(true),
            cameras: signal([]),
            activeCameraId: signal(null),
            hasCameraChoice: signal(false),
            micEnabled: signal(false),
            muted: signal(false),
            aiEnabled: signal(true),
            agentEnabled: signal(true),
            barcodeSupported: signal(false),
            barcodePriority: signal(false),
            barcodeDwell: signal(null),
            heard: signal(''),
            recognizerKind: 'offline',
            voiceSupported: false,
            earSupported: false,
            // Commands the HUD can fire; none of them are the subject here.
            chooseCandidate: vi.fn(),
            reject: vi.fn(),
            repeatLast: vi.fn(),
            dismiss: vi.fn(),
            speakHelp: vi.fn(),
            scanNow: vi.fn(),
            selectCamera: vi.fn(),
            toggleCamera: vi.fn(),
            toggleAi: vi.fn(),
            toggleAgent: vi.fn(),
            toggleMic: vi.fn(),
            toggleMute: vi.fn(),
            undoLast: vi.fn(),
            speakTotal: vi.fn(),
            confirmTop: vi.fn(),
            cycleCamera: vi.fn(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    // Destroyed BEFORE the renderer mocks come off: the stage animates on
    // `requestAnimationFrame`, and a frame that lands after the mocks are restored
    // draws for real against jsdom's contextless canvas and logs an async
    // `console.error` from a torn-down fixture — the cross-spec console leak that
    // has failed the contract gate before.
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  function mount(): ComponentFixture<ClerkComponent> {
    fixture = TestBed.createComponent(ClerkComponent);
    fixture.detectChanges();
    return fixture;
  }

  function click(mounted: ComponentFixture<ClerkComponent>, testId: string): void {
    const button: HTMLButtonElement | null = mounted.nativeElement.querySelector(
      `[data-testid="${testId}"]`
    );
    expect(button, `missing [data-testid="${testId}"]`).not.toBeNull();
    button?.click();
    mounted.detectChanges();
  }

  it('renders the stage for a visitor with no staff session', () => {
    // The lane is unguarded, so "anonymous" is now a state the page has to survive
    // being mounted in at all — not just routed to.
    const mounted = mount();

    expect(mounted.nativeElement.querySelector('[data-testid="clerk-stage"]')).not.toBeNull();
    expect(start).toHaveBeenCalled();
  });

  describe('leaving the stage', () => {
    it('sends a cashier back to the till', () => {
      authenticated.set(true);
      const mounted = mount();

      click(mounted, 'clerk-exit');

      expect(navigate).toHaveBeenCalledWith([STAFF_EXIT_PATH]);
    });

    it('sends an anonymous customer to the customer lane, not the guarded till', () => {
      const mounted = mount();

      click(mounted, 'clerk-exit');

      expect(navigate).toHaveBeenCalledWith([CUSTOMER_EXIT_PATH]);
      expect(navigate).not.toHaveBeenCalledWith([STAFF_EXIT_PATH]);
    });

    it('applies the same split to the Escape key', () => {
      mount();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(navigate).toHaveBeenLastCalledWith([CUSTOMER_EXIT_PATH]);

      authenticated.set(true);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(navigate).toHaveBeenLastCalledWith([STAFF_EXIT_PATH]);
    });

    it('applies the same split to the blocked-camera way out', () => {
      // Terminal state: the only control on screen is "Back to POS", and a
      // customer stuck here must not be handed to the staff login instead.
      phase.set('blocked');
      const mounted = mount();
      const escape: HTMLButtonElement | null = mounted.nativeElement.querySelector(
        '[data-testid="clerk-blocked"] button'
      );

      expect(escape, 'the blocked overlay should offer a way out').not.toBeNull();
      escape?.click();

      expect(navigate).toHaveBeenCalledWith([CUSTOMER_EXIT_PATH]);
    });
  });

  describe('handing off to checkout', () => {
    it('asks the staff terminal to open its checkout overlay', () => {
      authenticated.set(true);
      const mounted = mount();

      click(mounted, 'clerk-checkout');

      expect(navigate).toHaveBeenCalledWith([STAFF_EXIT_PATH], {
        queryParams: { checkout: 1 },
      });
    });

    it('hands an anonymous customer to the customer lane instead of the staff login', () => {
      const mounted = mount();

      click(mounted, 'clerk-checkout');

      expect(navigate).toHaveBeenCalledWith([CUSTOMER_EXIT_PATH], { queryParams: undefined });
      expect(navigate).not.toHaveBeenCalledWith([STAFF_EXIT_PATH], expect.anything());
    });

    it('routes the voice checkout request through the same decision', () => {
      // "Capy, check out" bumps a token on the facade; navigation is the page's
      // job, so it is the page that has to know who is standing at the till.
      const mounted = mount();

      checkoutRequested.set(1);
      mounted.detectChanges();

      expect(navigate).toHaveBeenCalledWith([CUSTOMER_EXIT_PATH], { queryParams: undefined });
    });
  });
});
