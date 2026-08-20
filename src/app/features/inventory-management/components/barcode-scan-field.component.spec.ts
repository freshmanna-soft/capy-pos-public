import { TestBed } from '@angular/core/testing';
import { Component, WritableSignal, signal } from '@angular/core';
import { BarcodeScanFieldComponent } from './barcode-scan-field.component';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { ScannedCode } from '@core/infrastructure/media/barcode-gate';

/** A code filling a good part of the frame — a deliberate presentation. */
function seen(value: string, width = 0.4): ScannedCode {
  return { value, format: 'ean_13', box: { x: 0.1, y: 0.2, width, height: 0.25 } };
}

/**
 * A host, so the field is exercised the way the product form uses it: inputs set
 * from outside, values arriving back as events.
 */
@Component({
  standalone: true,
  imports: [BarcodeScanFieldComponent],
  template: `<app-barcode-scan-field
    [value]="value()"
    [error]="error()"
    [duplicateName]="duplicateName()"
    (valueChange)="emitted.push($event)"
    (openDuplicate)="openedDuplicate = openedDuplicate + 1"
  />`,
})
class HostComponent {
  // Signals rather than plain fields: a bound field mutated between a fixture's
  // render pass and its verification pass trips NG0100, which says nothing about
  // the component under test.
  readonly value = signal('');
  readonly error = signal('');
  readonly duplicateName = signal<string | null>(null);
  emitted: string[] = [];
  openedDuplicate = 0;
}

