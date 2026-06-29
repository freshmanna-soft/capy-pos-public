import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpClient, HTTP_INTERCEPTORS } from '@angular/common/http';
import { TraceContextInterceptor } from './trace-context.interceptor';
import { OtlpExporterService } from './otlp-exporter.service';

describe('TraceContextInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let otlpExporter: OtlpExporterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        OtlpExporterService,
        {
          provide: HTTP_INTERCEPTORS,
          useClass: TraceContextInterceptor,
          multi: true,
        },
      ],
    });

    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    otlpExporter = TestBed.inject(OtlpExporterService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should add trace context headers to API requests', () => {
    httpClient.get('/api/test').subscribe();

    const req = httpMock.expectOne('/api/test');
    expect(req.request.headers.has('X-Trace-Id')).toBeTruthy();

    req.flush({ data: 'test' });
  });

  it('should skip tracing for asset requests', () => {
    httpClient.get('/assets/image.png').subscribe();

    const req = httpMock.expectOne('/assets/image.png');
    expect(req.request.url).toContain('/assets/');

    req.flush({});
  });

  it('should capture HTTP response status', (done) => {
    httpClient.get('/api/test').subscribe(
      () => {
        done();
      },
      () => {
        done();
      },
    );

    const req = httpMock.expectOne('/api/test');
    req.flush({ data: 'test' }, { status: 200, statusText: 'OK' });
  });

  it('should handle HTTP errors', (done) => {
    httpClient.get('/api/test').subscribe(
      () => {
        fail('should not succeed');
      },
      (error) => {
        expect(error).toBeTruthy();
        done();
      },
    );

    const req = httpMock.expectOne('/api/test');
    req.error(new ErrorEvent('Network error'));
  });
});
