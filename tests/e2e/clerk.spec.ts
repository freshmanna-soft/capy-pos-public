import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * Capy Clerk E2E — the full-screen AI clerk at /clerk.
 *
 * These tests cover the parts of the feature that only exist in a real browser:
 * the camera permission handshake, the canvas mounting, the three confidence
 * branches driven through the whole stack, and the keyboard equivalents. The
 * decision logic itself is unit tested against `ClerkFacade`; this is about
 * whether the assembled page actually works.
 *
 * The camera is a real `MediaStream` produced from a canvas via
 * `captureStream()`, not a mock. That matters: the clerk's frame gate reads pixel
 * data off the `<video>` element, so a fake stream object would settle
 * immediately or not at all and prove nothing about the wiring. Chromium is the
 * only engine here for the same reason — `captureStream` plus the fake-device
 * flags are not portable, and the Web Speech APIs are absent in WebKit and
 * Firefox anyway.
 */

/**
 * Replace `getUserMedia` with a live canvas stream, and stub the Web Speech APIs.
 *
 * Runs as an init script so it is in place before Angular boots and before the
 * clerk asks for the camera.
 */
/**
 * Answer the frame-consent dialog before it is asked.
 *
 * The dialog only appears on a build with `aiVision` on, so a suite written
 * against the default dev build never meets it — and then every camera test in
 * here fails the moment it runs against the vision configuration, which is the
 * build a developer working on recognition actually has running. None of these
 * tests are about consent, so the answer is pre-recorded exactly as a returning
 * cashier's browser would have it.
 */
async function grantFrameConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('capy-clerk-camera-consent', 'granted');
    } catch {
      // Blocked storage: the dialog will appear and the test will say so.
    }
  });
}

