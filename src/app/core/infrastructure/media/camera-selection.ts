/** A video input the cashier can choose between. */
export interface CameraOption {
  deviceId: string;
  /** Always non-empty and always distinct within a list. */
  label: string;
}

/** What to hand `getUserMedia` as its video constraints. */
export type CameraRequest =
  /** A specific device the cashier chose, or used last. */
  | { kind: 'device'; deviceId: string }
  /** No usable preference: let the browser pick a rear-facing camera. */
  | { kind: 'default' };

/**
 * Camera selection, as pure functions.
 *
 * Split out of `CameraService` because the service is a thin shell over
 * `getUserMedia` and canvas pixel APIs that jsdom does not implement — it is
 * coverage-excluded and verified end-to-end. This file is where the actual
 * decisions live, so it can be tested properly: which device to open, what to do
 * when the remembered one has been unplugged, and how to name devices the browser
 * describes badly or not at all.
 */

/**
 * Trailing USB vendor:product id that Chromium appends to device labels, e.g.
 * "FaceTime HD Camera (05ac:8514)". Useless to a cashier and it pushes the
 * distinguishing part of the name out of a narrow control.
 */
const USB_ID_SUFFIX = /\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i;

/**
 * Name one video input.
 *
 * Labels are only populated after camera permission has been granted — before
 * that the browser returns empty strings for privacy — so a positional fallback
 * is not a nicety, it is the label for the entire pre-permission case.
 */
export function cameraLabel(label: string, index: number): string {
  const cleaned = label.replace(USB_ID_SUFFIX, '').trim();
  return cleaned.length > 0 ? cleaned : `Camera ${index + 1}`;
}

/**
 * Turn raw enumerated devices into the list the picker shows.
 *
 * Drops anything that isn't a camera and anything without a device id — Safari
 * reports a placeholder entry with an empty id before permission is granted, and
 * an option that cannot be selected is worse than no option.
 */
export function toCameraOptions(devices: readonly MediaDeviceInfo[]): CameraOption[] {
  return devices
    .filter((device) => device.kind === 'videoinput' && device.deviceId.length > 0)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: cameraLabel(device.label, index),
    }));
}

/**
 * Decide which camera to open.
 *
 * The remembered device wins when it is still present. When it isn't — the USB
 * camera went home in someone's bag, or this is a different till — fall back to
 * the browser's own choice rather than guessing at another device id, because a
 * stale id and a wrong id fail the same way and only one of them is honest.
 *
 * An empty device list is the normal pre-permission state, not an error: the
 * first `getUserMedia` call is what earns the right to enumerate.
 */
export function resolveCameraRequest(
  cameras: readonly CameraOption[],
  rememberedId: string | null
): CameraRequest {
  if (rememberedId === null || rememberedId.length === 0) {
    return { kind: 'default' };
  }
  // Before permission we have no list to check against, so trust the memory —
  // it came from a session that did have permission.
  if (cameras.length === 0) {
    return { kind: 'device', deviceId: rememberedId };
  }
  return cameras.some((camera) => camera.deviceId === rememberedId)
    ? { kind: 'device', deviceId: rememberedId }
    : { kind: 'default' };
}

/**
 * The camera after `currentId`, wrapping around.
 *
 * Backs the `C` shortcut. Returns null when there is nowhere to go, so the caller
 * doesn't restart the stream on the same device for nothing.
 */
export function nextCameraId(
  cameras: readonly CameraOption[],
  currentId: string | null
): string | null {
  if (cameras.length < 2) {
    return null;
  }
  const index = cameras.findIndex((camera) => camera.deviceId === currentId);
  // Unknown current device: start from the top rather than refusing to move.
  const next = cameras[(index + 1) % cameras.length];
  return next && next.deviceId !== currentId ? next.deviceId : null;
}

/**
 * A camera to fall back to when the active one disappears mid-shift.
 *
 * Prefers any camera that isn't the one that just died; returns null when that
 * was the only one, which the caller reports rather than silently retrying.
 */
export function fallbackCameraId(
  cameras: readonly CameraOption[],
  lostId: string | null
): string | null {
  const candidate = cameras.find((camera) => camera.deviceId !== lostId);
  return candidate?.deviceId ?? null;
}

/** Video constraints for a resolved request. */
export function toVideoConstraints(request: CameraRequest): MediaTrackConstraints {
  const shared: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
  return request.kind === 'device'
    ? // `exact`, so a vanished device fails loudly and we can fall back
      // deliberately instead of silently opening whichever camera the browser
      // felt like — a till pointed at the wrong angle looks like a broken clerk.
      { ...shared, deviceId: { exact: request.deviceId } }
    : { ...shared, facingMode: 'environment' };
}