describe('BarcodeScanFieldComponent', () => {
  let cameraStart: ReturnType<typeof vi.fn>;
  let cameraStop: ReturnType<typeof vi.fn>;
  let attach: ReturnType<typeof vi.fn>;
  let detectionSource: ReturnType<typeof vi.fn>;
  let detect: ReturnType<typeof vi.fn>;
  let prepare: ReturnType<typeof vi.fn>;
  let scannerSupported: WritableSignal<boolean>;
  let cameraStatus: WritableSignal<string>;
  let cameraMessage: WritableSignal<string>;

  beforeEach(() => {
    cameraStart = vi.fn().mockResolvedValue(true);
    cameraStop = vi.fn();
    attach = vi.fn();
    // A video element with real dimensions, so a decode is attempted.
    detectionSource = vi.fn().mockReturnValue({ videoWidth: 1280, videoHeight: 720 });
    detect = vi.fn().mockResolvedValue([]);
    prepare = vi.fn().mockResolvedValue(true);
    scannerSupported = signal(true);
    cameraStatus = signal('live');
    cameraMessage = signal('');

    // jsdom has no media pipeline: `play()` is unimplemented and returns undefined,
    // which the component would then call `.catch` on.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        {
          provide: BarcodeScannerService,
          useValue: { supported: scannerSupported, prepare, detect },
        },
      ],
    });
    // The component provides its own CameraService on purpose — see its class
    // comment — so the double has to be installed at that level, not the module's.
    TestBed.overrideComponent(BarcodeScanFieldComponent, {
      set: {
        providers: [
          {
            provide: CameraService,
            useValue: {
              start: cameraStart,
              stop: cameraStop,
              attach,
              detectionSource,
              status: cameraStatus,
              message: cameraMessage,
            },
          },
        ],
      },
    });
  });

  afterEach(() => {
    // Before the shared teardown, which awaits a real 0ms tick and would never
    // resolve with fake timers still installed.
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function mount() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    // The detector probe is a promise resolved in the constructor; the scan button
    // does not exist until it has answered.
    await Promise.resolve();
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  function testId(fixture: { nativeElement: HTMLElement }, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  describe('typing and scanner guns', () => {
    it('emits what was typed', async () => {
      const fixture = await mount();
      const input: HTMLInputElement = fixture.nativeElement.querySelector('input');

      input.value = '4006381333931';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(fixture.componentInstance.emitted).toContain('4006381333931');
    });

    it('never submits the form when a scanner gun presses Enter', async () => {
      // A gun types its digits and presses Enter. Left alone that Enter saves a
      // product whose only filled field is the barcode.
      const fixture = await mount();
      fixture.componentInstance.value.set('  4006381333931  ');
      fixture.detectChanges();
      const input: HTMLInputElement = fixture.nativeElement.querySelector('input');

      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
      input.dispatchEvent(enter);

      expect(enter.defaultPrevented).toBe(true);
      // Trimmed, because a gun sometimes appends whitespace — but not otherwise
      // altered, because the digits are the product's identity.
      expect(fixture.componentInstance.emitted).toEqual(['4006381333931']);
    });
  });

  describe('what the code appears to be', () => {
    it('says nothing about an empty field', async () => {
      const fixture = await mount();

      expect(testId(fixture, 'barcode-status')).toBeNull();
    });

    it('names the format and confirms a good check digit', async () => {
      const fixture = await mount();
      fixture.componentInstance.value.set('4006381333931');
      fixture.detectChanges();

      expect(testId(fixture, 'barcode-status')?.textContent).toContain('EAN-13');
      expect(testId(fixture, 'barcode-status')?.textContent).toContain('checks out');
    });

    it('flags a check digit that does not add up', async () => {
      // A mistyped digit is invisible in a row of thirteen; this is what makes it
      // findable before the product is saved.
      const fixture = await mount();
      fixture.componentInstance.value.set('4006381333932');
      fixture.detectChanges();

      expect(testId(fixture, 'barcode-status')?.textContent).toContain('check digit looks wrong');
    });

    it('calls a code it cannot verify a custom one rather than a bad one', async () => {
      const fixture = await mount();
      fixture.componentInstance.value.set('SHELF-A12');
      fixture.detectChanges();

      expect(testId(fixture, 'barcode-status')?.textContent).toContain('Custom code');
    });

    it('reports a duplicate ahead of anything about the digits', async () => {
      const fixture = await mount();
      fixture.componentInstance.value.set('4006381333931');
      fixture.componentInstance.duplicateName.set('Coffee');
      fixture.detectChanges();

      expect(testId(fixture, 'barcode-status')?.textContent).toContain('Already registered');
      testId(fixture, 'btn-open-duplicate')?.click();
      expect(fixture.componentInstance.openedDuplicate).toBe(1);
    });
  });

  describe('offering the camera', () => {
    it('hides the scan button where the browser cannot decode', async () => {
      // Chromium-only. Offering a button that cannot work is worse than not
      // offering one, because typing the digits always works.
      scannerSupported.set(false);
      prepare.mockResolvedValue(false);

      const fixture = await mount();

      expect(testId(fixture, 'btn-scan')).toBeNull();
      expect(text(fixture)).toContain('Type the digits');
    });

    it('waits for the detector to be built before offering it', async () => {
      // `supported` is true here from the start, so a component that trusted it
      // alone would offer a button backed by a detector that does not exist yet.
      prepare.mockReturnValue(new Promise<boolean>(() => undefined));

      const fixture = await mount();

      expect(testId(fixture, 'btn-scan')).toBeNull();
    });

    it('offers it once the detector is ready', async () => {
      const fixture = await mount();

      expect(testId(fixture, 'btn-scan')).not.toBeNull();
      expect(text(fixture)).not.toContain('Type the digits');
    });
  });

  describe('scanning', () => {
    it('opens the camera and shows the preview', async () => {
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      fixture.detectChanges();
      expect(text(fixture)).toContain('Starting the camera');

      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(cameraStart).toHaveBeenCalled();
      expect(testId(fixture, 'barcode-scan-preview')).not.toBeNull();
      expect(text(fixture)).toContain('Hold the barcode up');
      // Attached from both sides, because the element and the stream arrive in
      // either order and a video attached too late never gets any pixels.
      expect(attach).toHaveBeenCalled();
    });

    it('emits the code exactly as the decoder reported it', async () => {
      // Not the expanded form: the till indexes `product.barcode` verbatim, so
      // saving the 12-digit equivalent of a UPC-E leaves it unscannable.
      vi.useFakeTimers();
      detect.mockResolvedValue([seen('01234565')]);
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      await vi.advanceTimersByTimeAsync(400);
      fixture.detectChanges();

      expect(fixture.componentInstance.emitted).toEqual(['01234565']);
      // The camera goes back the moment it has what it came for.
      expect(cameraStop).toHaveBeenCalled();
      expect(testId(fixture, 'barcode-scan-preview')).toBeNull();
    });

    it('keeps looking through frames that were never examined', async () => {
      // Null means a decode was already in flight or the video had no pixels — not
      // "no barcode here", so it must not end the scan.
      vi.useFakeTimers();
      detect.mockResolvedValue(null);
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      await vi.advanceTimersByTimeAsync(1000);
      fixture.detectChanges();

      expect(detect.mock.calls.length).toBeGreaterThan(1);
      expect(fixture.componentInstance.emitted).toHaveLength(0);
      expect(testId(fixture, 'barcode-scan-preview')).not.toBeNull();
    });

    it('waits for a picture before asking the decoder anything', async () => {
      vi.useFakeTimers();
      detectionSource.mockReturnValue(null);
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      await vi.advanceTimersByTimeAsync(1000);

      expect(detect).not.toHaveBeenCalled();
    });

    it('ignores a code too small to be the one being registered', async () => {
      // A barcode on a poster across the room is not what is in the operator's hand.
      vi.useFakeTimers();
      detect.mockResolvedValue([seen('4006381333931', 0.02)]);
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      await vi.advanceTimersByTimeAsync(1000);
      fixture.detectChanges();

      expect(fixture.componentInstance.emitted).toHaveLength(0);
      expect(testId(fixture, 'barcode-scan-preview')).not.toBeNull();
    });

    it('gives up rather than filming indefinitely', async () => {
      // A camera left running because someone walked away mid-registration is a
      // privacy problem, and the person who comes back cannot tell how long it has
      // been on.
      vi.useFakeTimers();
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      await vi.advanceTimersByTimeAsync(26_000);
      fixture.detectChanges();

      expect(cameraStop).toHaveBeenCalled();
      expect(testId(fixture, 'barcode-scan-failed')?.textContent).toContain("couldn't read");
      expect(testId(fixture, 'barcode-scan-preview')).toBeNull();
    });

    it('stops when asked, and gives the camera straight back', async () => {
      vi.useFakeTimers();
      const fixture = await mount();
      testId(fixture, 'btn-scan')!.click();
      await vi.advanceTimersByTimeAsync(300);
      fixture.detectChanges();

      testId(fixture, 'btn-scan-cancel')!.click();
      fixture.detectChanges();

      expect(cameraStop).toHaveBeenCalled();
      expect(testId(fixture, 'barcode-scan-preview')).toBeNull();
      expect(testId(fixture, 'barcode-scan-failed')).toBeNull();
    });

    it('names the likely culprit when the camera is already in use', async () => {
      // The service's own wording blames "another app", which is misleading when the
      // other app is this same POS with the clerk view open — the one thing the
      // operator can actually act on.
      cameraStart.mockResolvedValue(false);
      cameraStatus.set('error');
      cameraMessage.set('Another app is using the camera');
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(testId(fixture, 'barcode-scan-failed')?.textContent).toContain('Capy Clerk');
      expect(testId(fixture, 'barcode-scan-preview')).toBeNull();
    });

    it("passes on the camera's own reason when it has one", async () => {
      cameraStart.mockResolvedValue(false);
      cameraStatus.set('denied');
      cameraMessage.set('Camera permission was denied.');
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(testId(fixture, 'barcode-scan-failed')?.textContent).toContain(
        'permission was denied'
      );
    });

    it('says something even when the camera fails silently', async () => {
      cameraStart.mockResolvedValue(false);
      cameraStatus.set('idle');
      cameraMessage.set('');
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(testId(fixture, 'barcode-scan-failed')?.textContent).toContain('did not start');
    });

    it('releases the camera when the field goes away mid-scan', async () => {
      // Cancelling, saving, closing the dialog or navigating away all land here.
      vi.useFakeTimers();
      const fixture = await mount();
      testId(fixture, 'btn-scan')!.click();
      await vi.advanceTimersByTimeAsync(300);

      fixture.destroy();

      expect(cameraStop).toHaveBeenCalled();
    });

    it('survives a browser that refuses to play the preview', async () => {
      // Autoplay policies reject `play()`; the decode loop reads the element
      // directly and does not need the promise to have resolved.
      vi.useFakeTimers();
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('NotAllowedError'));
      detect.mockResolvedValue([seen('4006381333931')]);
      const fixture = await mount();

      testId(fixture, 'btn-scan')!.click();
      await vi.advanceTimersByTimeAsync(400);
      fixture.detectChanges();

      expect(fixture.componentInstance.emitted).toEqual(['4006381333931']);
    });
  });
});
