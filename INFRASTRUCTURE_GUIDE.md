# Capy-POS Infrastructure Services Guide

## Overview

This document provides comprehensive documentation for the enterprise-grade infrastructure services implemented in Capy-POS. These services provide fault tolerance, observability, resilience, and monitoring capabilities for the agent-based architecture.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [EventBusService](#eventbusservice)
3. [AuditLogService](#auditlogservice)
4. [CircuitBreakerService](#circuitbreakerservice)
5. [RetryService](#retryservice)
6. [TelemetryService](#telemetryservice)
7. [Agent Monitor Dashboard](#agent-monitor-dashboard)
8. [Integration Guide](#integration-guide)
9. [Best Practices](#best-practices)

---

## Architecture Overview

### Design Principles

All infrastructure services follow consistent design patterns:

- **Standalone Services**: Use `@Injectable({ providedIn: 'root' })` for singleton instances
- **No Inheritance**: Services are self-contained (unlike agents which extend BaseAgent)
- **RxJS Observables**: Real-time data streaming for monitoring
- **Custom Error Types**: Proper error handling with typed exceptions
- **Statistics Tracking**: Built-in metrics for all operations
- **Type Safety**: Full TypeScript support with interfaces

### Service Hierarchy

```
Infrastructure Services
├── Messaging
│   └── EventBusService (Inter-agent communication)
├── Audit
│   └── AuditLogService (Compliance & tracking)
├── Resilience
│   ├── CircuitBreakerService (Fault tolerance)
│   └── RetryService (Retry logic)
├── Telemetry
│   └── TelemetryService (Metrics & monitoring)
└── UI
    └── AgentMonitorComponent (Dashboard)
```

---

## EventBusService

### Purpose
Provides publish-subscribe messaging for inter-agent communication with topic-based routing and priority queuing.

### Location
`src/app/core/infrastructure/messaging/event-bus.service.ts`

### Key Features
- Topic-based message routing
- Priority levels (low, normal, high, critical)
- Message history with configurable size
- Statistics tracking
- Real-time streaming via RxJS

### Usage

```typescript
import { EventBusService } from '@core/infrastructure/messaging';

constructor(private eventBus: EventBusService) {}

// Publish a message
this.eventBus.publish({
  type: 'PAYMENT_PROCESSED',
  source: 'PaymentAgent',
  target: 'AnalyticsAgent', // Optional
  payload: { amount: 100, transactionId: 'TXN-123' },
  priority: 'high',
  metadata: { timestamp: new Date() }
});

// Subscribe to specific message types
this.eventBus.subscribeToType('PAYMENT_PROCESSED')
  .subscribe(message => {
    console.log('Payment processed:', message.payload);
  });

// Subscribe to messages from specific source
this.eventBus.subscribeToSource('PaymentAgent')
  .subscribe(message => {
    console.log('Message from PaymentAgent:', message);
  });

// Get statistics
const stats = this.eventBus.getStatistics();
console.log('Total messages:', stats.totalMessages);
console.log('By type:', stats.byType);
```

### Message Format

```typescript
interface EventBusMessage<T = any> {
  id: string;              // Auto-generated
  type: string;            // Message type
  source: string;          // Sender agent
  target?: string;         // Optional recipient
  payload: T;              // Message data
  timestamp: Date;         // Auto-generated
  priority: 'low' | 'normal' | 'high' | 'critical';
  metadata?: Record<string, any>;
}
```

---

## AuditLogService

### Purpose
Comprehensive audit logging for compliance, debugging, and security tracking with persistent storage.

### Location
`src/app/core/infrastructure/audit/audit-log.service.ts`

### Key Features
- Persistent storage using Dexie (IndexedDB)
- Flexible querying and filtering
- Change tracking for UPDATE operations
- Export capabilities (JSON/CSV)
- Compliance support (log purging)
- Statistics and analytics

### Usage

```typescript
import { AuditLogService, AuditAction, AuditStatus } from '@core/infrastructure/audit';

constructor(private auditLog: AuditLogService) {}

// Log a successful operation
await this.auditLog.log({
  agentName: 'PaymentAgent',
  operation: 'processPayment',
  entityType: 'Payment',
  entityId: 'PAY-123',
  action: AuditAction.CREATE,
  status: AuditStatus.SUCCESS,
  duration: 1500,
  metadata: {
    amount: 100,
    method: 'CREDIT_CARD'
  }
});

// Log a failed operation
await this.auditLog.log({
  agentName: 'PaymentAgent',
  operation: 'processRefund',
  entityType: 'Payment',
  entityId: 'PAY-456',
  action: AuditAction.REFUND,
  status: AuditStatus.FAILURE,
  errorMessage: 'Insufficient funds',
  duration: 800
});

// Query logs
const logs = await this.auditLog.query({
  agentName: 'PaymentAgent',
  startDate: new Date('2024-01-01'),
  endDate: new Date(),
  status: AuditStatus.SUCCESS,
  limit: 50
});

// Get entity audit trail
const trail = await this.auditLog.getEntityAuditTrail('Payment', 'PAY-123');

// Export logs
const csv = await this.auditLog.export({
  startDate: new Date('2024-01-01'),
  endDate: new Date()
}, 'csv');

// Purge old logs (compliance)
const purged = await this.auditLog.purgeOldLogs(90); // Older than 90 days
```

### Audit Actions

```typescript
enum AuditAction {
  CREATE, READ, UPDATE, DELETE,
  EXECUTE, APPROVE, REJECT,
  VOID, REFUND,
  LOGIN, LOGOUT,
  EXPORT, IMPORT
}
```

---

## CircuitBreakerService

### Purpose
Implements the Circuit Breaker pattern to prevent cascading failures and provide fault tolerance.

### Location
`src/app/core/infrastructure/resilience/circuit-breaker.service.ts`

### Key Features
- Three states: CLOSED, OPEN, HALF_OPEN
- Configurable failure thresholds
- Automatic recovery attempts
- Per-circuit statistics
- Monitoring period for failure counting
- Custom error type (`CircuitBreakerError`)

### Usage

```typescript
import { CircuitBreakerService } from '@core/infrastructure/resilience';

constructor(private circuitBreaker: CircuitBreakerService) {}

// Execute with circuit breaker protection
const result = await this.circuitBreaker.execute(
  'payment-gateway',
  async () => {
    return await this.paymentGateway.charge(amount);
  },
  {
    failureThreshold: 5,      // Open after 5 failures
    successThreshold: 2,      // Close after 2 successes in HALF_OPEN
    timeout: 60000,           // Try HALF_OPEN after 60s
    monitoringPeriod: 120000  // Count failures in 2min window
  }
);

// Get circuit breaker state
const breaker = this.circuitBreaker.getBreaker('payment-gateway');
console.log('State:', breaker.getState()); // CLOSED, OPEN, or HALF_OPEN

// Get statistics
const stats = breaker.getStats();
console.log('Total calls:', stats.totalCalls);
console.log('Failures:', stats.totalFailures);
console.log('Consecutive failures:', stats.consecutiveFailures);

// Reset circuit breaker
this.circuitBreaker.reset('payment-gateway');
```

### Circuit States

```
CLOSED (Normal)
    ↓ (failures >= threshold)
OPEN (Rejecting requests)
    ↓ (after timeout)
HALF_OPEN (Testing recovery)
    ↓ (success >= threshold)
CLOSED
    ↓ (any failure)
OPEN
```

---

## RetryService

### Purpose
Implements retry logic with multiple backoff strategies for transient failure recovery.

### Location
`src/app/core/infrastructure/resilience/retry.service.ts`

### Key Features
- Multiple strategies (FIXED, EXPONENTIAL, LINEAR)
- Configurable retry conditions
- Jitter support (prevents thundering herd)
- Statistics tracking
- Custom error type (`RetryExhaustedError`)
- Decorator support

### Usage

```typescript
import { RetryService, RetryStrategy } from '@core/infrastructure/resilience';

constructor(private retry: RetryService) {}

// Basic usage with exponential backoff
const result = await this.retry.execute(
  'api-call',
  async () => {
    return await fetch('/api/data');
  },
  {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    strategy: RetryStrategy.EXPONENTIAL,
    backoffMultiplier: 2
  }
);

// Convenience methods
await this.retry.executeWithExponentialBackoff(
  'payment-processing',
  async () => processPayment(),
  3,    // max attempts
  1000  // initial delay
);

await this.retry.executeWithFixedDelay(
  'database-query',
  async () => db.query(),
  5,    // max attempts
  500   // delay between attempts
);

// Custom retry condition
await this.retry.execute('api-call', async () => {
  return await api.getData();
}, {
  maxAttempts: 5,
  initialDelay: 1000,
  shouldRetry: (error) => {
    // Only retry on network errors
    return error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
  }
});

// Retry specific error messages
await this.retry.execute('api-call', async () => {
  return await api.getData();
}, {
  maxAttempts: 3,
  initialDelay: 1000,
  retryableErrors: ['timeout', 'connection', 'network']
});

// Using decorator
class MyService {
  @Retry({ maxAttempts: 3, initialDelay: 1000 })
  async fetchData() {
    return await api.getData();
  }
}
```

### Retry Strategies

```typescript
// FIXED: Constant delay
// Delays: 1000ms, 1000ms, 1000ms

// EXPONENTIAL: Exponential backoff
// Delays: 1000ms, 2000ms, 4000ms, 8000ms

// LINEAR: Linear backoff
// Delays: 1000ms, 2000ms, 3000ms, 4000ms
```

---

## TelemetryService

### Purpose
Collects and manages application metrics and telemetry data for performance monitoring.

### Location
`src/app/core/infrastructure/telemetry/telemetry.service.ts`

### Key Features
- Multiple metric types (COUNTER, GAUGE, HISTOGRAM, TIMER)
- Real-time streaming via RxJS
- Percentile calculations (p50, p95, p99)
- Event tracking
- System metrics monitoring
- Decorator support

### Usage

```typescript
import { TelemetryService, MetricType } from '@core/infrastructure/telemetry';

constructor(private telemetry: TelemetryService) {}

// Record counter (incremental)
this.telemetry.recordCounter('api.requests', 1, { endpoint: '/api/users' });

// Record gauge (current value)
this.telemetry.recordGauge('queue.size', 42, { queue: 'payments' }, 'items');

// Record histogram (distribution)
this.telemetry.recordHistogram('response.time', 150, { endpoint: '/api/data' }, 'ms');

// Start/stop timer
const stopTimer = this.telemetry.startTimer('database.query', { table: 'users' });
// ... perform operation ...
stopTimer(); // Records duration

// Measure async function
const result = await this.telemetry.measureAsync(
  'payment.processing',
  async () => {
    return await this.processPayment(data);
  },
  { method: 'credit_card' }
);

// Track event
this.telemetry.trackEvent('user.login', {
  userId: 'user-123',
  source: 'web'
}, {
  loginTime: 1500
});

// Get metric summary
const summary = this.telemetry.getMetricSummary('response.time');
console.log('Average:', summary.avg);
console.log('P95:', summary.p95);
console.log('P99:', summary.p99);

// Subscribe to real-time metrics
this.telemetry.metrics$.subscribe(metric => {
  console.log('New metric:', metric);
});

// Using decorator
class MyService {
  @Measure('user.service.getData')
  async getData() {
    return await api.getData();
  }
}
```

---

## Agent Monitor Dashboard

### Purpose
Real-time UI dashboard for monitoring all agents and infrastructure services.

### Location
`src/app/features/dashboard/agent-monitor/agent-monitor.component.ts`

### Key Features
- Live agent status display
- Circuit breaker state visualization
- Metrics dashboard
- Recent audit logs
- Event bus activity
- Auto-refresh every 5 seconds
- Responsive grid layout

### Usage

```typescript
// Add to routing
{
  path: 'monitor',
  component: AgentMonitorComponent
}

// Navigate to dashboard
this.router.navigate(['/monitor']);
```

### Dashboard Sections

1. **Header Stats**: Total agents, running agents, messages, audit logs
2. **Agents**: Status of all registered agents
3. **Circuit Breakers**: State and statistics for all circuits
4. **Metrics**: Performance metrics with percentiles
5. **Audit Logs**: Recent audit entries with filtering
6. **Event Bus**: Message statistics by type, source, and priority

---

## Integration Guide

### Integrating with Agents

#### Example: PaymentAgent with Full Infrastructure

```typescript
import { Injectable, Inject } from '@angular/core';
import { BaseAgent } from '@agents/base/base-agent';
import { EventBusService } from '@core/infrastructure/messaging';
import { AuditLogService, AuditAction, AuditStatus } from '@core/infrastructure/audit';
import { CircuitBreakerService } from '@core/infrastructure/resilience';
import { RetryService } from '@core/infrastructure/resilience';
import { TelemetryService } from '@core/infrastructure/telemetry';

@Injectable({ providedIn: 'root' })
export class PaymentAgent extends BaseAgent {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private paymentRepo: IPaymentRepository,
    private eventBus: EventBusService,
    private auditLog: AuditLogService,
    private circuitBreaker: CircuitBreakerService,
    private retry: RetryService,
    private telemetry: TelemetryService
  ) {
    super('payment-agent', 'PaymentAgent', 'Handles payment processing');
  }

  async processPayment(request: ProcessPaymentRequest): Promise<ProcessPaymentResponse> {
    const startTime = Date.now();
    
    try {
      // Use circuit breaker for external gateway
      const result = await this.circuitBreaker.execute(
        'payment-gateway',
        async () => {
          // Use retry for transient failures
          return await this.retry.executeWithExponentialBackoff(
            'gateway-charge',
            async () => {
              return await this.paymentGateway.charge(request);
            },
            3,
            1000
          );
        }
      );

      // Record metrics
      this.telemetry.recordCounter('payments.processed', 1, {
        method: request.method
      });
      this.telemetry.recordHistogram(
        'payment.duration',
        Date.now() - startTime,
        { method: request.method },
        'ms'
      );

      // Audit log
      await this.auditLog.log({
        agentName: this.name,
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: result.paymentId,
        action: AuditAction.CREATE,
        status: AuditStatus.SUCCESS,
        duration: Date.now() - startTime,
        metadata: {
          amount: request.amount,
          method: request.method
        }
      });

      // Publish event
      this.eventBus.publish({
        type: 'PAYMENT_PROCESSED',
        source: this.name,
        payload: result,
        priority: 'high'
      });

      return result;

    } catch (error) {
      // Record error metrics
      this.telemetry.recordCounter('payments.failed', 1, {
        method: request.method
      });

      // Audit log failure
      await this.auditLog.log({
        agentName: this.name,
        operation: 'processPayment',
        entityType: 'Payment',
        entityId: request.transactionId,
        action: AuditAction.CREATE,
        status: AuditStatus.FAILURE,
        duration: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          amount: request.amount,
          method: request.method
        }
      });

      throw error;
    }
  }
}
```

---

## Best Practices

### 1. Circuit Breaker Configuration

```typescript
// Conservative (for critical services)
{
  failureThreshold: 3,
  successThreshold: 3,
  timeout: 120000,  // 2 minutes
  monitoringPeriod: 300000  // 5 minutes
}

// Aggressive (for non-critical services)
{
  failureThreshold: 10,
  successThreshold: 2,
  timeout: 30000,  // 30 seconds
  monitoringPeriod: 60000  // 1 minute
}
```

### 2. Retry Strategy Selection

- **FIXED**: Use for rate-limited APIs
- **EXPONENTIAL**: Use for transient network failures
- **LINEAR**: Use for resource contention

### 3. Audit Logging

Always log:
- CREATE, UPDATE, DELETE operations
- Financial transactions
- Authentication events
- Configuration changes
- Data exports

### 4. Telemetry Metrics

Track:
- Request counts and rates
- Response times (with percentiles)
- Error rates
- Queue sizes
- Resource utilization

### 5. Event Bus Usage

- Use priority levels appropriately
- Keep payloads small
- Include correlation IDs in metadata
- Subscribe selectively (by type or source)

---

## Performance Considerations

### Memory Management

- EventBus: Max 1000 messages in history
- AuditLog: Max 100 entries in cache
- Telemetry: Max 1000 data points per metric

### Database Storage

- AuditLog uses IndexedDB (Dexie)
- Automatic cleanup with `purgeOldLogs()`
- Export before purging for archival

### Monitoring Overhead

- Dashboard auto-refresh: 5 seconds
- Telemetry system metrics: 5 seconds
- Circuit breaker checks: Per request
- Retry delays: Configurable

---

## Troubleshooting

### Circuit Breaker Stuck Open

```typescript
// Check state
const breaker = circuitBreakerService.getBreaker('service-name');
console.log(breaker.getState());

// Manual reset
circuitBreakerService.reset('service-name');
```

### High Retry Rates

```typescript
// Check retry statistics
const stats = retryService.getStats('operation-name');
console.log('Average attempts:', stats.averageAttempts);
console.log('Failed retries:', stats.failedRetries);

// Adjust configuration
// - Increase initialDelay
// - Decrease maxAttempts
// - Add custom shouldRetry logic
```

### Audit Log Performance

```typescript
// Use pagination
const logs = await auditLog.query({
  limit: 50,
  offset: 0
});

// Filter by date range
const logs = await auditLog.query({
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-31')
});

// Purge old logs regularly
await auditLog.purgeOldLogs(90);
```

---

## Summary

The Capy-POS infrastructure services provide enterprise-grade capabilities for:

- ✅ **Fault Tolerance**: Circuit breakers prevent cascading failures
- ✅ **Resilience**: Retry logic handles transient failures
- ✅ **Observability**: Comprehensive telemetry and audit logging
- ✅ **Real-time Monitoring**: Event bus and dashboard
- ✅ **Compliance**: Audit trails with retention policies
- ✅ **Performance**: Metrics with percentile calculations

All services are production-ready with comprehensive testing and documentation.