# Lambda OpenTelemetry Instrumentation

## Setup

All Lambda functions now have access to the OpenTelemetry SDK through the shared layer (`layer/nodejs`). The layer includes:

- `@opentelemetry/sdk-node` — Node.js SDK
- `@opentelemetry/exporter-trace-otlp-proto` — OTLP exporter
- `@opentelemetry/instrumentation-aws-sdk` — Auto-instrumentation for DynamoDB/S3 calls
- `@opentelemetry/instrumentation-http` — Auto-instrumentation for HTTP calls

## Usage Pattern

Each Lambda handler should follow this pattern:

```javascript
// 1. Import telemetry utilities
const { initTelemetry, flushTelemetry } = require('./shared/telemetry');

// 2. Initialize telemetry at module load (top-level, before handler)
initTelemetry();

// 3. Wire up handler with try/finally to flush traces
exports.handler = async (event) => {
  try {
    // ... handler logic ...
    return response(200, { data });
  } catch (error) {
    return response(500, { error: error.message });
  } finally {
    // Flush pending spans before Lambda shutdown
    await flushTelemetry();
  }
};
```

## Environment Variables

Set these in Lambda function environment or Terraform:

- `OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-3.grafana.net/otlp` — Grafana Cloud OTLP endpoint
- `GRAFANA_OTLP_API_KEY=<token>` — Grafana Cloud API token
- `ENVIRONMENT=production|staging|development` — Deployment environment

## Trace Correlation

The logger automatically captures the OpenTelemetry trace ID:

```javascript
const { trace } = require('@opentelemetry/api');
const span = trace.getActiveSpan();
const traceId = span ? span.spanContext().traceId : 'no-trace';
```

The `X-Trace-Id` response header links frontend traces (from browser) to backend traces (from Lambda), enabling full request tracing end-to-end.

## Failure Injection Demo

When `ENABLE_FAILURE=true`:
- Simulated 25s delay → appears as slow DynamoDB span in Grafana
- Data corruption → recorded as span event with before/after state
- Errors → recorded with full stack trace in CloudWatch + Grafana
