/**
 * OpenTelemetry tracing for Capy-POS Lambdas (explicit/manual instrumentation).
 *
 * Why manual spans instead of auto-instrumentation:
 *   - Auto-instrumentation must be registered BEFORE the instrumented module
 *     (the AWS SDK) is required; the handlers require it first, so patching
 *     never takes effect.
 *   - The failure-injection delay lives in the handler, not the DynamoDB call,
 *     so only a handler-level span captures the latency spike.
 *
 * withSpan() wraps each handler's work in one SERVER span, reads the returned
 * HTTP status, and marks the span ERROR on 5xx / exceptions — giving clean RED
 * span-metrics (rate, errors, duration) per route in Grafana Cloud.
 *
 * The provider is created once and kept alive across warm invocations;
 * flushTelemetry() forceFlushes (NOT shutdown) so spans export every invocation.
 */

let provider = null;
let tracer = null;

function initTelemetry() {
  if (provider) return;

  try {
    const { trace } = require('@opentelemetry/api');
    const { NodeTracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    const {
      ATTR_SERVICE_NAME,
      ATTR_SERVICE_VERSION,
    } = require('@opentelemetry/semantic-conventions');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317';
    const instanceId = process.env.GRAFANA_OTLP_INSTANCE_ID || '';
    const token = process.env.GRAFANA_OTLP_TOKEN || '';

    // Grafana Cloud's OTLP gateway uses HTTP Basic auth (base64 of
    // "<instanceId>:<token>"), NOT Bearer. Attach only when both are present.
    const basicCreds =
      instanceId && token ? Buffer.from(`${instanceId}:${token}`).toString('base64') : '';
    const authHeader = basicCreds ? { Authorization: `Basic ${basicCreds}` } : {};

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'capy-pos-api',
      [ATTR_SERVICE_VERSION]: '0.0.0',
      'deployment.environment': process.env.ENVIRONMENT || 'development',
      'aws.lambda.function_name': process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
    });

    const exporter = new OTLPTraceExporter({
      url: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`,
      headers: authHeader,
    });

    provider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    provider.register();
    tracer = trace.getTracer('capy-pos-api', '0.0.0');
  } catch (err) {
    // Telemetry init is best-effort and must never break the handler.
    if (process.env.OTEL_DEBUG) console.error('[telemetry] init failed:', err);
  }
}

/**
 * Run `fn` inside a SERVER span named `name`. Reads the handler's HTTP response
 * status to set http.status_code and an ERROR status on 5xx; marks ERROR on a
 * thrown exception too. No-ops gracefully if telemetry failed to initialize.
 *
 * @param {string} name e.g. "GET /api/products"
 * @param {Record<string, unknown>} attributes initial span attributes
 * @param {(span: object) => Promise<any>} fn the handler body
 */
async function withSpan(name, attributes, fn) {
  if (!tracer) return fn();

  const { SpanKind, SpanStatusCode } = require('@opentelemetry/api');
  const span = tracer.startSpan(name, { kind: SpanKind.SERVER, attributes });

  try {
    const result = await fn(span);
    const status = result && result.statusCode;
    if (status) span.setAttribute('http.status_code', status);
    span.setStatus({ code: status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err && err.message });
    if (typeof span.recordException === 'function') span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Flush pending spans after each invocation. forceFlush (not shutdown) keeps
 * the provider alive for warm-container reuse.
 */
async function flushTelemetry() {
  if (provider) {
    try {
      await provider.forceFlush();
    } catch (err) {
      // best-effort
    }
  }
}

/**
 * Wrap a Lambda handler with telemetry: init (idempotent), one SERVER span
 * around the whole invocation, and a flush afterwards. Usage:
 *   exports.handler = instrument('GET /api/products', async (event) => { ... });
 *
 * @param {string} name e.g. "GET /api/products"
 * @param {(event: object, context: object) => Promise<any>} handler
 */
function instrument(name, handler) {
  const space = name.indexOf(' ');
  const method = space > 0 ? name.slice(0, space) : '';
  const route = space > 0 ? name.slice(space + 1) : name;
  return async (event, context) => {
    initTelemetry();
    try {
      return await withSpan(name, { 'http.method': method, 'http.route': route }, () =>
        handler(event, context)
      );
    } finally {
      await flushTelemetry();
    }
  };
}

module.exports = {
  initTelemetry,
  withSpan,
  instrument,
  flushTelemetry,
};
