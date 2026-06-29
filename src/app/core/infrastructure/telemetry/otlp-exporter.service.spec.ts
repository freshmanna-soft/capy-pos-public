import { TestBed } from '@angular/core/testing';
import { trace } from '@opentelemetry/api';
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

  it('should handle flush gracefully', (done) => {
    service.flush().then(() => {
      expect(true).toBe(true);
      done();
    });
  });

  it('should handle shutdown gracefully', (done) => {
    service.shutdown().then(() => {
      expect(true).toBe(true);
      done();
    });
  });
});
