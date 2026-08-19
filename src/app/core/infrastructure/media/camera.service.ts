import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import {
  CameraOption,
  fallbackCameraId,
  nextCameraId,
  resolveCameraRequest,
  toCameraOptions,
  toVideoConstraints,
} from '@core/infrastructure/media/camera-selection';

/** Edge length of the motion-detection sample. 32x32 is 1024 comparisons. */
const SAMPLE_EDGE = 32;

/**
 * Longest edge of a captured frame, in pixels.
 *
 * This is a cost dial as much as a quality one. Image tokens scale with area, so
 * 768px is roughly 600 tokens where a full-resolution 2576px frame would be
 * nearly 4800 — eight times the price for detail that doesn't help name a
 * cereal box. Raise it only if recognition is actually failing on small print.
 */
const CAPTURE_MAX_EDGE = 768;

/** JPEG quality. Below ~0.6 compression artefacts start costing accuracy. */
const CAPTURE_QUALITY = 0.7;

/**
 * Where the chosen camera is remembered.
 *
 * Per browser profile, which in practice means per till — the overhead camera on
 * lane 3 stays selected on lane 3 across restarts, and a cashier never has to
 * pick it twice.
 */
const CAMERA_PREFERENCE_KEY = 'capy-clerk-camera';

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'live'
  /**
   * Deliberately released while the session carries on.
   *
   * Distinct from 'idle' because 'idle' means "never started, or finished for
   * good", and the clerk reads that as the session having ended. A paused camera
   * is a live till with its eyes shut.
   */
  | 'paused'
  /** The person said no, or the browser blocked us. Recoverable by them. */
  | 'denied'
  /** No camera exists, or the browser has no camera API. Not recoverable here. */
  | 'unavailable'
  | 'error';

export interface CapturedFrame {
  /** Bare base64 JPEG — no `data:` prefix. */
  base64: string;
  width: number;
  height: number;
}

/**
 * CameraService
 *
 * Owns the camera stream for the clerk: permission, lifecycle, and turning the
 * live video into the two things the rest of the feature needs — a small
 * grayscale sample for motion detection, and a compressed still for recognition.
 *
 * State is exposed as signals because the app is zoneless
 * (`provideZonelessChangeDetection`). `getUserMedia` resolves outside Angular's
 * knowledge, so a plain field set in that callback would update the object and
 * never repaint the screen.
 *
 * The service does not create the `<video>` element. The clerk component renders
 * it (it's part of the visual composition) and hands it over with `attach`.
 *
 * One camera is live at a time. Which one is a choice, not an accident:
 * `facingMode: 'environment'` is meaningless on a desktop with a built-in webcam
 * and a USB document camera, and it will happily pick the one pointed at the
 * ceiling. The selection *rules* live in `camera-selection.ts`, which is pure and
 * tested; this file is the plumbing around them.
 */
@Injectable({ providedIn: 'root' })
export class CameraService implements OnDestroy {
  private readonly _status = signal<CameraStatus>('idle');
  private readonly _message = signal<string>('');

  readonly status = this._status.asReadonly();
  /** Operator-facing explanation when something is wrong. Empty when fine. */
  readonly message = this._message.asReadonly();
  readonly isLive = computed(() => this._status() === 'live');

  private readonly _cameras = signal<CameraOption[]>([]);
  private readonly _activeCameraId = signal<string | null>(null);

  /**
   * Video inputs the cashier can pick between.
   *
   * Empty until permission is granted — browsers withhold both labels and, in
   * Safari, device ids from an unpermissioned page. The list is populated after
   * the first successful `getUserMedia`, so the picker appears once the camera is
   * actually running rather than showing a row of anonymous entries beforehand.
   */
  readonly cameras = this._cameras.asReadonly();
  readonly activeCameraId = this._activeCameraId.asReadonly();
  /** A picker with one option is noise, so the HUD asks before rendering one. */
  readonly hasChoice = computed(() => this._cameras().length > 1);

  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private preview: HTMLVideoElement | null = null;
  /**
   * Aborts the `devicechange` subscription when this instance goes away.
   *
   * Needed because the service is no longer only a root singleton: the inventory
   * scanner provides its own instance per dialog, and a listener that outlived it
   * would keep calling `refreshCameras()` on a discarded service — one more dead
   * listener for every scan the shop ever starts.
   */
  private readonly deviceWatch = new AbortController();
  private deviceChangeBound = false;
  /**
   * True while we are deliberately giving the camera back.
   *
   * `stopTracks` ends the tracks before it clears `this.stream`, so an engine that
   * fires `ended` synchronously from `track.stop()` reaches the loss-recovery
   * handler while the stream still looks current. Without this flag that handler
   * treats an intentional release as a yanked cable and reopens a camera — which
   * during a privacy pause means the indicator light comes back on by itself.
   */
  private releasing = false;

