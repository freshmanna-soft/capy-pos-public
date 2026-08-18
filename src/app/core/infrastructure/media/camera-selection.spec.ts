import {
  CameraOption,
  cameraLabel,
  fallbackCameraId,
  nextCameraId,
  resolveCameraRequest,
  toCameraOptions,
  toVideoConstraints,
} from './camera-selection';

/** A `MediaDeviceInfo`-shaped stub; only these four fields are ever read. */
function device(kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'g', toJSON: () => ({}) } as MediaDeviceInfo;
}

const OVERHEAD: CameraOption = { deviceId: 'cam-a', label: 'Overhead' };
const SHELF: CameraOption = { deviceId: 'cam-b', label: 'Shelf' };

describe('cameraLabel', () => {
  it('uses the browser label when there is one', () => {
    expect(cameraLabel('Logitech StreamCam', 0)).toBe('Logitech StreamCam');
  });

  it('falls back to a position when the label is empty', () => {
    // Browsers withhold labels until camera permission is granted, so this is
    // the label for the entire pre-permission case, not a rare edge.
    expect(cameraLabel('', 0)).toBe('Camera 1');
    expect(cameraLabel('   ', 2)).toBe('Camera 3');
  });

  it('strips the USB id Chromium appends', () => {
    // "(05ac:8514)" pushes the part that distinguishes two cameras out of a
    // narrow control.
    expect(cameraLabel('FaceTime HD Camera (05ac:8514)', 0)).toBe('FaceTime HD Camera');
  });

  it('keeps parentheses that are part of the name', () => {
    expect(cameraLabel('Webcam (front)', 0)).toBe('Webcam (front)');
  });
});

describe('toCameraOptions', () => {
  it('keeps only video inputs', () => {
    const options = toCameraOptions([
      device('videoinput', 'cam-a', 'Overhead'),
      device('audioinput', 'mic-a', 'Microphone'),
      device('audiooutput', 'spk-a', 'Speakers'),
    ]);
    expect(options).toEqual([{ deviceId: 'cam-a', label: 'Overhead' }]);
  });

  it('drops entries with no device id', () => {
    // Safari reports a placeholder with an empty id before permission; an option
    // that cannot be selected is worse than no option.
    const options = toCameraOptions([
      device('videoinput', '', 'Ghost'),
      device('videoinput', 'cam-b', 'Shelf'),
    ]);
    expect(options).toEqual([{ deviceId: 'cam-b', label: 'Shelf' }]);
  });

  it('numbers unlabelled cameras by their position in the kept list', () => {
    const options = toCameraOptions([
      device('videoinput', 'cam-a'),
      device('audioinput', 'mic-a'),
      device('videoinput', 'cam-b'),
    ]);
    expect(options.map((option) => option.label)).toEqual(['Camera 1', 'Camera 2']);
  });

  it('returns nothing for an empty device list', () => {
    expect(toCameraOptions([])).toEqual([]);
  });
});

describe('resolveCameraRequest', () => {
  it('lets the browser choose when nothing is remembered', () => {
    expect(resolveCameraRequest([OVERHEAD, SHELF], null)).toEqual({ kind: 'default' });
    expect(resolveCameraRequest([OVERHEAD], '')).toEqual({ kind: 'default' });
  });

  it('reopens the remembered camera when it is still there', () => {
    expect(resolveCameraRequest([OVERHEAD, SHELF], 'cam-b')).toEqual({
      kind: 'device',
      deviceId: 'cam-b',
    });
  });

  it('falls back to the browser when the remembered camera has gone', () => {
    // The USB camera went home in someone's bag. Guessing at another device id
    // fails the same way as a stale one and is less honest about it.
    expect(resolveCameraRequest([OVERHEAD], 'cam-b')).toEqual({ kind: 'default' });
  });

  it('trusts the memory before permission, when there is no list to check', () => {
    // An empty list is the normal pre-permission state — the first getUserMedia
    // call is what earns the right to enumerate — and the remembered id came
    // from a session that did have permission.
    expect(resolveCameraRequest([], 'cam-b')).toEqual({ kind: 'device', deviceId: 'cam-b' });
  });
});

describe('nextCameraId', () => {
  it('advances through the list', () => {
    expect(nextCameraId([OVERHEAD, SHELF], 'cam-a')).toBe('cam-b');
  });

  it('wraps around', () => {
    expect(nextCameraId([OVERHEAD, SHELF], 'cam-b')).toBe('cam-a');
  });

  it('has nowhere to go with a single camera', () => {
    expect(nextCameraId([OVERHEAD], 'cam-a')).toBeNull();
    expect(nextCameraId([], null)).toBeNull();
  });

  it('starts from the top when the current camera is unknown', () => {
    expect(nextCameraId([OVERHEAD, SHELF], 'cam-gone')).toBe('cam-a');
    expect(nextCameraId([OVERHEAD, SHELF], null)).toBe('cam-a');
  });
});

describe('fallbackCameraId', () => {
  it('prefers a camera other than the one that died', () => {
    expect(fallbackCameraId([OVERHEAD, SHELF], 'cam-a')).toBe('cam-b');
  });

  it('reports nothing when the dead camera was the only one', () => {
    expect(fallbackCameraId([OVERHEAD], 'cam-a')).toBeNull();
    expect(fallbackCameraId([], 'cam-a')).toBeNull();
  });
});

describe('toVideoConstraints', () => {
  it('pins an exact device so a vanished camera fails loudly', () => {
    // `ideal` would silently open whichever camera the browser felt like, and a
    // till pointed at the ceiling looks like a broken clerk rather than a
    // misconfigured one.
    expect(toVideoConstraints({ kind: 'device', deviceId: 'cam-a' })).toMatchObject({
      deviceId: { exact: 'cam-a' },
    });
  });

  it('asks for a rear-facing camera by default', () => {
    expect(toVideoConstraints({ kind: 'default' })).toMatchObject({ facingMode: 'environment' });
  });

  it('requests the same resolution either way', () => {
    for (const request of [
      { kind: 'device' as const, deviceId: 'x' },
      { kind: 'default' as const },
    ]) {
      expect(toVideoConstraints(request)).toMatchObject({
        width: { ideal: 1280 },
        height: { ideal: 720 },
      });
    }
  });
});
