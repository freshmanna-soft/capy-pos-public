import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
import { ClerkFacade } from '@core/application/facades/clerk.facade';
import { CapybaraRenderer } from '@features/clerk/canvas/capybara-renderer';

/**
 * CapybaraStageComponent
 *
 * Hosts the canvas the clerk is drawn on and runs its animation loop. Thin by
 * design: all the drawing lives in `CapybaraRenderer` (plain TypeScript, unit
 * testable) and all the decisions live in `ClerkFacade`. This component owns only
 * the three things that genuinely need a component — the element, the frame
 * clock, and the browser listeners.
 *
 * The canvas is `aria-hidden` and carries no text. Everything the clerk
 * communicates is rendered as real DOM in the HUD, so the animation is
 * decoration over an interface that works without it.
 */
@Component({
  selector: 'app-capybara-stage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas
      #stageCanvas
      class="block h-full w-full"
      aria-hidden="true"
      data-testid="capybara-canvas"
    ></canvas>
  `,
  styles: [':host { display: block; height: 100%; width: 100%; }'],
})
export class CapybaraStageComponent implements AfterViewInit, OnDestroy {
  @ViewChild('stageCanvas', { static: true })
  private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly clerk = inject(ClerkFacade);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private renderer: CapybaraRenderer | null = null;
  private frame = 0;
  private observer: ResizeObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  private renderFailureLogged = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.teardown());

    // State, gaze, confidence and speech are pushed into the renderer reactively
    // rather than polled: the renderer keeps its own spring state, so it needs to
    // be told a target once, not asked for one sixty times a second.
    //
    // Every signal is read BEFORE the null check, and that ordering is load
    // bearing. An effect only subscribes to signals it actually reads, and this
    // one first runs before `ngAfterViewInit` has built the renderer — so
    // returning early on `renderer === null` would leave it with no dependencies
    // at all and it would never run again. The capybara would sit in her initial
    // pose for the whole session while the facade changed state behind her.
    effect(() => {
      const state = this.clerk.visualState();
      const confidence = this.clerk.confidence();
      const gaze = this.clerk.gaze();
      const speaking = this.clerk.speaking();
      const lastBoundaryAt = this.clerk.lastBoundaryAt();
      const codes = this.clerk.codes();
      const frameSize = this.clerk.frameSize();
      const scanProgress = this.clerk.scanProgress();

      const renderer = this.renderer;
      if (!renderer) {
        return;
      }
      renderer.setState(state);
      renderer.setConfidence(confidence);
      renderer.lookAt(gaze.x, gaze.y);
      renderer.setSpeech(speaking, lastBoundaryAt);
      renderer.setCodes(codes, frameSize);
      renderer.setScanProgress(scanProgress);
    });

    // A change of token means an item really reached the cart. Reading it here
    // rather than inside the render loop keeps the ripple tied to the cart write.
    effect(() => {
      const token = this.clerk.plopToken();
      if (token > 0) {
        this.renderer?.plop();
      }
    });
  }

  ngAfterViewInit(): void {
    this.renderer = new CapybaraRenderer(this.canvasRef.nativeElement);

    // Reduced motion is read live, not once: some platforms let it be toggled
    // while the page is open, and a clerk left mid-animation would be stuck.
    if (typeof matchMedia === 'function') {
      this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
      this.renderer.setReducedMotion(this.motionQuery.matches);
      this.motionQuery.addEventListener('change', this.onMotionPreferenceChange);
    }

    this.measure();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(this.host.nativeElement);
    }

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // Catch up on whatever the facade already decided while the view was being
    // created; the effect above will keep it in step from here.
    this.renderer.setState(this.clerk.visualState());
    this.renderer.setConfidence(this.clerk.confidence());
    this.renderer.resetEntrance();
    this.start();
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  private start(): void {
    if (this.frame !== 0) {
      return;
    }
    const loop = (now: number): void => {
      // Schedule the next frame even if this one threw. Without the guard a
      // single bad frame ends the loop for the rest of the shift and leaves a
      // half-drawn capybara frozen on the till — the animation is decoration, and
      // it should fail quietly rather than visibly.
      try {
        this.renderer?.render(now);
      } catch (error) {
        this.reportRenderFailure(error);
      }
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /** Log the first render failure only — sixty a second is not a useful log. */
  private reportRenderFailure(error: unknown): void {
    if (this.renderFailureLogged) {
      return;
    }
    this.renderFailureLogged = true;
    console.error('[Clerk] The capybara stage failed to draw a frame:', error);
  }

  private stop(): void {
    if (this.frame !== 0) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  private measure(): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    // Cap the device pixel ratio at 2. Beyond that the extra pixels are
    // invisible at counter distance and the fill cost is real on a cheap tablet.
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.renderer?.resize(rect.width, rect.height, dpr);
  }

  /**
   * Browsers throttle `requestAnimationFrame` in a hidden tab but don't stop it,
   * so the loop would keep integrating on a stale clock. Stopping outright is
   * both cheaper and more correct — the renderer clamps its first step on resume.
   */
  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.stop();
    } else {
      this.start();
    }
  };

  private readonly onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this.renderer?.setReducedMotion(event.matches);
  };

  private teardown(): void {
    this.stop();
    this.observer?.disconnect();
    this.observer = null;
    this.motionQuery?.removeEventListener('change', this.onMotionPreferenceChange);
    this.motionQuery = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer = null;
  }
}
