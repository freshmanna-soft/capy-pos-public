import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { CapybaraStageComponent } from './capybara-stage.component';
import { ClerkFacade } from '@core/application/facades/clerk.facade';
import { CapybaraRenderer } from '@features/clerk/canvas/capybara-renderer';

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

  let setState: ReturnType<typeof vi.spyOn>;
  let setConfidence: ReturnType<typeof vi.spyOn>;
  let plop: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    visualState = signal('idle');
    confidence = signal(0);
    plopToken = signal(0);
    speaking = signal(false);

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
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    const fixture = mount();

    expect(setState).toHaveBeenCalledWith('scanning');
    expect(setConfidence).toHaveBeenCalledWith(0.5);
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

  it('drops the yuzu when an item reaches the cart', () => {
    const fixture = mount();
    plop.mockClear();

    plopToken.set(1);
    fixture.detectChanges();

    expect(plop).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
});
