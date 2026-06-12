/**
 * AWS X-Ray Troubleshooter MCP Server
 *
 * This MCP server provides a tool that takes an AWS X-Ray Trace ID,
 * fetches the trace data and related CloudWatch logs, analyzes the
 * failure, and returns a human-readable diagnosis.
 *
 * Tools:
 *   - troubleshoot_trace: Diagnose a failure from an X-Ray trace ID
 *   - toggle_failure: Enable/disable failure mode on the demo API
 *   - get_recent_traces: Get recent error traces from X-Ray
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';

const REGION = process.env.AWS_REGION || 'us-east-1';
const LOG_GROUP = process.env.LOG_GROUP || '/aws/lambda/capy-pos-demo-get-products';

// =============================================================================
// Helper: Run AWS CLI command
// =============================================================================

function awsCli(command) {
  try {
    const result = execSync(`aws ${command} --region ${REGION} --output json --no-cli-pager`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    return JSON.parse(result);
  } catch (error) {
    return { error: error.message, stderr: error.stderr };
  }
}

function awsCliRaw(command) {
  try {
    return execSync(`aws ${command} --region ${REGION} --no-cli-pager`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
  } catch (error) {
    return `ERROR: ${error.message}`;
  }
}

// =============================================================================
// Tool: Troubleshoot Trace
// =============================================================================

async function troubleshootTrace(traceId) {
  const steps = [];

  // Step 1: Fetch the trace
  steps.push('## 🔍 Step 1: Fetching X-Ray Trace');
  steps.push(`Trace ID: \`${traceId}\``);
  steps.push('');

  const traceData = awsCli(`xray batch-get-traces --trace-ids "${traceId}"`);

  if (traceData.error) {
    return `❌ Failed to fetch trace: ${traceData.error}`;
  }

  const traces = traceData.Traces || [];
  if (traces.length === 0) {
    return `❌ No trace found for ID: ${traceId}. The trace may not have been indexed yet (X-Ray can take up to 30 seconds).`;
  }

  const trace = traces[0];
  const segments = trace.Segments || [];

  steps.push(`Found ${segments.length} segment(s) in trace.`);
  steps.push('');

  // Step 2: Analyze segments for errors
  steps.push('## 🧩 Step 2: Analyzing Trace Segments');
  steps.push('');

  let errorSegments = [];
  let rootCause = null;
  let duration = 0;

  for (const segment of segments) {
    const doc = JSON.parse(segment.Document);
    const segDuration = ((doc.end_time || 0) - (doc.start_time || 0)).toFixed(3);
    duration = Math.max(duration, parseFloat(segDuration));

    const status = doc.error
      ? '❌ ERROR'
      : doc.fault
        ? '💥 FAULT'
        : doc.throttle
          ? '⚠️ THROTTLE'
          : '✅ OK';
    steps.push(`| Segment: **${doc.name}** | Status: ${status} | Duration: ${segDuration}s |`);

    if (doc.error || doc.fault) {
      errorSegments.push(doc);

      // Look for cause
      if (doc.cause) {
        rootCause = doc.cause;
      }

      // Check subsegments
      if (doc.subsegments) {
        for (const sub of doc.subsegments) {
          if (sub.error || sub.fault) {
            steps.push(
              `  └─ Subsegment: **${sub.name}** | ${sub.fault ? '💥 FAULT' : '❌ ERROR'} | ${((sub.end_time || 0) - (sub.start_time || 0)).toFixed(3)}s`
            );
            if (sub.cause) {
              rootCause = sub.cause;
            }
          }
        }
      }
    }
  }

  steps.push('');

  // Step 3: Fetch related CloudWatch logs
  steps.push('## 📋 Step 3: Fetching Related CloudWatch Logs');
  steps.push('');

  // Get logs from around the time of the trace (last 5 minutes)
  const startTime = Date.now() - 5 * 60 * 1000;
  const logsData = awsCli(
    `logs filter-log-events --log-group-name "${LOG_GROUP}" --start-time ${startTime} --filter-pattern "ERROR" --limit 10`
  );

  if (logsData.events && logsData.events.length > 0) {
    steps.push(`Found ${logsData.events.length} error log event(s):`);
    steps.push('');
    steps.push('```');
    for (const event of logsData.events.slice(0, 5)) {
      try {
        const parsed = JSON.parse(event.message);
        steps.push(`[${parsed.timestamp}] ${parsed.level}: ${parsed.message}`);
        if (parsed.scenario) steps.push(`  Scenario: ${parsed.scenario}`);
        if (parsed.error) steps.push(`  Error: ${parsed.error}`);
        if (parsed.productId) steps.push(`  Product: ${parsed.productId}`);
        if (parsed.stock !== undefined) steps.push(`  Stock: ${parsed.stock}`);
      } catch {
        steps.push(event.message.substring(0, 200));
      }
    }
    steps.push('```');
  } else {
    steps.push('No recent error logs found (or log group not accessible).');

    // Try fetching all recent logs with the trace ID
    const traceLogsData = awsCli(
      `logs filter-log-events --log-group-name "${LOG_GROUP}" --start-time ${startTime} --filter-pattern "${traceId.replace('1-', '')}" --limit 5`
    );
    if (traceLogsData.events && traceLogsData.events.length > 0) {
      steps.push('');
      steps.push('Found logs correlated to this trace:');
      steps.push('```');
      for (const event of traceLogsData.events) {
        steps.push(event.message.substring(0, 300));
      }
      steps.push('```');
    }
  }

  steps.push('');

  // Step 4: Diagnosis
  steps.push('## 🩺 Step 4: Diagnosis');
  steps.push('');

  if (errorSegments.length === 0 && duration < 25) {
    steps.push('✅ **No errors detected in this trace.** The request completed successfully.');
    steps.push(`Total duration: ${duration.toFixed(3)}s`);
  } else if (duration >= 25) {
    // Timeout scenario
    steps.push('### 🕐 Root Cause: Lambda Timeout');
    steps.push('');
    steps.push(
      `The request took **${duration.toFixed(1)}s** which exceeds or approaches the Lambda timeout (30s).`
    );
    steps.push('');
    steps.push('**What happened:**');
    steps.push('1. The Lambda function received the request');
    steps.push('2. A simulated slow DynamoDB query was triggered (failure mode enabled)');
    steps.push('3. The function waited 25+ seconds before the actual DB call');
    steps.push('4. Lambda timed out before returning a response');
    steps.push('');
    steps.push('**Fix:**');
    steps.push('- Disable failure mode: `POST /api/fail/toggle`');
    steps.push('- In production: Add DynamoDB query timeouts, implement circuit breakers');
    steps.push('- Consider: DAX (DynamoDB Accelerator) for caching');
  } else if (rootCause || errorSegments.length > 0) {
    // Error scenario
    const errorDoc = errorSegments[0];
    const httpStatus = errorDoc?.http?.response?.status;

    if (httpStatus === 500) {
      steps.push('### 💥 Root Cause: Application Error (500)');
      steps.push('');
      steps.push('The Lambda function threw an unhandled exception.');
      steps.push('');

      if (rootCause?.exceptions) {
        for (const ex of rootCause.exceptions) {
          steps.push(`**Exception:** ${ex.type || 'Error'}`);
          steps.push(`**Message:** ${ex.message || 'Unknown'}`);
        }
      }

      steps.push('');
      steps.push(
        '**Likely scenario:** ConditionalCheckFailedException — attempted to sell a product with 0 stock while failure mode is enabled.'
      );
      steps.push('');
      steps.push('**Fix:**');
      steps.push('- Disable failure mode: `POST /api/fail/toggle`');
      steps.push('- In production: Add proper stock validation before DynamoDB update');
      steps.push('- Use DynamoDB ConditionExpression to prevent negative stock atomically');
    } else {
      steps.push(`### ❌ Root Cause: HTTP ${httpStatus || 'Error'}`);
      steps.push('');
      steps.push('An error occurred during request processing.');
      if (rootCause) {
        steps.push(`Details: ${JSON.stringify(rootCause, null, 2).substring(0, 500)}`);
      }
    }
  }

  steps.push('');
  steps.push('---');
  steps.push(
    `*Analysis performed at ${new Date().toISOString()} using AWS X-Ray + CloudWatch Logs*`
  );

  return steps.join('\n');
}

// =============================================================================
// Tool: Get Recent Error Traces
// =============================================================================

async function getRecentTraces() {
  const steps = [];
  steps.push('## 📊 Recent Error Traces (last 5 minutes)');
  steps.push('');

  const startTime = Math.floor((Date.now() - 5 * 60 * 1000) / 1000);
  const endTime = Math.floor(Date.now() / 1000);

  const summaries = awsCli(
    `xray get-trace-summaries --start-time ${startTime} --end-time ${endTime} --filter-expression "responsetime > 5 OR error = true OR fault = true"`
  );

  if (summaries.error) {
    return `❌ Failed to fetch trace summaries: ${summaries.error}`;
  }

  const traces = summaries.TraceSummaries || [];

  if (traces.length === 0) {
    steps.push('No error traces found in the last 5 minutes.');
    steps.push('');
    steps.push('**To generate errors:**');
    steps.push('1. Enable failure mode: `curl -X POST <API_URL>/api/fail/toggle`');
    steps.push('2. Try selling a product: `curl -X POST <API_URL>/api/products/prod-010/sell`');
    steps.push('3. Or fetch products (will timeout): `curl <API_URL>/api/products`');
    return steps.join('\n');
  }

  steps.push(`Found **${traces.length}** trace(s) with errors or high latency:`);
  steps.push('');
  steps.push('| # | Trace ID | Duration | Status | Has Error |');
  steps.push('|---|----------|----------|--------|-----------|');

  for (let i = 0; i < Math.min(traces.length, 10); i++) {
    const t = traces[i];
    const dur = (t.Duration || 0).toFixed(2);
    const status = t.Http?.HttpStatus || '-';
    const hasError = t.HasError || t.HasFault ? '❌ Yes' : '✅ No';
    steps.push(`| ${i + 1} | \`${t.Id}\` | ${dur}s | ${status} | ${hasError} |`);
  }

  steps.push('');
  steps.push('**Use `troubleshoot_trace` with any Trace ID above to get a full diagnosis.**');

  return steps.join('\n');
}

// =============================================================================
// Tool: Toggle Failure Mode (via Lambda env var update)
// =============================================================================

async function toggleFailure(enable) {
  const functionNames = ['capy-pos-demo-get-products', 'capy-pos-demo-sell-product'];

  const newValue = enable ? 'true' : 'false';
  const results = [];

  for (const fnName of functionNames) {
    const configData = awsCli(`lambda get-function-configuration --function-name "${fnName}"`);
    if (configData.error) {
      results.push(`❌ ${fnName}: Failed to get config — ${configData.error}`);
      continue;
    }

    const envVars = configData.Environment?.Variables || {};
    envVars.ENABLE_FAILURE = newValue;
    const envJson = JSON.stringify({ Variables: envVars });

    // Write env to temp file to avoid shell escaping issues
    const fs = await import('fs');
    const tmpFile = `/tmp/lambda-env-${fnName}.json`;
    fs.writeFileSync(tmpFile, envJson);

    const updateResult = awsCliRaw(
      `lambda update-function-configuration --function-name "${fnName}" --environment file://${tmpFile}`
    );

    if (updateResult.includes('ERROR')) {
      results.push(`❌ ${fnName}: ${updateResult}`);
    } else {
      results.push(`✅ ${fnName}: ENABLE_FAILURE=${newValue}`);
    }
  }

  const status = enable ? 'ENABLED 💥' : 'DISABLED ✅';
  return `## Failure Mode: ${status}\n\nUpdated Lambda environment variables:\n${results.map((r) => `- ${r}`).join('\n')}\n\n${enable ? '**Now trigger failures:**\n- `GET /api/products` → 25s timeout\n- `POST /api/products/prod-010/sell` → negative stock error' : 'All endpoints will respond normally.'}`;
}

// =============================================================================
// MCP Server Setup
// =============================================================================

const server = new Server(
  {
    name: 'aws-xray-troubleshooter',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'troubleshoot_trace',
        description:
          'Diagnose an application failure using an AWS X-Ray Trace ID. Fetches the trace, analyzes segments for errors/faults, retrieves related CloudWatch logs, and provides a root cause diagnosis with suggested fixes.',
        inputSchema: {
          type: 'object',
          properties: {
            traceId: {
              type: 'string',
              description:
                'The AWS X-Ray Trace ID (format: 1-xxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx). You can find this in the API response X-Trace-Id header or in the AWS Console.',
            },
          },
          required: ['traceId'],
        },
      },
      {
        name: 'get_recent_traces',
        description:
          'Get recent X-Ray traces that have errors, faults, or high latency (last 5 minutes). Use this to find trace IDs to troubleshoot.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'toggle_failure',
        description:
          'Toggle the failure mode on the Capy-POS demo Lambda functions. When enabled, get-products and sell-product will simulate failure scenarios (timeouts, stock errors, data corruption).',
        inputSchema: {
          type: 'object',
          properties: {
            enable: {
              type: 'boolean',
              description: 'Set to true to enable failure mode, false to disable it.',
            },
          },
          required: ['enable'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'troubleshoot_trace': {
      const result = await troubleshootTrace(args.traceId);
      return { content: [{ type: 'text', text: result }] };
    }
    case 'get_recent_traces': {
      const result = await getRecentTraces();
      return { content: [{ type: 'text', text: result }] };
    }
    case 'toggle_failure': {
      const result = await toggleFailure(args.enable);
      return { content: [{ type: 'text', text: result }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🔧 AWS X-Ray Troubleshooter MCP Server running on stdio');
}

main().catch(console.error);
