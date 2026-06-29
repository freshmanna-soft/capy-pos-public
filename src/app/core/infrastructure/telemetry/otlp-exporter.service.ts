import { Injectable, inject } from '@angular/core';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { environment } from '../../../../environments/environment';

/**
 * OTLP Exporter Service
 * Initializes OpenTelemetry SDK and exports traces to Grafana Cloud
 */
@Injectable({
  providedIn: 'root',
})
export class OtlpExporterService {
  private tracerProvider: WebTracerProvider | null = null;

  constructor() {
    if (this.shouldInitialize()) {
      this.initialize();
    }
  }

  private shouldInitialize(): boolean {
    return (
      environment.features.telemetry &&
      environment.telemetry?.otlp?.enabled !== false
    );
  }

  private initialize(): void {
    try {
      const resource = Resource.default().merge(
        new Resource({
          [SEMRESATTRS_SERVICE_NAME]: 'capy-pos',
          [SEMRESATTRS_SERVICE_VERSION]: '0.0.0',
          [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment.name,
        }),
      );

      this.tracerProvider = new WebTracerProvider({ resource });

      const exporter = new OTLPTraceExporter({
        url: environment.telemetry?.otlp?.endpoint || 'http://localhost:4317',
        headers: this.buildHeaders(),
      });

      this.tracerProvider.addSpanProcessor(new BatchSpanProcessor(exporter));

      trace.setGlobalTracerProvider(this.tracerProvider);
    } catch {
      // OTLP exporter initialization failure is non-fatal
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/protobuf',
    };

    const apiKey = environment.telemetry?.otlp?.apiKey;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return headers;
  }

  /**
   * Get or create a tracer for the given module
   */
  getTracer(instrumentationName: string, version?: string) {
    return trace.getTracer(instrumentationName, version);
  }

  /**
   * Get the trace ID from the current context
   */
  getCurrentTraceId(): string | undefined {
    const span = trace.getActiveSpan();
    return span?.spanContext().traceId;
  }

  /**
   * Force flush pending spans to the backend
   */
  async flush(): Promise<void> {
    if (this.tracerProvider) {
      await this.tracerProvider.forceFlush();
    }
  }

  /**
   * Shutdown the tracer provider
   */
  async shutdown(): Promise<void> {
    if (this.tracerProvider) {
      await this.tracerProvider.shutdown();
    }
  }
}
