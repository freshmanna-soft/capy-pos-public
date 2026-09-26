import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { environment } from '../../../../environments/environment';

const MAX_BYTES = 2_097_152;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * ImagePickerComponent
 *
 * Provides three ways for an operator to supply a product image:
 *  1. Upload a file from disk (JPEG / PNG / WebP, max 2 MB).
 *  2. Capture a single frame from the device camera.
 *  3. Paste a URL directly — no upload, just emit.
 *
 * In each uploading path the binary is POSTed as multipart/form-data to
 * `POST /api/products/:productId/image`; the returned `{ imageUrl }` is
 * emitted to the parent. The URL path emits immediately without a network call.
 *
 * The component owns its CameraService instance (component-level provider) so it
 * cannot disturb any camera session already running in the operator view.
 */
@Component({
  selector: 'app-image-picker',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Own camera instance — keeps this picker's stream independent of any open
  // clerk-view or barcode scanner session.
  providers: [CameraService],
  template: `
    <div class="flex flex-col gap-3" data-testid="image-picker">
      <!-- Current image thumbnail -->
      @if (imageUrl()) {
        <div class="relative w-full overflow-hidden rounded-lg bg-gray-900" style="height:140px">
          <img
            [src]="imageUrl()"
            alt="Product image"
            class="h-full w-full object-cover"
            data-testid="image-preview"
          />
        </div>
      }

      <!-- Spinner overlay while uploading -->
      @if (uploading()) {
        <div
          class="flex items-center justify-center gap-2 rounded-lg bg-gray-800 px-4 py-3 text-sm text-gray-200"
          data-testid="upload-spinner"
          aria-live="polite"
        >
          <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            ></path>
          </svg>
          Uploading…
        </div>
      }

      <!-- Action buttons (hidden while uploading) -->
      @if (!uploading()) {
        <div class="flex flex-wrap gap-2">
          <!-- Upload from disk -->
          <button
            type="button"
            class="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600 active:scale-95 disabled:opacity-50"
            data-testid="btn-upload-file"
            (click)="fileInput.click()"
            [disabled]="uploading()"
          >
            📁 Upload
          </button>

          <!-- Camera capture — only offered when getUserMedia is available -->
          @if (cameraSupported()) {
            <button
              type="button"
              class="flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors active:scale-95 disabled:opacity-50"
              [class]="
                cameraActive()
                  ? 'bg-red-700 text-white hover:bg-red-600'
                  : 'bg-gray-700 text-white hover:bg-gray-600'
              "
              data-testid="btn-capture-camera"
              (click)="captureFromCamera()"
              [disabled]="uploading()"
            >
              {{ cameraActive() ? '⏹ Stop' : '📷 Camera' }}
            </button>
          }

          <!-- URL input toggle -->
          <button
            type="button"
            class="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-600 active:scale-95"
            data-testid="btn-toggle-url"
            (click)="showUrlInput.set(!showUrlInput())"
          >
            🔗 URL
          </button>
        </div>
      }

      <!-- Hidden file input -->
      <input
        #fileInput
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="hidden"
        data-testid="file-input"
        (change)="onFileSelected($event)"
      />

      <!-- URL input row -->
      @if (showUrlInput()) {
        <div class="flex gap-2" data-testid="url-input-row">
          <input
            #urlInput
            type="url"
            placeholder="https://example.com/image.jpg"
            class="flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            data-testid="input-url"
            (keydown.enter)="
              onUrlCommit(urlInput.value); urlInput.value = ''; showUrlInput.set(false)
            "
          />
          <button
            type="button"
            class="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 active:scale-95"
            data-testid="btn-confirm-url"
            (click)="onUrlCommit(urlInput.value); urlInput.value = ''; showUrlInput.set(false)"
          >
            Confirm
          </button>
        </div>
      }

      <!-- Camera preview (shown while cameraActive()) -->
      @if (cameraActive()) {
        <div
          class="relative overflow-hidden rounded-lg bg-gray-900"
          style="height:200px"
          data-testid="camera-preview-container"
        >
          <video
            #cameraPreview
            class="h-full w-full object-cover"
            muted
            playsinline
            autoplay
            aria-hidden="true"
            data-testid="camera-preview-video"
          ></video>
        </div>
      }

      <!-- Inline error message -->
      @if (uploadError()) {
        <p
          class="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-300"
          role="alert"
          data-testid="upload-error"
        >
          {{ uploadError() }}
        </p>
      }
    </div>
  `,
})
export class ImagePickerComponent {
  private readonly camera = inject(CameraService);
  private readonly http = inject(HttpClient);

  // ----- Inputs / Outputs -----

  readonly imageUrl = input<string>('');
  readonly productId = input.required<string>();
  readonly imageUrlChange = output<string>();

  // ----- State signals -----

  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly cameraActive = signal(false);
  readonly showUrlInput = signal(false);

  /**
   * Whether the device can supply a getUserMedia stream at all.
   * Checked once at construction time; a missing API never appears mid-session.
   */
  readonly cameraSupported = computed(() => !!navigator.mediaDevices?.getUserMedia);

  // ----- ViewChild — camera preview -----

  @ViewChild('cameraPreview')
  private set cameraPreviewRef(ref: ElementRef<HTMLVideoElement> | undefined) {
    // The video element only exists while cameraActive() is true.
    // Attach and play as soon as it appears in the DOM.
    const el = ref?.nativeElement;
    if (!el) {
      return;
    }
    this.camera.attach(el);
    void el.play().catch(() => undefined);
  }

  // ----- Lifecycle -----

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopCamera());
  }

  // ----- Public source methods -----

  /**
   * File-input change handler.
   * Validates MIME type and size client-side before POSTing.
   */
  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      this.uploadError.set('Only JPEG, PNG, or WebP images are accepted.');
      return;
    }

    if (file.size > MAX_BYTES) {
      this.uploadError.set('Image must be 2 MB or smaller.');
      return;
    }

    this.uploadBlob(file, file.type);
  }

  /**
   * Capture a single JPEG frame from the camera, then POST it.
   * If the camera is already active this method stops it instead.
   */
  async captureFromCamera(): Promise<void> {
    if (this.cameraActive()) {
      this.stopCamera();
      return;
    }

    this.uploadError.set(null);
    this.cameraActive.set(true);
    await this.camera.start();

    const frame = this.camera.captureFrame();
    if (!frame) {
      this.uploadError.set('Camera capture failed.');
      this.stopCamera();
      return;
    }

    const blob = await fetch('data:image/jpeg;base64,' + frame.base64).then((r) => r.blob());
    this.uploadBlob(blob, 'image/jpeg');
    this.stopCamera();
  }

  /**
   * URL commit — emits the URL directly without any upload.
   */
  onUrlCommit(url: string): void {
    const trimmed = url.trim();
    if (!trimmed) {
      return;
    }
    this.imageUrlChange.emit(trimmed);
  }

  // ----- Private helpers -----

  private uploadBlob(blob: Blob, _mimeType: string): void {
    this.uploading.set(true);
    this.uploadError.set(null);

    const formData = new FormData();
    formData.append('image', blob);

    const url = `${environment.apiUrl}${environment.imageApiPath}/${this.productId()}/image`;

    this.http.post<{ imageUrl: string }>(url, formData).subscribe({
      next: (result) => {
        this.imageUrlChange.emit(result.imageUrl);
        this.uploading.set(false);
      },
      error: () => {
        this.uploadError.set('Upload failed. Please try again.');
        this.uploading.set(false);
      },
    });
  }

  private stopCamera(): void {
    this.camera.stop();
    this.cameraActive.set(false);
  }
}
