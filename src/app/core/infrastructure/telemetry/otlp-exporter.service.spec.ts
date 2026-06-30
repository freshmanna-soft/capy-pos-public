import { TestBed } from '@angular/core/testing';
import { OtlpExporterService } from './otlp-exporter.service';

describe('OtlpExporterService', () => {
  let service: OtlpExporterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OtlpExporterService],
    });
    service = TestBed.inject(OtlpExporterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get tracer for instrumentation name', () => {
    const tracer = service.getTracer('test-instrumentation', '1.0.0');
    expect(tracer).toBeTruthy();
  });

  it('should handle flush gracefully', async () => {
    await expect(service.flush()).resolves.toBeUndefined();
  });

  it('should handle shutdown gracefully', async () => {
    await expect(service.shutdown()).resolves.toBeUndefined();
  });
});
