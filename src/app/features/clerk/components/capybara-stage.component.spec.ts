import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { CapybaraStageComponent } from './capybara-stage.component';
import { ClerkFacade } from '@core/application/facades/clerk.facade';
import { CapybaraRenderer, ClerkMood } from '@features/clerk/canvas/capybara-renderer';

/**
 * These tests exist because of a bug that no amount of DOM assertion would have
 * caught: the effect that feeds the renderer originally returned early when the
 * renderer wasn't built yet, *before* reading any signals. An Angular effect only
 * subscribes to what it reads, so it registered no dependencies and never ran
 * again — the capybara sat in her opening pose for the whole session while the
 * facade changed state behind her. Everything still rendered, every e2e test
 * still passed, and the animation was simply dead.
 *
 * So the contract under test is narrow and specific: state reaching the renderer.
 */
describe('CapybaraStageComponent', () => {
  let visualState: WritableSignal<'idle' | 'scanning' | 'found' | 'confused'>;
  let confidence: WritableSignal<number>;
  let plopToken: WritableSignal<number>;
  let speaking: WritableSignal<boolean>;
  let mood: WritableSignal<ClerkMood>;
  let moodIntensity: WritableSignal<number>;

  let setState: ReturnType<typeof vi.spyOn>;
  let setConfidence: ReturnType<typeof vi.spyOn>;
  let setMood: ReturnType<typeof vi.spyOn>;
  let plop: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    visualState = signal('idle');
    confidence = signal(0);
    plopToken = signal(0);
    speaking = signal(false);
    mood = signal<ClerkMood>(ClerkMood.NEUTRAL);
    moodIntensity = signal(0.55);

    // jsdom has no 2D context, so the renderer would throw on construction.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(CapybaraRenderer.prototype, 'resize').mockImplementation(() => undefined);
    vi.spyOn(CapybaraRenderer.prototype, 'render').mockImplementation(() => undefined);
    setState = vi.spyOn(CapybaraRenderer.prototype, 'setState').mockImplementation(() => undefined);
    setConfidence = vi
      .spyOn(CapybaraRenderer.prototype, 'setConfidence')
      .mockImplementation(() => undefined);
    setMood = vi.spyOn(CapybaraRenderer.prototype, 'setMood').mockImplementation(() => undefined);
    plop = vi.spyOn(CapybaraRenderer.prototype, 'plop').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      imports: [CapybaraStageComponent],
      providers: [
        {
          provide: ClerkFacade,
          useValue: {
            visualState,
            confidence,
            plopToken,
            speaking,
            lastBoundaryAt: signal(0),
            gaze: signal({ x: 0, y: 0 }),
            codes: signal([]),
            frameSize: signal({ width: 1280, height: 720 }),
            scanProgress: signal({ kind: 'hidden' as const }),
            mood,
            moodIntensity,
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Globals are stubbed rather than spied, so restoring mocks does not undo them.
    vi.unstubAllGlobals();
  });

  function mount() {
    const fixture = TestBed.createComponent(CapybaraStageComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a canvas that is hidden from assistive technology', () => {
    const fixture = mount();
    const canvas: HTMLCanvasElement = fixture.nativeElement.querySelector('canvas');
    expect(canvas).toBeTruthy();
    // All text lives in the HUD; the canvas is decoration over a working interface.
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    fixture.destroy();
  });

  it('keeps pushing state after the view is built', () => {
    const fixture = mount();
    setState.mockClear();

    visualState.set('scanning');
    fixture.detectChanges();

    expect(setState).toHaveBeenCalledWith('scanning');
    fixture.destroy();
  });

  it('keeps pushing confidence after the view is built', () => {
    const fixture = mount();
    setConfidence.mockClear();

    confidence.set(0.93);
    fixture.detectChanges();

    expect(setConfidence).toHaveBeenCalledWith(0.93);
    fixture.destroy();
  });

  it('tracks several changes in a row, not just the first', () => {
    const fixture = mount();
    setState.mockClear();

    for (const state of ['scanning', 'found', 'confused', 'idle'] as const) {
      visualState.set(state);
      fixture.detectChanges();
    }

    expect(setState.mock.calls.map((call) => call[0])).toEqual([
      'scanning',
      'found',
      'confused',
      'idle',
    ]);
    fixture.destroy();
  });

  it('catches up on state the facade set before the view existed', () => {
    // The facade can be several states in by the time this component mounts.
    visualState.set('scanning');
    confidence.set(0.5);
    mood.set(ClerkMood.SORRY);

    const fixture = mount();

    expect(setState).toHaveBeenCalledWith('scanning');
    expect(setConfidence).toHaveBeenCalledWith(0.5);
    expect(setMood).toHaveBeenCalledWith(ClerkMood.SORRY, 0.55);
    fixture.destroy();
  });

  it('keeps pushing the mood, and the intensity it should be played at', () => {
    const fixture = mount();
    setMood.mockClear();

    mood.set(ClerkMood.HAPPY);
    fixture.detectChanges();
    expect(setMood).toHaveBeenLastCalledWith(ClerkMood.HAPPY, 0.55);

    // Muting her raises the intensity without the mood itself changing, and the
    // renderer has to hear about that on its own.
    moodIntensity.set(1);
    fixture.detectChanges();
    expect(setMood).toHaveBeenLastCalledWith(ClerkMood.HAPPY, 1);
    fixture.destroy();
  });

  it('keeps animating after a frame throws, and logs it once', async () => {
    // A bad frame used to end the rAF loop for the rest of the session, leaving a
    // half-drawn capybara frozen on the till.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const render = vi.spyOn(CapybaraRenderer.prototype, 'render').mockImplementation(() => {
      throw new Error('bad gradient stop');
    });

    const fixture = mount();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    expect(render.mock.calls.length).toBeGreaterThan(1);
    expect(error).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('stops drawing in a hidden tab, and picks up again on return', () => {
    // Browsers throttle rAF in a hidden tab but do not stop it, so the loop would
    // keep integrating on a stale clock.
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const request = vi.spyOn(globalThis, 'requestAnimationFrame');
    const fixture = mount();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancel).toHaveBeenCalled();

    request.mockClear();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(request).toHaveBeenCalled();
    fixture.destroy();
  });

  it('does not start a second loop when it is already running', () => {
    // Two loops would double every spring step, which reads as the animation
    // running at twice speed for the rest of the session.
    const fixture = mount();
    const request = vi.spyOn(globalThis, 'requestAnimationFrame');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(request).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('follows the reduced-motion setting being changed while the page is open', () => {
    // Some platforms let this be toggled live, and a clerk left mid-animation would
    // otherwise be stuck with whatever was true when the page loaded.
    const setReducedMotion = vi
      .spyOn(CapybaraRenderer.prototype, 'setReducedMotion')
      .mockImplementation(() => undefined);
    let onChange: ((event: MediaQueryListEvent) => void) | null = null;
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => {
        onChange = handler;
      },
      removeEventListener: () => undefined,
    }));

    const fixture = mount();
    expect(setReducedMotion).toHaveBeenCalledWith(false);

    onChange?.({ matches: true } as MediaQueryListEvent);

    expect(setReducedMotion).toHaveBeenLastCalledWith(true);
    fixture.destroy();
  });

  it('works on a platform with no media queries at all', () => {
    // Reduced motion is a preference, not a requirement; its absence must not stop
    // the stage from drawing.
    vi.stubGlobal('matchMedia', undefined);

    const fixture = mount();

    expect(setState).toHaveBeenCalled();
    fixture.destroy();
  });

  it('caps the canvas at twice the device pixel ratio', () => {
    // Beyond 2x the extra pixels are invisible at counter distance and the fill
    // cost is real on a cheap tablet.
    const resize = vi
      .spyOn(CapybaraRenderer.prototype, 'resize')
      .mockImplementation(() => undefined);
    vi.stubGlobal('devicePixelRatio', 3);

    const fixture = mount();

    expect(resize).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 2);
    fixture.destroy();
  });

  it('assumes one device pixel where the browser reports none', () => {
    const resize = vi
      .spyOn(CapybaraRenderer.prototype, 'resize')
      .mockImplementation(() => undefined);
    vi.stubGlobal('devicePixelRatio', 0);

    const fixture = mount();

    expect(resize).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 1);
    fixture.destroy();
  });

  it('drops the yuzu when an item reaches the cart', () => {
    const fixture = mount();
    plop.mockClear();

    plopToken.set(1);
    fixture.detectChanges();

    expect(plop).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
});