  /** Reused across frames — allocating a canvas per frame would thrash the GC. */
  private captureCanvas: HTMLCanvasElement | null = null;
  private sampleCanvas: HTMLCanvasElement | null = null;
  private sampleBuffer = new Uint8Array(SAMPLE_EDGE * SAMPLE_EDGE);

  /** Give the service the element it should render the stream into. */
  attach(video: HTMLVideoElement): void {
    this.video = video;
    if (this.stream) {
      video.srcObject = this.stream;
    }
  }

  /**
   * Attach a second element showing the same stream untreated.
   *
   * The main feed is styled as steamy bathhouse glass, which is atmospheric but
   * useless for aiming a camera. One `MediaStream` can back several video
   * elements, so the preview is a real second view of the same feed rather than
   * a copied frame.
   */
  attachPreview(video: HTMLVideoElement): void {
    this.preview = video;
    if (this.stream) {
      video.srcObject = this.stream;
    }
  }

  /**
   * Ask for the camera and start streaming.
   *
   * @returns true when the stream is live.
   */
  async start(): Promise<boolean> {
    if (this._status() === 'live') {
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail('unavailable', 'This browser has no camera support. Use the search panel instead.');
      return false;
    }

    const request = resolveCameraRequest(this._cameras(), readPreferredCamera());
    let opened = await this.open(request);

    // A remembered device that no longer exists is the common failure here — the
    // USB camera went home in someone's bag — so retry on the browser's own
    // choice rather than leaving the till with no eyes. Not worth retrying when
    // permission was refused: the answer will be the same, and a second failed
    // attempt just buries the real reason in the log.
    if (!opened && request.kind === 'device' && this._status() !== 'denied') {
      opened = await this.open({ kind: 'default' });
    }
    if (!opened) {
      return false;
    }

    await this.refreshCameras();
    this.watchDeviceChanges();
    return true;
  }

  /**
   * Switch to a specific camera.
   *
   * The choice is remembered only once the device actually opens. Persisting the
   * intent instead would mean one tap on a camera that is unplugged or busy
   * silently downgrades every future session from the known-good camera to
   * whatever the browser picks.
   *
   * On failure the previous camera is reopened, so a bad choice costs a moment
   * rather than leaving the till blind. Reporting it is the caller's job — the
   * clerk says so out loud.
   *
   * @returns true when the requested camera is live.
   */
  async select(deviceId: string): Promise<boolean> {
    if (deviceId === this._activeCameraId() && this._status() === 'live') {
      return true;
    }

    const previous = this._activeCameraId();

    if (await this.open({ kind: 'device', deviceId })) {
      writePreferredCamera(deviceId);
      await this.refreshCameras();
      return true;
    }

    if (previous !== null && previous !== deviceId) {
      await this.open({ kind: 'device', deviceId: previous });
    }
    return false;
  }

  /** Move to the next camera in the list. No-op when there is only one. */
  async cycle(): Promise<boolean> {
    const next = nextCameraId(this._cameras(), this._activeCameraId());
    return next === null ? false : this.select(next);
  }

  /** The name of the live camera, for captions and the picker. */
  activeCameraLabel(): string {
    const id = this._activeCameraId();
    return this._cameras().find((camera) => camera.deviceId === id)?.label ?? 'Camera';
  }

