import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ImagePickerComponent } from './image-picker.component';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { environment } from '../../../../environments/environment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal File-like object accepted by the component. */
function makeFile(name: string, type: string, sizeBytes: number): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

/**
 * Build a synthetic `Event` whose `target.files[0]` is the given file.
 * jsdom does not implement DataTransfer, so we assign `files` directly on a
 * plain object that satisfies the narrow interface the component reads.
 */
function makeChangeEvent(file: File): Event {
  const input = { files: [file] } as unknown as HTMLInputElement;
  return { target: input } as unknown as Event;
}

function testId(el: HTMLElement, id: string): HTMLElement | null {
  return el.querySelector(`[data-testid="${id}"]`);
}

// ---------------------------------------------------------------------------
// Host component — supplies required inputs from outside, captures outputs.
// ---------------------------------------------------------------------------

@Component({
  standalone: true,
  imports: [ImagePickerComponent],
  template: `
    <app-image-picker
      [productId]="productId()"
      [imageUrl]="imageUrl()"
      (imageUrlChange)="emittedUrls.push($event)"
    />
  `,
})
class HostComponent {
  readonly productId = signal('prod-001');
  readonly imageUrl = signal('');
  emittedUrls: string[] = [];
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ImagePickerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let httpMock: HttpTestingController;

  // Camera service doubles — set per test as needed.
  let cameraStart: ReturnType<typeof vi.fn>;
  let cameraStop: ReturnType<typeof vi.fn>;
  let cameraAttach: ReturnType<typeof vi.fn>;
  let captureFrame: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cameraStart = vi.fn().mockResolvedValue(true);
    cameraStop = vi.fn();
    cameraAttach = vi.fn();
    captureFrame = vi.fn().mockReturnValue(null);

    // jsdom does not implement HTMLMediaElement.play; prevent unhandled rejection.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      imports: [HostComponent, HttpClientTestingModule],
    });

    // The component provides its own CameraService instance (providers: [CameraService]).
    // Override it at component level — same technique as BarcodeScanFieldComponent tests.
    TestBed.overrideComponent(ImagePickerComponent, {
      set: {
        providers: [
          {
            provide: CameraService,
            useValue: {
              start: cameraStart,
              stop: cameraStop,
              attach: cameraAttach,
              captureFrame,
              isLive: signal(false),
              status: signal('idle'),
              message: signal(''),
            },
          },
        ],
      },
    });

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1 — valid JPEG file → POST to correct URL → emits returned imageUrl
  // -------------------------------------------------------------------------

  it('posts a valid JPEG file to the correct URL and emits the returned imageUrl', () => {
    const file = makeFile('photo.jpg', 'image/jpeg', 512 * 1024); // 512 KB — within limit
    const picker = fixture.debugElement.children[0].componentInstance as ImagePickerComponent;

    picker.onFileSelected(makeChangeEvent(file));
    fixture.detectChanges();

    const expectedUrl = `${environment.apiUrl}${environment.imageApiPath}/prod-001/image`;
    const req = httpMock.expectOne(expectedUrl);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);

    const returnedUrl = 'https://cdn.example.com/products/prod-001.jpg';
    req.flush({ imageUrl: returnedUrl });
    fixture.detectChanges();

    expect(host.emittedUrls).toContain(returnedUrl);
  });

  // -------------------------------------------------------------------------
  // Test 2 — file > 2 MB → sets uploadError, makes NO HTTP call
  // -------------------------------------------------------------------------

  it('rejects a file larger than 2 MB and sets uploadError without making an HTTP call', () => {
    const tooBig = makeFile('huge.jpg', 'image/jpeg', 3 * 1024 * 1024); // 3 MB
    const pickerInst = fixture.debugElement.children[0].componentInstance as ImagePickerComponent;

    pickerInst.onFileSelected(makeChangeEvent(tooBig));
    fixture.detectChanges();

    // No HTTP request should have been made.
    httpMock.expectNone((r) => r.url.includes('/image'));

    const pickerEl = fixture.nativeElement.querySelector('app-image-picker') as HTMLElement;
    expect(testId(pickerEl, 'upload-error')).not.toBeNull();
    expect(testId(pickerEl, 'upload-error')?.textContent).toContain('2 MB');
  });

  // -------------------------------------------------------------------------
  // Test 3 — wrong MIME type → sets uploadError, makes NO HTTP call
  // -------------------------------------------------------------------------

  it('rejects a file with an unsupported MIME type and sets uploadError without an HTTP call', () => {
    const gif = makeFile('anim.gif', 'image/gif', 200 * 1024);
    const pickerInst = fixture.debugElement.children[0].componentInstance as ImagePickerComponent;

    pickerInst.onFileSelected(makeChangeEvent(gif));
    fixture.detectChanges();

    httpMock.expectNone((r) => r.url.includes('/image'));

    const pickerEl = fixture.nativeElement.querySelector('app-image-picker') as HTMLElement;
    expect(testId(pickerEl, 'upload-error')).not.toBeNull();
    expect(testId(pickerEl, 'upload-error')?.textContent).toContain('JPEG');
  });

  // -------------------------------------------------------------------------
  // Test 4 — onUrlCommit → emits URL directly, no HTTP call
  // -------------------------------------------------------------------------

  it('emits the URL directly on onUrlCommit without making an HTTP call', () => {
    const picker = fixture.debugElement.children[0].componentInstance as ImagePickerComponent;

    picker.onUrlCommit('https://example.com/img.jpg');

    httpMock.expectNone(() => true);
    expect(host.emittedUrls).toContain('https://example.com/img.jpg');
  });

  // -------------------------------------------------------------------------
  // Test 5 — captureFromCamera → captureFrame called → POST → emits URL
  // -------------------------------------------------------------------------

  it('calls captureFrame on the camera, posts the blob, and emits the returned imageUrl', async () => {
    // Provide a base64 payload that fetch() can convert to a Blob.
    // A 1×1 white pixel JPEG in base64 is short and real.
    const minimalBase64 =
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC' +
      'AABAAEDASIA' +
      'AhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEB' +
      'AQAAAAAAAAAAAAAAAAAAAAB/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmwAB/9k=';

    captureFrame.mockReturnValue({ base64: minimalBase64, width: 1, height: 1 });

    const picker = fixture.debugElement.children[0].componentInstance as ImagePickerComponent;

    // Kick off the async method; don't await — we want to intercept the HTTP call
    // synchronously after microtasks settle.
    const capturePromise = picker.captureFromCamera();
    // Let the async camera.start() + fetch() microtasks flush.
    await capturePromise;

    fixture.detectChanges();

    const expectedUrl = `${environment.apiUrl}${environment.imageApiPath}/prod-001/image`;
    const req = httpMock.expectOne(expectedUrl);
    expect(req.request.method).toBe('POST');

    const returnedUrl = 'https://cdn.example.com/products/prod-001-cam.jpg';
    req.flush({ imageUrl: returnedUrl });
    fixture.detectChanges();

    expect(host.emittedUrls).toContain(returnedUrl);
    expect(cameraStart).toHaveBeenCalled();
    expect(captureFrame).toHaveBeenCalled();
  });
});
