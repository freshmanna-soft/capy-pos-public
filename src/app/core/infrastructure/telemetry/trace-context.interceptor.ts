import { Injectable, inject } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { trace } from '@opentelemetry/api';
import { OtlpExporterService } from './otlp-exporter.service';

/**
 * HTTP Interceptor for OpenTelemetry trace context propagation
 * Adds trace ID headers to all outgoing API requests
 */
@Injectable()
export class TraceContextInterceptor implements HttpInterceptor {
  private tracer = trace.getTracer('http-interceptor', '0.0.0');
  private otlpExporter = inject(OtlpExporterService);

  intercept(
    request: HttpRequest<unknown>,
    next: HttpHandler,
  ): Observable<HttpEvent<unknown>> {
    // Skip non-API requests (e.g., assets)
    if (this.shouldSkipTracing(request.url)) {
      return next.handle(request);
    }

    const span = this.tracer.startSpan(`HTTP ${request.method} ${request.url}`, {
      attributes: {
        'http.method': request.method,
        'http.url': request.url,
      },
    });

    const traceId = this.otlpExporter.getCurrentTraceId() || 'unknown';

    // Add trace headers to request
    const tracedRequest = request.clone({
      setHeaders: {
        'X-Trace-Id': traceId,
      },
    });

    span.end();

    return next.handle(tracedRequest);
  }

  private shouldSkipTracing(url: string): boolean {
    // Skip tracing for non-API requests
    return (
      url.includes('/assets/') ||
      url.includes('/styles.') ||
      url.endsWith('.wasm') ||
      url.endsWith('.js') ||
      url.endsWith('.css')
    );
  }
}