  /**
   * Open a stream and route it into the attached elements.
   *
   * Tears down the previous stream first: two live streams on the same physical
   * device fails on most platforms, and holding the old one open would keep the
   * camera light on after a switch.
   */
  private async open(request: ReturnType<typeof resolveCameraRequest>): Promise<boolean> {
    this.stopTracks();
    this._status.set('requesting');
    this._message.set('');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: toVideoConstraints(request),
        audio: false,
      });
    } catch (error) {
      this.fail(...describeCameraError(error));
      return false;
    }

    this.stream = stream;
    // Read the id back off the track rather than trusting the request: on a
    // `default` request the browser chose, and we need to know what it chose to
    // mark the right row in the picker.
    this._activeCameraId.set(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null);
    this.watchTrackLoss(stream);

    if (this.preview) {
      this.preview.srcObject = stream;
      void this.preview.play().catch(() => undefined);
    }

    if (this.video) {
      this.video.srcObject = stream;
      try {
        await this.video.play();
      } catch {
        // Autoplay can be refused even for a muted stream. The stream is still
        // live and the frame grabs still work, so this isn't fatal.
      }
    }

    this._status.set('live');
    return true;
  }

  /**
   * Re-read the device list.
   *
   * Called after every successful open, because that is the first moment the
   * browser will tell us the labels, and on `devicechange` so a camera plugged in
   * mid-shift shows up without a reload.
   */
  private async refreshCameras(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      this._cameras.set(toCameraOptions(await navigator.mediaDevices.enumerateDevices()));
    } catch (error) {
      // A picker we cannot populate is not worth failing a sale over.
      console.warn('[Camera] Could not list cameras:', error);
    }
  }

  private watchDeviceChanges(): void {
    if (this.deviceChangeBound || !navigator.mediaDevices?.addEventListener) {
      return;
    }
    this.deviceChangeBound = true;
    navigator.mediaDevices.addEventListener('devicechange', () => void this.refreshCameras(), {
      signal: this.deviceWatch.signal,
    });
  }

  /**
   * Release everything when the injector that owns this instance is destroyed.
   *
   * Angular destroys a component-level provider's injector but calls nothing on the
   * instance, so without this a dialog that provides its own `CameraService` would
   * close with the stream — and the indicator light — still on. The root instance
   * only reaches this at application teardown, where stopping is right anyway.
   */
  ngOnDestroy(): void {
    this.deviceWatch.abort();
    this.stop();
  }

  /**
   * Recover when the live camera disappears — a nudged USB cable, a hub power
   * blip. The track ends silently, so without this the stage keeps rendering a
   * frozen last frame and the clerk simply stops noticing anything.
   */
  private watchTrackLoss(stream: MediaStream): void {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      return;
    }
    track.addEventListener('ended', () => {
      void (async () => {
        // Ignore an `ended` we asked for, and one from a stream already replaced.
        if (this.releasing || this.stream !== stream) {
          return;
        }
        const lost = this._activeCameraId();
        await this.refreshCameras();
        const replacement = fallbackCameraId(this._cameras(), lost);
        if (replacement !== null && (await this.open({ kind: 'device', deviceId: replacement }))) {
          return;
        }
        this.fail('unavailable', 'The camera was disconnected.');
      })();
    });
  }

  /**
   * Release the camera without ending anything.
   *
   * The hardware really is given back — the indicator light goes out — because a
   * privacy switch that only blanks the picture is not a privacy switch.
   *
   * The device list and the active id are both kept, unlike `stop()`: they are
   * what `resume()` reopens and what keeps the picker's checked row correct while
   * the camera is dark.
   */
  pause(): void {
    this.stopTracks();
    this._status.set('paused');
    this._message.set('');
  }

  /**
   * Reopen the camera that was live when `pause()` was called.
   *
   * Not `start()`: that re-reads the saved preference, so a till whose operator
   * had switched to the shelf camera without making it the default would come
   * back up looking at the wrong thing. Falls back to the browser's choice when
   * the remembered device has gone in the meantime.
   *
   * @returns true when a stream is live again.
   */
  async resume(): Promise<boolean> {
    if (this._status() === 'live') {
      return true;
    }
    const previous = this._activeCameraId();
    if (previous !== null && (await this.open({ kind: 'device', deviceId: previous }))) {
      return true;
    }
    return this.open({ kind: 'default' });
  }

  /** Stop the camera and release the hardware. */
  stop(): void {
    this.stopTracks();
    this._activeCameraId.set(null);
    if (
      this._status() === 'live' ||
      this._status() === 'requesting' ||
      this._status() === 'paused'
    ) {
      this._status.set('idle');
    }
  }

  /**
   * Release the stream without touching status.
   *
   * Separate from `stop()` so switching cameras doesn't flash the session through
   * 'idle', which the facade reads as the session having ended.
   */
  private stopTracks(): void {
    this.releasing = true;
    try {
      this.stream?.getTracks().forEach((track) => track.stop());
    } finally {
      this.releasing = false;
    }
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
    }
    if (this.preview) {
      this.preview.srcObject = null;
    }
  }

  /**
   * Downsampled grayscale luma for motion detection.
   *
   * Returns null until the video has real dimensions — the first frames after
   * `play()` have width 0 and would produce a garbage sample that reads as a
   * huge scene change.
   */
  sampleFrame(): Uint8Array | null {
    const video = this.readyVideo();
    if (!video) {
      return null;
    }

    this.sampleCanvas ??= createCanvas(SAMPLE_EDGE, SAMPLE_EDGE);
    const context = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
    const { data } = context.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Rec. 601 luma. Perceptual weighting matters here: a red-to-green swap at
      // equal brightness should register as a change, and averaging RGB hides it.
      this.sampleBuffer[p] = (data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 8;
    }
    return this.sampleBuffer;
  }

  /** Compressed still of the current frame, ready to send to the recognizer. */
  captureFrame(maxEdge = CAPTURE_MAX_EDGE): CapturedFrame | null {
    const video = this.readyVideo();
    if (!video) {
      return null;
    }

    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    this.captureCanvas ??= createCanvas(width, height);
    if (this.captureCanvas.width !== width || this.captureCanvas.height !== height) {
      this.captureCanvas.width = width;
      this.captureCanvas.height = height;
    }

    const context = this.captureCanvas.getContext('2d');
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, width, height);
    const dataUrl = this.captureCanvas.toDataURL('image/jpeg', CAPTURE_QUALITY);
    const comma = dataUrl.indexOf(',');

    return comma === -1 ? null : { base64: dataUrl.slice(comma + 1), width, height };
  }

  /**
   * The live video element, once it is producing pixels.
   *
   * Exposed for the barcode detector, which decodes straight from the element
   * rather than from a copied frame — `BarcodeDetector` accepts a video source and
   * going through a canvas would cost a full readback per tick for no benefit.
   */
  detectionSource(): HTMLVideoElement | null {
    return this.readyVideo();
  }

  /** The attached video, but only once it's actually producing pixels. */
  private readyVideo(): HTMLVideoElement | null {
    const video = this.video;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }
    return video;
  }

  private fail(status: CameraStatus, message: string): void {
    console.error(`[Camera] ${status}: ${message}`);
    this._status.set(status);
    this._message.set(message);
  }
}

