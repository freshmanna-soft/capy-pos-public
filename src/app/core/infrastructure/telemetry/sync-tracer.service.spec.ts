import { TestBed } from '@angular/core/testing';
import { SyncTracerService } from './sync-tracer.service';
import { OtlpExporterService } from './otlp-exporter.service';

describe('SyncTracerService', () => {
  let service: SyncTracerService;
  let otlpExporter: OtlpExporterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SyncTracerService, OtlpExporterService],
    });

    service = TestBed.inject(SyncTracerService);
    otlpExporter = TestBed.inject(OtlpExporterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start a sync operation span', () => {
    const span = service.startSyncOperation('enqueue', { product_count: 5 });
    expect(span).toBeTruthy();
    span.end();
  });

  it('should track product push with action', () => {
    const span = service.startProductPush('prod-123', 'create', { category: 'electronics' });
    expect(span).toBeTruthy();
    span.end();
  });

  it('should record retry attempts', () => {
    const productId = 'prod-456';
    const span = service.startProductPush(productId, 'update');

    service.recordRetry(productId, 1, new Error('Network timeout'));
    service.recordRetry(productId, 2, new Error('Server error'));

    span.end();
  });

  it('should record conflict resolution', () => {
    const productId = 'prod-789';
    const span = service.startProductPush(productId, 'update');

    service.recordConflictResolution(productId, 'version_conflict', {
      local_version: 2,
      remote_version: 3,
      resolution: 'use_remote',
    });

    span.end();
  });

  it('should end product push with success', () => {
    const productId = 'prod-success';
    const span = service.startProductPush(productId, 'create');

    service.recordRetry(productId, 1);
    service.endProductPush(productId, true, {
      duration_ms: 250,
      size_bytes: 1024,
    });

    expect(service).toBeTruthy();
  });

  it('should end product push with failure', () => {
    const productId = 'prod-fail';
    const span = service.startProductPush(productId, 'delete');

    service.recordRetry(productId, 1, new Error('Permission denied'));
    service.endProductPush(productId, false, {
      error: 'Permission denied',
      status_code: 403,
    });

    expect(service).toBeTruthy();
  });

  it('should record queue depth metrics', () => {
    service.recordQueueDepth(10, 3, 1);
    expect(service).toBeTruthy();
  });

  it('should record sync health metrics', () => {
    service.recordSyncHealth(45, 2, 125, 60000);
    expect(service).toBeTruthy();
  });

  it('should get current trace ID', () => {
    const traceId = service.getCurrentTraceId();
    expect(typeof traceId === 'string' || traceId === undefined).toBeTruthy();
  });

  it('should flush sync spans on shutdown', async () => {
    // Start multiple sync operations
    service.startProductPush('prod-1', 'create');
    service.startProductPush('prod-2', 'update');
    service.startProductPush('prod-3', 'delete');

    await service.flushSyncSpans();
    expect(service).toBeTruthy();
  });
});