async function installFakeMedia(page: Page): Promise<void> {
  await grantFrameConsent(page);
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;

    // A slowly shifting scene: the gate needs *something* to settle on, and a
    // single flat colour would never register the initial change.
    // Scene motion, switchable. The default is a shifting scene, because most tests
    // need the frame gate to see something change; the barcode tests turn it off,
    // because a cashier presenting a barcode holds it still and a counter that
    // repaints four times a second is correctly read as a stream of new items.
    let motion = true;
    (window as unknown as { __setSceneMotion: (on: boolean) => void }).__setSceneMotion = (on) => {
      motion = on;
    };

    let tick = 0;
    const paint = (): void => {
      if (!motion) {
        return;
      }
      tick++;
      context.fillStyle = `hsl(${(tick * 7) % 360} 45% 45%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.fillRect(220, 160, 200, 160);
    };
    paint();
    // Expose a way for tests to force a scene change on demand.
    (window as unknown as { __paintFrame: () => void }).__paintFrame = paint;
    setInterval(paint, 500);

    // Two distinct devices, each with its own scene, so a switch is observable.
    const scenes: Record<string, HTMLCanvasElement> = { 'cam-a': canvas };
    const shelf = document.createElement('canvas');
    shelf.width = 640;
    shelf.height = 480;
    const shelfContext = shelf.getContext('2d')!;
    const paintShelf = (): void => {
      shelfContext.fillStyle = motion ? `hsl(${(tick * 5) % 360} 30% 30%)` : '#22333b';
      shelfContext.fillRect(0, 0, shelf.width, shelf.height);
    };
    paintShelf();
    setInterval(paintShelf, 500);
    scenes['cam-b'] = shelf;

    const devices = [
      { kind: 'videoinput', deviceId: 'cam-a', label: 'Overhead cam (05ac:8514)', groupId: 'g1' },
      { kind: 'videoinput', deviceId: 'cam-b', label: 'Shelf cam', groupId: 'g2' },
      { kind: 'audioinput', deviceId: 'mic-a', label: 'Microphone', groupId: 'g3' },
    ];

    const opened: string[] = [];
    (window as unknown as { __openedCameras: string[] }).__openedCameras = opened;

    // Every track ever handed out. `srcObject === null` only says the element
    // stopped showing a picture; a track's readyState is the closest this harness
    // gets to asking whether the camera light is off.
    const issued: MediaStreamTrack[] = [];
    (window as unknown as { __issuedTracks: MediaStreamTrack[] }).__issuedTracks = issued;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: () => Promise.resolve(devices.map((d) => ({ ...d, toJSON: () => d }))),
        addEventListener: () => undefined,
        getUserMedia: (constraints: { video?: { deviceId?: { exact?: string } } }) => {
          const requested = constraints.video?.deviceId?.exact;
          if (requested && !scenes[requested]) {
            const error = new Error('device gone');
            error.name = 'OverconstrainedError';
            return Promise.reject(error);
          }
          const id = requested ?? 'cam-a';
          opened.push(id);
          const stream = scenes[id]!.captureStream(15);
          // Report the device id back the way a real track does, so the picker
          // can mark the row that is actually live.
          for (const track of stream.getVideoTracks()) {
            track.getSettings = () => ({ deviceId: id });
            issued.push(track);
          }
          return Promise.resolve(stream);
        },
      },
    });

    // A controllable barcode reader. `__showBarcode` is what a test uses to put a
    // code in front of the camera; real detection needs a physical barcode and is
    // absent on most engines, so the decoder itself is not what is under test —
    // the clerk's response to it is.
    const shown: { value: string; box: DOMRectReadOnly | null }[] = [];
    (window as unknown as { __showBarcode: (value: string | null) => void }).__showBarcode = (
      value
    ) => {
      shown.length = 0;
      if (value !== null) {
        shown.push({ value, box: null });
      }
    };
    class FakeBarcodeDetector {
      static getSupportedFormats(): Promise<string[]> {
        return Promise.resolve(['ean_13', 'code_128', 'qr_code']);
      }
      detect(): Promise<{ rawValue: string; format: string; boundingBox: DOMRect }[]> {
        return Promise.resolve(
          shown.map((entry) => ({
            rawValue: entry.value,
            format: 'ean_13',
            // Centred and filling a third of the frame — a deliberate presentation.
            boundingBox: new DOMRect(200, 150, 240, 120),
          }))
        );
      }
    }
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      value: FakeBarcodeDetector,
    });

    // Speech recognition, driven by the test rather than by a microphone.
    //
    // Stubbed here rather than skipped because the path from a final transcript to
    // an intent is the whole feature, and it is the one part no unit test can
    // reach: the service resolves its constructor at field-init of a root
    // singleton, so this has to exist before the app boots.
    interface FakeRecognition {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      maxAlternatives: number;
      onstart: (() => void) | null;
      onresult: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      onerror: ((event: { error: string }) => void) | null;
      start(): void;
      stop(): void;
      abort(): void;
    }

    let current: FakeRecognition | null = null;
    // A constructor function that returns its own object, so `new` gets it and
    // nothing has to alias `this`. The service only checks `typeof ctor` before
    // calling `new`, so this satisfies it.
    function FakeSpeechRecognition(): FakeRecognition {
      const recognition: FakeRecognition = {
        continuous: false,
        interimResults: false,
        lang: '',
        maxAlternatives: 1,
        onstart: null,
        onresult: null,
        onend: null,
        onerror: null,
        start: () => {
          current = recognition;
          recognition.onstart?.();
        },
        // The service detaches its handlers before aborting, so firing `onend`
        // here is what a real engine does without triggering the restart watchdog.
        stop: () => recognition.onend?.(),
        abort: () => recognition.onend?.(),
      };
      return recognition;
    }
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition,
    });

    // Deliver one finished phrase, shaped the way the Web Speech API shapes it.
    (window as unknown as { __say: (phrase: string) => boolean }).__say = (phrase) => {
      if (!current?.onresult) {
        return false;
      }
      const alternative = { transcript: phrase, confidence: 0.95 };
      const result = { isFinal: true, length: 1, item: () => alternative };
      current.onresult({ resultIndex: 0, results: { length: 1, item: () => result } });
      return true;
    };

    // Speech synthesis: record what was said, never make a sound.
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: (utterance: { text: string; onstart?: () => void; onend?: () => void }) => {
          spoken.push(utterance.text);
          utterance.onstart?.();
          utterance.onend?.();
        },
        cancel: () => undefined,
        getVoices: () => [],
        addEventListener: () => undefined,
      },
    });
  });
}

/** Deny the camera, to exercise the blocked path. */
async function installDeniedCamera(page: Page): Promise<void> {
  await grantFrameConsent(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => {
          const error = new Error('Permission denied');
          error.name = 'NotAllowedError';
          return Promise.reject(error);
        },
      },
    });
  });
}

class ClerkPage {
  constructor(readonly page: Page) {}

  get stage() {
    return this.page.getByTestId('clerk-stage');
  }
  get canvas() {
    return this.page.getByTestId('capybara-canvas');
  }
  get caption() {
    return this.page.getByTestId('clerk-caption');
  }
  get candidates() {
    return this.page.getByTestId('clerk-candidates');
  }
  get undo() {
    return this.page.getByTestId('clerk-undo');
  }
  get cartSummary() {
    return this.page.getByTestId('clerk-cart-summary');
  }
  get exitButton() {
    return this.page.getByTestId('clerk-exit');
  }
  get glassToggle() {
    return this.page.getByTestId('clerk-glass-toggle');
  }
  get cameraToggle() {
    return this.page.getByTestId('clerk-camera-toggle');
  }
  get micButton() {
    return this.page.getByTestId('clerk-mic');
  }
  get previewOff() {
    return this.page.getByTestId('clerk-preview-off');
  }
  get aiToggle() {
    return this.page.getByTestId('clerk-ai-toggle');
  }
  get aiOffBadge() {
    return this.page.getByTestId('clerk-ai-off-badge');
  }
  get muteButton() {
    return this.page.getByTestId('clerk-mute');
  }
  get mutedBadge() {
    return this.page.getByTestId('clerk-muted-badge');
  }

  /** Everything that actually reached the synthesizer this session. */
  spokenAloud(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  }

  /** True once every camera track this page was ever handed has ended. */
  allTracksEnded(): Promise<boolean> {
    return this.page.evaluate(() => {
      const issued = (window as unknown as { __issuedTracks: MediaStreamTrack[] }).__issuedTracks;
      return issued.length > 0 && issued.every((track) => track.readyState === 'ended');
    });
  }

  /** Turn the mic on and say something to it. */
  async say(phrase: string): Promise<void> {
    await this.page.evaluate((text) => {
      (window as unknown as { __say: (phrase: string) => boolean }).__say(text);
    }, phrase);
  }

  async open(): Promise<void> {
    await this.page.goto('/clerk');
    await this.stage.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Wait until the clerk has done something with an item.
   *
   * The mock recognizer cycles high → medium → low confidence, so within three
   * looks all three branches will have been taken. Each look needs the scene to
   * settle and the minimum interval to elapse, so this is deliberately patient.
   */
  async waitForAnyOutcome(): Promise<void> {
    await expect(this.caption.or(this.candidates).first()).toBeVisible({ timeout: 20000 });
  }
}

test.describe('Capy Clerk', () => {
  // Chromium only: canvas.captureStream and the Web Speech shims are not
  // portable, and recognition does not exist in WebKit or Firefox at all.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium-only APIs');

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await installFakeMedia(page);
    await loginAsAdmin(page);
  });

  test('opens as a full-screen stage over the app navigation', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();

    await expect(clerk.canvas).toBeVisible();
    // It is a mode, not a panel: the stage covers the whole viewport.
    const box = await clerk.stage.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.width).toBeCloseTo(viewport.width, 0);
    expect(box!.height).toBeCloseTo(viewport.height, 0);
  });

  test('greets the cashier out loud and in text', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();

    // The voice is an enhancement; the caption is the actual channel.
    await expect(clerk.caption).toContainText('Hold something up', { timeout: 15000 });
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
    expect(spoken.join(' ')).toContain('Hold something up');
  });

  test('sizes the canvas to the device pixel ratio', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();

    const sized = await clerk.canvas.evaluate((el: HTMLCanvasElement) => ({
      backing: el.width,
      css: el.getBoundingClientRect().width,
      dpr: Math.min(2, window.devicePixelRatio || 1),
    }));
    expect(sized.backing).toBe(Math.round(sized.css * sized.dpr));
  });

  test('recognizes an item and puts it in the cart, reversibly', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await clerk.waitForAnyOutcome();

    // The demo recognizer's first look is high-confidence, so the first outcome
    // is an add with an undo window.
    await expect(clerk.undo).toBeVisible({ timeout: 20000 });
    await expect(clerk.cartSummary).toContainText('1 item');

    await clerk.undo.click();

    await expect(clerk.undo).toBeHidden();
    await expect(clerk.cartSummary).toContainText('0 items');
  });

  test('offers a choice instead of guessing when it is unsure', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();

    // Second look in the cycle is the medium-confidence branch.
    await expect(clerk.candidates).toBeVisible({ timeout: 30000 });
    const options = clerk.candidates.getByRole('button');
    expect(await options.count()).toBeGreaterThan(1);

    // Options are numbered because the number is also the command.
    await expect(options.first()).toContainText('1');
    await expect(options.first()).toContainText('Confidence');

    await options.nth(1).click();
    await expect(clerk.candidates).toBeHidden();
    await expect(clerk.cartSummary).not.toContainText('0 items');
  });

  test('takes a numbered choice from the keyboard', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.candidates).toBeVisible({ timeout: 30000 });

    await page.keyboard.press('2');

    await expect(clerk.candidates).toBeHidden();
  });

  test('undoes from the keyboard', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.undo).toBeVisible({ timeout: 20000 });

    await page.keyboard.press('u');

    await expect(clerk.undo).toBeHidden();
    await expect(clerk.cartSummary).toContainText('0 items');
  });

  test('lets the cashier clear the glass to aim the camera', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();

    const feed = page.getByTestId('clerk-feed');
    await expect(feed).toHaveClass(/clerk-feed--glass/);

    await clerk.glassToggle.click();

    await expect(feed).toHaveClass(/clerk-feed--clear/);
    await expect(clerk.glassToggle).toContainText('Steam up');
  });

  test('shares one cart with the terminal', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.undo).toBeVisible({ timeout: 20000 });

    await clerk.exitButton.click();

    // Same CartService: an item scanned by the clerk is on the terminal's cart.
    await expect(page.getByTestId('pos-terminal')).toBeVisible();
    await expect(page.getByTestId('cart-section')).toContainText(/\$\d/);
  });

  test('releases the camera on the way out', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    await clerk.exitButton.click();
    await expect(page.getByTestId('pos-terminal')).toBeVisible();

    // A till that keeps filming after the cashier has navigated away is a real
    // problem, not a leak to shrug at.
    const live = await page.evaluate(() =>
      Array.from(document.querySelectorAll('video')).some(
        (video) => (video as HTMLVideoElement).srcObject !== null
      )
    );
    expect(live).toBe(false);
    // Asserted on the tracks as well, because a paused camera also leaves
    // `srcObject` null — the element letting go is not the hardware letting go,
    // and only one of those two claims is what this test is about.
    expect(await clerk.allTracksEnded()).toBe(true);
    await expect(clerk.stage).toBeHidden();
  });

  test('leaves via the keyboard', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();

    await page.keyboard.press('Escape');

    await expect(page.getByTestId('pos-terminal')).toBeVisible();
  });

  test('is reachable from the terminal', async ({ page }) => {
    await page.goto('/pos');
    await page.getByTestId('ask-capy-btn').click();
    await expect(page.getByTestId('clerk-stage')).toBeVisible();
  });
});

test.describe('Capy Clerk reading barcodes', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium-only APIs');

  /** A barcode from the seeded catalogue, and one that is not in it. */
  const STOCKED = '1234567890123';
  const UNKNOWN = '9999999999999';

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await installFakeMedia(page);
    await loginAsAdmin(page);
  });

  async function show(page: Page, value: string | null): Promise<void> {
    await page.evaluate(
      (v) => (window as unknown as { __showBarcode: (x: string | null) => void }).__showBarcode(v),
      value
    );
  }

  /** Hold the counter still, the way it is when someone presents a barcode. */
  async function stillCounter(page: Page, still = true): Promise<void> {
    await page.evaluate(
      (on) =>
        (window as unknown as { __setSceneMotion: (x: boolean) => void }).__setSceneMotion(!on),
      still
    );
  }

  test('mentions barcodes when it can read them', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();

    await expect(clerk.caption).toContainText('barcode', { timeout: 15000 });
  });

  test('rings up a stocked barcode', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    await show(page, STOCKED);

    // A barcode is certainty, so it goes straight in — with the same undo window
    // as anything else.
    await expect(clerk.undo).toBeVisible({ timeout: 10000 });
    await expect(clerk.cartSummary).not.toContainText('0 items');
  });

  test('rings up one item however long the code is held', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });
    await stillCounter(page);

    await show(page, STOCKED);
    await expect(clerk.cartSummary).toContainText('1 item', { timeout: 10000 });

    // Several seconds of the same code in frame is still one jar — and the model
    // must not be asked about the same still scene and add a second.
    await page.waitForTimeout(2500);

    await expect(clerk.cartSummary).toContainText('1 item');
  });

  test('ignores a code that only crosses the frame', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });
    await stillCounter(page);

    // A shelf label sweeping past on its way somewhere else. It decodes perfectly,
    // which is exactly why it used to sell.
    await show(page, STOCKED);
    await page.waitForTimeout(150);
    await show(page, null);

    await page.waitForTimeout(1500);
    await expect(clerk.undo).toBeHidden();
    await expect(clerk.cartSummary).toContainText('0 items');
  });

  test('says so when a code is not in the catalogue', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    await show(page, UNKNOWN);

    await expect(clerk.caption).toContainText("isn't in the catalogue", { timeout: 10000 });
  });

  test('draws on the canvas while a code is in frame', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    // The brackets are canvas pixels, so compare the rendered frame rather than
    // looking for DOM: sample the region the box occupies before and after.
    const sample = async (): Promise<string> =>
      clerk.canvas.evaluate((el: HTMLCanvasElement) => {
        const target = document.createElement('canvas');
        target.width = 120;
        target.height = 90;
        const ctx = target.getContext('2d')!;
        // The stub reports a box at 200,150 of a 640x480 frame — around a third
        // across and a third down, wherever that lands after the cover crop.
        ctx.drawImage(el, el.width * 0.28, el.height * 0.28, el.width * 0.24, el.height * 0.2, 0, 0, 120, 90);
        return target.toDataURL();
      });

    const before = await sample();
    await show(page, UNKNOWN);
    await page.waitForTimeout(700);
    const during = await sample();

    expect(during).not.toBe(before);
  });

  test('goes back to using its eyes when the code leaves the frame', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    await stillCounter(page);
    await show(page, STOCKED);
    await expect(clerk.cartSummary).toContainText('1 item', { timeout: 10000 });

    await show(page, null);
    await stillCounter(page, false);

    // The AI path is still there for produce and anything unlabelled, so the clerk
    // carries on looking rather than waiting for another barcode.
    await expect(clerk.caption.or(clerk.candidates).first()).toBeVisible({ timeout: 20000 });
  });
});

test.describe('Capy Clerk with more than one camera', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium-only APIs');

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await installFakeMedia(page);
    await loginAsAdmin(page);
  });

  test('offers the cameras it can see, and marks the live one', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();

    const picker = page.getByTestId('clerk-camera-picker');
    await expect(picker).toBeVisible({ timeout: 15000 });

    const options = page.getByTestId('clerk-camera-option');
    await expect(options).toHaveCount(2);
    // The USB id Chromium appends is stripped; the microphone is not a camera.
    await expect(options.first()).toContainText('Overhead cam');
    await expect(options.first()).not.toContainText('05ac');
    await expect(options.first()).toHaveAttribute('aria-checked', 'true');
    await expect(options.nth(1)).toHaveAttribute('aria-checked', 'false');
  });

  test('switches camera and says which one it is looking through', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(page.getByTestId('clerk-camera-picker')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('clerk-camera-option').nth(1).click();

    await expect(clerk.caption).toContainText('Looking through Shelf cam', { timeout: 10000 });
    await expect(page.getByTestId('clerk-camera-option').nth(1)).toHaveAttribute(
      'aria-checked',
      'true'
    );
    const opened = await page.evaluate(
      () => (window as unknown as { __openedCameras: string[] }).__openedCameras
    );
    expect(opened).toContain('cam-b');
  });

  test('cycles cameras from the keyboard', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(page.getByTestId('clerk-camera-picker')).toBeVisible({ timeout: 15000 });

    await page.keyboard.press('c');

    await expect(clerk.caption).toContainText('Looking through Shelf cam', { timeout: 10000 });
  });

  test('remembers the camera for next time', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(page.getByTestId('clerk-camera-picker')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('clerk-camera-option').nth(1).click();
    await expect(clerk.caption).toContainText('Looking through Shelf cam', { timeout: 10000 });

    // A till should not have to re-pick its overhead camera every morning.
    await clerk.open();

    await expect(page.getByTestId('clerk-camera-option').nth(1)).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 15000 }
    );
  });

  test('falls back to a working camera when the remembered one has gone', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('capy-clerk-camera', 'cam-unplugged'));

    const clerk = new ClerkPage(page);
    await clerk.open();

    // No dead stage: it asks for the missing device, is refused, and opens the
    // browser's choice instead.
    await expect(clerk.caption).toContainText('Hold something up', { timeout: 15000 });
    const opened = await page.evaluate(
      () => (window as unknown as { __openedCameras: string[] }).__openedCameras
    );
    expect(opened).toContain('cam-a');
  });

  test('keeps one camera live at a time', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(page.getByTestId('clerk-camera-picker')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('clerk-camera-option').nth(1).click();
    await expect(clerk.caption).toContainText('Looking through Shelf cam', { timeout: 10000 });

    // The old stream is released, so the camera light goes out on the one we left.
    const liveTracks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('video'))
        .map((video) => (video as HTMLVideoElement).srcObject as MediaStream | null)
        .filter((stream): stream is MediaStream => stream !== null)
        .flatMap((stream) => stream.getVideoTracks())
        .filter((track) => track.readyState === 'live').length
    );
    // Both video elements share the one stream, so a single live track.
    expect(liveTracks).toBeGreaterThan(0);
    const settings = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      const stream = video.srcObject as MediaStream;
      return stream.getVideoTracks()[0]!.getSettings().deviceId;
    });
    expect(settings).toBe('cam-b');
  });
});

test.describe('Capy Clerk without a camera', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium-only APIs');

  test('explains what to do rather than showing a dead stage', async ({ page }) => {
    await installDeniedCamera(page);
    await loginAsAdmin(page);
    await page.goto('/clerk');

    const blocked = page.getByTestId('clerk-blocked');
    await expect(blocked).toBeVisible({ timeout: 15000 });
    await expect(blocked).toContainText(/blocked/i);

    // And there is a way back, not just a dead end.
    await blocked.getByRole('button').click();
    await expect(page.getByTestId('pos-terminal')).toBeVisible();
  });
});

test.describe('Capy Clerk with the camera switched off', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium-only APIs');

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await installFakeMedia(page);
    await loginAsAdmin(page);
  });

  test('gives the camera back without ending the session', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    await clerk.cameraToggle.click();

    // The hardware is really released — a privacy switch that only blanks the
    // picture is not a privacy switch.
    await expect.poll(() => clerk.allTracksEnded()).toBe(true);
    // And the till is still open for business, which is the whole point.
    await expect(clerk.stage).toBeVisible();
    await expect(clerk.cartSummary).toBeVisible();
    await expect(clerk.previewOff).toBeVisible();
    // Picking a camera from the list would call getUserMedia and turn the light
    // back on behind the operator's back.
    await expect(page.getByTestId('clerk-camera-picker')).toBeHidden();
  });

  test('comes back on from the keyboard', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    const openedBefore = await page.evaluate(
      () => (window as unknown as { __openedCameras: string[] }).__openedCameras.length
    );

    await page.keyboard.press('v');
    await expect(clerk.previewOff).toBeVisible();
    await page.keyboard.press('v');
    await expect(clerk.previewOff).toBeHidden();

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __openedCameras: string[] }).__openedCameras.length
        )
      )
      .toBeGreaterThan(openedBefore);
  });

  test('rings a sale through on voice alone', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    // Camera off first, so nothing that lands in the cart could have come from
    // the recognizer — every item here was spoken.
    await clerk.cameraToggle.click();
    await expect(clerk.previewOff).toBeVisible();
    await clerk.micButton.click();

    await clerk.say('add two coffees');
    await expect(clerk.cartSummary).toContainText('2 items');

    await clerk.say('remove a coffee');
    await expect(clerk.cartSummary).toContainText('1 item');

    // The bug that started this: an understood command must never be answered
    // with silence.
    await clerk.say('add a pineapple');
    await expect(clerk.caption).toContainText('pineapple');
  });
});

test.describe('Capy Clerk in barcode-only mode', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium-only APIs');

  /** A barcode the seeded catalogue knows. */
  const STOCKED = '1234567890123';

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await installFakeMedia(page);
    await loginAsAdmin(page);
  });

  test('rings up barcodes with recognition switched off', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    await clerk.aiToggle.click();
    // Said in two places, because a till that has stopped guessing looks exactly
    // like one that is failing to.
    await expect(clerk.aiOffBadge).toBeVisible();
    await expect(clerk.aiToggle).toContainText('Barcodes only');

    // The camera is deliberately still live — a barcode needs a picture too.
    expect(await clerk.allTracksEnded()).toBe(false);

    // A cashier presenting a code holds it still. In this mode it does not have to be
    // held *for* anything — with no model racing the bars there is no dwell to wait
    // out, which the facade spec pins to the frame it happens on. A wall clock in a
    // browser is the wrong instrument for that, so this only asserts the sale.
    await page.evaluate(() =>
      (window as unknown as { __setSceneMotion: (x: boolean) => void }).__setSceneMotion(false)
    );
    await page.evaluate(
      (value) =>
        (window as unknown as { __showBarcode: (x: string | null) => void }).__showBarcode(value),
      STOCKED
    );

    await expect(clerk.cartSummary).toContainText('1 item', { timeout: 15000 });
  });

  test('comes back from the keyboard', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    await page.keyboard.press('a');
    await expect(clerk.aiOffBadge).toBeVisible();
    await page.keyboard.press('a');
    await expect(clerk.aiOffBadge).toBeHidden();
    await expect(clerk.aiToggle).toContainText('Recognizing');
  });
});

test.describe('Capy Clerk with her voice muted', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium-only APIs');

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['camera']);
    await installFakeMedia(page);
    await loginAsAdmin(page);
  });

  test('stops speaking and keeps captioning', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toContainText('Hold something up', { timeout: 15000 });

    await clerk.muteButton.click();
    await expect(clerk.muteButton).toContainText('Muted');
    // Said in two places, like recognition being off: a silent till and a broken
    // speaker look identical from the other side of the counter.
    await expect(clerk.mutedBadge).toBeVisible();

    // The confirmation itself makes the point: captioned, never uttered.
    await expect(clerk.caption).toContainText('captioning');
    const before = await clerk.spokenAloud();

    // And she carries on working. A barcode rings an item up — deliberately the
    // barcode rather than the recognizer, so this test says the same thing whether
    // the build in front of it uses the offline recognizer or a live one.
    await page.evaluate(() =>
      (window as unknown as { __setSceneMotion: (x: boolean) => void }).__setSceneMotion(false)
    );
    await page.evaluate(
      (value) =>
        (window as unknown as { __showBarcode: (x: string | null) => void }).__showBarcode(value),
      '1234567890123'
    );
    await expect(clerk.cartSummary).toContainText(/[1-9]\d* item/, { timeout: 15000 });

    // That add came with a line she would have spoken, and the synthesizer never
    // heard about any of it.
    await expect(clerk.caption).toContainText('added');
    expect(await clerk.spokenAloud()).toEqual(before);
  });

  test('mutes and unmutes from the keyboard, and remembers it', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });

    await page.keyboard.press('q');
    await expect(clerk.mutedBadge).toBeVisible();

    // A shop that does not want a talking till does not want one tomorrow either.
    await page.reload();
    await expect(clerk.mutedBadge).toBeVisible({ timeout: 15000 });
    await expect(clerk.muteButton).toContainText('Muted');

    await page.keyboard.press('q');
    await expect(clerk.mutedBadge).toBeHidden();
    await expect(clerk.muteButton).toContainText('Speaking');
    expect((await clerk.spokenAloud()).join(' ')).toContain('Voice back on');
  });

  test('goes quiet when asked out loud, and still listens', async ({ page }) => {
    const clerk = new ClerkPage(page);
    await clerk.open();
    await expect(clerk.caption).toBeVisible({ timeout: 15000 });
    await clerk.micButton.click();

    await clerk.say('be quiet');
    await expect(clerk.mutedBadge).toBeVisible();

    // Silencing her is not deafening her: the next command still has to land, and
    // the microphone is the only way it can.
    await expect(clerk.micButton).toContainText('Listening');
    await clerk.say('unmute');
    await expect(clerk.mutedBadge).toBeHidden();
  });
});