/** The last camera this till used, if the browser will tell us. */
function readPreferredCamera(): string | null {
  try {
    return localStorage.getItem(CAMERA_PREFERENCE_KEY);
  } catch {
    // Private mode or blocked storage: fall back to the browser's choice.
    return null;
  }
}

function writePreferredCamera(deviceId: string): void {
  try {
    localStorage.setItem(CAMERA_PREFERENCE_KEY, deviceId);
  } catch {
    // Not remembering the choice is survivable; picking again is not the end.
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Turn a getUserMedia rejection into a status and something worth reading.
 *
 * The distinction is the point: "blocked" tells the cashier to change a browser
 * setting, "in use" tells them to close the other app, and "no camera" tells
 * them to stop trying. One generic "camera failed" would leave all three stuck.
 */
function describeCameraError(error: unknown): [CameraStatus, string] {
  const name = error instanceof Error ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return [
        'denied',
        'Camera access is blocked. Allow it in your browser settings, then reopen.',
      ];
    case 'NotFoundError':
    case 'OverconstrainedError':
      return ['unavailable', 'No camera found on this device.'];
    case 'NotReadableError':
    case 'AbortError':
      return ['error', 'Another app is using the camera. Close it and try again.'];
    default:
      return ['error', "The camera didn't start. Try again, or use the search panel."];
  }
}
