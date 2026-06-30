/**
 * Structured JSON logger for CloudWatch
 * Shared across all Lambda functions
 */

const { trace } = require('@opentelemetry/api');

function log(level, message, data = {}) {
  const span = trace.getActiveSpan();
  const traceId = span ? span.spanContext().traceId : process.env._X_AMZN_TRACE_ID || 'no-trace';

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
    traceId,
    awsTraceId: process.env._X_AMZN_TRACE_ID,
  };
  console.log(JSON.stringify(entry));
}

function response(statusCode, body) {
  const span = trace.getActiveSpan();
  const traceId = span ? span.spanContext().traceId : process.env._X_AMZN_TRACE_ID || 'unavailable';

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amzn-Trace-Id',
      'Access-Control-Expose-Headers': 'X-Trace-Id',
      'X-Trace-Id': traceId,
    },
    body: JSON.stringify(body),
  };
}

module.exports = { log, response };
