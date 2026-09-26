import { Injectable } from '@angular/core';
import { trace } from '@opentelemetry/api';
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
    return environment.features.telemetry && environment.telemetry?.otlp?.enabled !== false;
  }

  private initialize(): void {
    try {
      const resource = Resource.default().merge(
        new Resource({
          [SEMRESATTRS_SERVICE_NAME]: 'capy-pos',
          [SEMRESATTRS_SERVICE_VERSION]: '0.0.0',
          [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment.name,
        })
      );

      this.tracerProvider = new WebTracerProvider({ resource });

      // OTLP/HTTP posts traces to <endpoint>/v1/traces. The Grafana Cloud
      // gateway base is ".../otlp", so append the signal path when absent.
      const base = environment.telemetry?.otlp?.endpoint || 'http://localhost:4317';
      const tracesUrl = base.endsWith('/v1/traces') ? base : `${base}/v1/traces`;

      const exporter = new OTLPTraceExporter({
        url: tracesUrl,
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

    // Grafana Cloud's OTLP gateway uses HTTP Basic auth (base64 of
    // "<instanceId>:<token>"), not Bearer. Fall back to Bearer for a plain-token
    // endpoint (e.g. a local collector) when no instanceId is configured.
    const instanceId = environment.telemetry?.otlp?.instanceId;
    const apiKey = environment.telemetry?.otlp?.apiKey;
    if (instanceId && apiKey) {
      const credentials = btoa(`${instanceId}:${apiKey}`);
      headers['Authorization'] = `Basic ${credentials}`;
    } else if (apiKey) {
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
