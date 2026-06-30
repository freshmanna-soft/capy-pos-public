let sdk = null;

/**
 * Initialize OpenTelemetry SDK for Lambda.
 *
 * Requires are performed lazily inside the try/catch so that a missing or
 * broken telemetry dependency can never crash Lambda init — telemetry is
 * strictly best-effort and must stay non-fatal.
 */
function initTelemetry() {
  if (sdk) return;

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
    const { Resource } = require('@opentelemetry/resources');
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } = require('@opentelemetry/semantic-conventions');
    const { AwsInstrumentation } = require('@opentelemetry/instrumentation-aws-sdk');

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317';
    const apiKey = process.env.GRAFANA_OTLP_API_KEY || '';

    const resource = Resource.default().merge(
      new Resource({
        [SEMRESATTRS_SERVICE_NAME]: 'capy-pos-api',
        [SEMRESATTRS_SERVICE_VERSION]: '0.0.0',
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.ENVIRONMENT || 'development',
        'aws.lambda.function_name': process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown',
      }),
    );

    const exporter = new OTLPTraceExporter({
      url: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });

    sdk = new NodeSDK({
      resource,
      traceExporter: exporter,
      instrumentations: [
        new AwsInstrumentation(),
      ],
    });

    sdk.start();
  } catch (error) {
    // Telemetry initialization failure is non-fatal
  }
}

/**
 * Flush pending spans before Lambda shutdown
 */
async function flushTelemetry() {
  if (sdk) {
    await sdk.shutdown();
  }
}

module.exports = {
  initTelemetry,
  flushTelemetry,
};
