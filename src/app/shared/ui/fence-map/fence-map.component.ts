import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
  input,
  output,
  signal,
  NgZone,
  inject,
} from '@angular/core';
import type { LatLng } from '@core/application/services/kiosk-settings.service';
import type * as L from 'leaflet';

/**
 * FenceMapComponent
 *
 * An OpenStreetMap-powered polygon editor for configuring a store's geofence.
 * Uses Leaflet (loaded lazily) so the map bundle is not included in the
 * main chunk.
 *
 * UX flow:
 *  1. Map starts centred on the saved polygon, or the device's location, or
 *     a reasonable world default.
 *  2. The operator clicks "Draw fence" to enter drawing mode — each subsequent
 *     click places a vertex shown as a draggable circle marker.
 *  3. Double-clicking (or clicking the first vertex again) closes the ring
 *     and emits `polygonChange`.
 *  4. After drawing, individual markers can be dragged to adjust the shape;
 *     "Clear fence" removes all vertices.
 *  5. "Use my location" re-centres without altering the polygon.
 */
@Component({
  selector: 'app-fence-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fence-map-wrap" data-testid="fence-map">
      <!-- Toolbar -->
      <div class="fence-toolbar">
        <span class="fence-title">📐 Store geofence</span>
        <div class="fence-actions">
          @if (!drawing()) {
            <button
              type="button"
              class="fence-btn fence-btn--primary"
              (click)="startDrawing()"
              data-testid="btn-draw-fence"
            >
              {{ polygon().length === 0 ? '✏️ Draw fence' : '✏️ Redraw' }}
            </button>
          } @else {
            <span class="fence-hint"> Click to add vertices · double-click to close </span>
            <button
              type="button"
              class="fence-btn fence-btn--ghost"
              (click)="cancelDrawing()"
              data-testid="btn-cancel-draw"
            >
              Cancel
            </button>
          }
          @if (polygon().length > 0 && !drawing()) {
            <button
              type="button"
              class="fence-btn fence-btn--danger"
              (click)="clearFence()"
              data-testid="btn-clear-fence"
            >
              🗑️ Clear
            </button>
          }
          <button
            type="button"
            class="fence-btn fence-btn--ghost"
            (click)="locateMe()"
            [disabled]="locating()"
            data-testid="btn-locate-me"
            title="Centre map on my location"
          >
            {{ locating() ? '⏳' : '📍 My location' }}
          </button>
        </div>
      </div>

      <!-- Status strip -->
      @if (polygon().length > 0 && !drawing()) {
        <div class="fence-status" data-testid="fence-status">
          @if (polygon().length >= 3) {
            ✅ Fence configured — {{ polygon().length }} vertices
          } @else {
            ⚠️ Need at least 3 vertices ({{ polygon().length }} so far)
          }
        </div>
      }
      @if (locateError()) {
        <div class="fence-status fence-status--warn" data-testid="fence-locate-error">
          ⚠️ {{ locateError() }}
        </div>
      }

      <!-- Map container -->
      <div #mapEl class="fence-map-canvas" data-testid="fence-map-canvas"></div>
    </div>
  `,
  styles: [
    `
      .fence-map-wrap {
        border: 1px solid #d1d5db;
        border-radius: 10px;
        overflow: hidden;
        background: #f9fafb;
        margin-top: 0.75rem;
      }
      .fence-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0.5rem;
        padding: 0.625rem 0.875rem;
        background: white;
        border-bottom: 1px solid #e5e7eb;
      }
      .fence-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: #374151;
      }
      .fence-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .fence-hint {
        font-size: 0.75rem;
        color: #6b7280;
        font-style: italic;
      }
      .fence-btn {
        padding: 0.3rem 0.75rem;
        border-radius: 6px;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .fence-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .fence-btn--primary {
        background: #2563eb;
        color: white;
      }
      .fence-btn--primary:hover:not(:disabled) {
        background: #1d4ed8;
      }
      .fence-btn--ghost {
        background: white;
        border-color: #d1d5db;
        color: #374151;
      }
      .fence-btn--ghost:hover:not(:disabled) {
        background: #f3f4f6;
      }
      .fence-btn--danger {
        background: white;
        border-color: #fca5a5;
        color: #b91c1c;
      }
      .fence-btn--danger:hover:not(:disabled) {
        background: #fef2f2;
      }
      .fence-status {
        padding: 0.375rem 0.875rem;
        font-size: 0.8125rem;
        background: #f0fdf4;
        color: #166534;
        border-bottom: 1px solid #bbf7d0;
      }
      .fence-status--warn {
        background: #fffbeb;
        color: #92400e;
        border-bottom-color: #fde68a;
      }
      .fence-map-canvas {
        height: 340px;
        width: 100%;
      }
      /* Leaflet overrides (scoped) */
      :host ::ng-deep .fence-vertex-marker {
        width: 14px !important;
        height: 14px !important;
        margin-left: -7px !important;
        margin-top: -7px !important;
        border-radius: 50%;
        background: #2563eb;
        border: 2px solid white;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
        cursor: grab;
      }
      :host ::ng-deep .fence-vertex-marker.leaflet-marker-draggable {
        cursor: grab;
      }
      :host ::ng-deep .fence-close-marker {
        background: #16a34a;
        border-color: #bbf7d0;
      }
    `,
  ],
})
export class FenceMapComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapEl', { static: true }) mapEl!: ElementRef<HTMLDivElement>;

  /** Current saved polygon (passed in from parent). */
  readonly initialPolygon = input<LatLng[]>([]);

  /** Emitted whenever the polygon changes (draw complete OR marker dragged). */
  readonly polygonChange = output<LatLng[]>();

  readonly drawing = signal(false);
  readonly locating = signal(false);
  readonly locateError = signal('');
  readonly polygon = signal<LatLng[]>([]);

  private zone = inject(NgZone);

  private L: typeof L | null = null;
  private map: L.Map | null = null;
  private polyline: L.Polyline | null = null; // preview line while drawing
  private filledPoly: L.Polygon | null = null; // filled polygon layer
  private vertexMarkers: L.Marker[] = [];
  private drawingVertices: LatLng[] = [];
  private mapClickHandler: ((e: L.LeafletMouseEvent) => void) | null = null;

  ngOnInit(): void {
    this.polygon.set([...(this.initialPolygon() ?? [])]);
  }

  async ngAfterViewInit(): Promise<void> {
    await this.loadLeaflet();
    this.initMap();
    this.renderSavedPolygon();
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  // ── Public actions ──────────────────────────────────────────────────────────

  startDrawing(): void {
    this.clearDrawingState();
    this.drawing.set(true);
    this.drawingVertices = [];

    // Dim existing polygon while drawing
    this.removeLayers();

    this.mapClickHandler = (e: L.LeafletMouseEvent) => {
      this.zone.run(() => {
        this.onMapClick(e.latlng);
      });
    };
    this.map!.on('click', this.mapClickHandler);
    this.map!.on('dblclick', this.onMapDblClick.bind(this));
    // Prevent default zoom-on-dblclick while drawing
    this.map!.doubleClickZoom.disable();
  }

  cancelDrawing(): void {
    this.stopDrawing();
    // Restore old polygon
    this.renderSavedPolygon();
  }

  clearFence(): void {
    this.removeLayers();
    this.clearDrawingState();
    this.polygon.set([]);
    this.polygonChange.emit([]);
  }

  async locateMe(): Promise<void> {
    this.locating.set(true);
    this.locateError.set('');
    try {
      const pos = await getCurrentPosition();
      this.map!.setView([pos.lat, pos.lng], 17);
    } catch (err) {
      this.locateError.set(err instanceof Error ? err.message : 'Location unavailable');
    } finally {
      this.locating.set(false);
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async loadLeaflet(): Promise<void> {
    if (this.L) return;
    // Dynamic import keeps Leaflet out of the main bundle
    const leafletModule = await import('leaflet');
    this.L = leafletModule.default ?? leafletModule;

    // Fix the missing marker icon path that Leaflet has in bundler environments
    delete (this.L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
    this.L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    // Inject Leaflet CSS once
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
  }

  private initMap(): void {
    const L = this.L;
    const saved = this.polygon();

    // Centre: saved polygon centroid → device location (best-effort) → world
    let center: [number, number] = [20, 0];
    let zoom = 2;

    if (saved.length >= 3) {
      const centroid = polygonCentroid(saved);
      center = [centroid.lat, centroid.lng];
      zoom = 17;
    }

    this.map = L!.map(this.mapEl.nativeElement, {
      center,
      zoom,
      zoomControl: true,
    });

    L!
      .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
      .addTo(this.map);
  }

  private renderSavedPolygon(): void {
    const saved = this.polygon();
    if (saved.length < 3) return;

    const L = this.L;
    const latlngs = saved.map((v) => [v.lat, v.lng] as [number, number]);

    this.filledPoly = L!
      .polygon(latlngs, {
        color: '#2563eb',
        weight: 2,
        fillColor: '#3b82f6',
        fillOpacity: 0.18,
      })
      .addTo(this.map!);

    // Draggable vertex markers
    saved.forEach((v, idx) => {
      this.addVertexMarker(v, idx);
    });

    this.map!.fitBounds(this.filledPoly.getBounds(), { padding: [30, 30] });
  }

  private addVertexMarker(v: LatLng, idx: number): void {
    const L = this.L;
    const icon = L!.divIcon({
      className: 'fence-vertex-marker',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    const marker = L!.marker([v.lat, v.lng], { icon, draggable: true }).addTo(this.map!);

    marker.on('dragend', () => {
      this.zone.run(() => {
        const newPos = marker.getLatLng();
        const updated = [...this.polygon()];
        updated[idx] = { lat: newPos.lat, lng: newPos.lng };
        this.polygon.set(updated);
        this.polygonChange.emit(updated);
        this.refreshFilledPoly(updated);
      });
    });

    this.vertexMarkers.push(marker);
  }

  private refreshFilledPoly(verts: LatLng[]): void {
    if (this.filledPoly) {
      this.filledPoly.setLatLngs(verts.map((v) => [v.lat, v.lng] as [number, number]));
    }
  }

  private onMapClick(latlng: { lat: number; lng: number }): void {
    if (!this.drawing()) return;
    const v: LatLng = { lat: latlng.lat, lng: latlng.lng };

    // Close the polygon if clicking near the first vertex
    if (this.drawingVertices.length >= 3 && isNearFirstVertex(v, this.drawingVertices[0])) {
      this.finishPolygon();
      return;
    }

    this.drawingVertices.push(v);
    this.updatePreviewLine();

    // Add a temporary dot marker
    const L = this.L;
    const isFirst = this.drawingVertices.length === 1;
    const icon = L!.divIcon({
      className: `fence-vertex-marker${isFirst ? ' fence-close-marker' : ''}`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const m = L!.marker([v.lat, v.lng], { icon }).addTo(this.map!);
    this.vertexMarkers.push(m);
  }

  private onMapDblClick(): void {
    if (!this.drawing() || this.drawingVertices.length < 3) return;
    this.finishPolygon();
  }

  private updatePreviewLine(): void {
    const L = this.L;
    const pts = this.drawingVertices.map((v) => [v.lat, v.lng] as [number, number]);
    if (this.polyline) {
      this.polyline.setLatLngs(pts);
    } else {
      this.polyline = L!
        .polyline(pts, { color: '#2563eb', weight: 2, dashArray: '6 4' })
        .addTo(this.map!);
    }
  }

  private finishPolygon(): void {
    const verts = [...this.drawingVertices];
    this.stopDrawing();
    this.removeLayers();
    this.polygon.set(verts);
    this.polygonChange.emit(verts);

    // Re-render as a filled polygon with draggable markers
    verts.forEach((v, idx) => this.addVertexMarker(v, idx));
    const L = this.L;
    this.filledPoly = L!
      .polygon(
        verts.map((v) => [v.lat, v.lng] as [number, number]),
        { color: '#2563eb', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.18 }
      )
      .addTo(this.map!);

    this.map!.fitBounds(this.filledPoly.getBounds(), { padding: [30, 30] });
  }

  private stopDrawing(): void {
    if (this.mapClickHandler) {
      this.map!.off('click', this.mapClickHandler);
      this.mapClickHandler = null;
    }
    this.map!.off('dblclick');
    this.map!.doubleClickZoom.enable();
    this.drawing.set(false);

    if (this.polyline) {
      this.map!.removeLayer(this.polyline);
      this.polyline = null;
    }
    this.drawingVertices = [];
  }

  private clearDrawingState(): void {
    this.removeLayers();
    this.drawingVertices = [];
  }

  private removeLayers(): void {
    if (this.filledPoly) {
      this.map?.removeLayer(this.filledPoly);
      this.filledPoly = null;
    }
    if (this.polyline) {
      this.map?.removeLayer(this.polyline);
      this.polyline = null;
    }
    this.vertexMarkers.forEach((m) => this.map?.removeLayer(m));
    this.vertexMarkers = [];
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function polygonCentroid(pts: LatLng[]): LatLng {
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  return { lat, lng };
}

function isNearFirstVertex(v: LatLng, first: LatLng, thresholdDeg = 0.00015): boolean {
  return Math.abs(v.lat - first.lat) < thresholdDeg && Math.abs(v.lng - first.lng) < thresholdDeg;
}

function getCurrentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.message)),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}
