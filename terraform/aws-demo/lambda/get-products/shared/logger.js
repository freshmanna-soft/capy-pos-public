/**
 * Structured JSON logger for CloudWatch
 * Shared across all Lambda functions
 */

function log(level, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
    traceId: process.env._X_AMZN_TRACE_ID || 'no-trace'
  };
  console.log(JSON.stringify(entry));
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amzn-Trace-Id',
      'X-Trace-Id': process.env._X_AMZN_TRACE_ID || 'unavailable'
    },
    body: JSON.stringify(body)
  };
}

module.exports = { log, response };
