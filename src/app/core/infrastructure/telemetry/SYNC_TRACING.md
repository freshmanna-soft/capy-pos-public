# Sync Tracing for Offline-First Scenarios

## Overview

`SyncTracerService` instruments the offline-first sync system with OpenTelemetry spans, enabling full visibility into:
- **Queue operations** (enqueue, flush, merge)
- **Product sync lifecycle** (create/update/delete → retry → conflict resolution → completion)
- **Retry attempts** (with error context)
- **Conflict resolution** (before/after snapshots)
- **Queue health metrics** (depth, pending count, failure rate)

All traces are exported to Grafana Cloud for real-time observability during failure-injection demo.

## Usage Pattern

### 1. Instrument Product Push

```typescript
import { SyncTracerService } from '@core/infrastructure/telemetry/sync-tracer.service';

export class ProductSyncUseCase {
  constructor(
    private syncTracer: SyncTracerService,
    private syncService: SyncService,
  ) {}

  async updateProduct(product: Product): Promise<PushResult> {
    // Start tracing the product push
    const span = this.syncTracer.startProductPush(product.id, 'update', {
      'product.name': product.name,
      'product.price': product.price,
    });

    try {
      // Send to sync service (which queues for offline transmission)
      const result = await this.syncService.pushUpdateAsync(product);

      // Record success
      this.syncTracer.endProductPush(product.id, true, {
        'sync.duration_ms': Date.now() - startTime,
        'sync.attempt_count': result.attempts,
      });

      return result;
    } catch (error) {
      // Capture retry context
      if (error.code === 'NetworkError') {
        this.syncTracer.recordRetry(product.id, 1, error);
      }

      // Record failure
      this.syncTracer.endProductPush(product.id, false, {
        'sync.error': error.message,
        'sync.error_code': error.code,
      });

      throw error;
    }
  }
}
```

### 2. Track Conflicts

```typescript
// When merging local and remote versions
const localVersion = product.version;
const remoteVersion = serverProduct.version;

if (localVersion !== remoteVersion) {
  this.syncTracer.recordConflictResolution(product.id, 'version_conflict', {
    local_version: localVersion,
    remote_version: remoteVersion,
    local_modified: product.modifiedAt,
    remote_modified: serverProduct.modifiedAt,
    resolution: 'use_remote', // or 'merge' or 'local'
    merged_fields: ['price', 'stock'],
  });
}
```

### 3. Monitor Queue Health

```typescript
// In a periodic health check (e.g., every 30s)
const queueStats = await this.db.getSyncQueueStats();

this.syncTracer.recordQueueDepth(
  queueStats.total,        // Total items in queue
  queueStats.pending,      // Awaiting sync attempt
  queueStats.failed,       // Failed items (retrying or awaiting manual retry)
);

// Also track overall health
this.syncTracer.recordSyncHealth(
  queueStats.successCount,     // Items successfully synced
  queueStats.failureCount,     // Items still failing
  queueStats.avgDuration,      // Average sync duration
  60000,                       // Time window: last 60s
);
```

### 4. Correlate with Audit Trail

```typescript
// Combine sync tracing with audit logging
const traceId = this.syncTracer.getCurrentTraceId();
this.auditLog.log({
  action: 'SYNC_PRODUCT_PUSH',
  entityId: product.id,
  result: 'SUCCESS',
  traceId, // Link to OpenTelemetry trace
  metadata: {
    offline_queue_depth: queueStats.total,
    retry_count: result.attempts,
  },
});
```

## Grafana Sync Dashboard Panels

### Panel: Sync Queue Depth (Gauge)
Shows current offline queue depth; alerts when > 50 items.

```promql
sync_queue_total{service="capy-pos"}
```

### Panel: Sync Success Rate (Line Chart)
Tracks % of sync operations succeeding over time; dips during network outages.

```promql
(sum(rate(sync_success_total[5m])) / (sum(rate(sync_success_total[5m])) + sum(rate(sync_failure_total[5m])))) * 100
```

### Panel: Conflict Resolution Events (Table)
Lists recent conflicts and resolution strategy.

```
service.sync.conflict_type = "version_conflict" OR "data_mismatch"
```

### Panel: Retry Distribution (Histogram)
Shows how many retries are needed on average before sync succeeds.

```promql
histogram_quantile(0.99, rate(sync_retry_attempts_bucket[5m]))
```

## Trace Example (Grafana UI)

When you click a trace ID in the dashboard, you'll see spans like:

```
sync.product_push.update
├── span_id: d6f6b51c
├── duration: 1250ms
├── attributes:
│   sync.product_id: "prod-789"
│   sync.action: "update"
│   product.name: "Widget Pro"
│   product.price: 99.99
├── events:
│   ├── retry (attempt=1, error="Connection timeout")
│   ├── conflict_resolved (conflict_type="version_conflict", resolution="use_remote")
│   └── (implicit: span end with status=OK)
└── linked_spans:
    └── http.request (backend PATCH /api/products/prod-789)
```

## Failure Injection Demo

When `ENABLE_FAILURE=true` on Lambda:

1. **Queue accumulates** → sync depth metric spikes
2. **Retries fire rapidly** → `sync_retry_attempts` counter increments
3. **Conflicts may occur** → if remote version was updated during outage
4. **Eventually succeeds** → after 25s delay resolves, or user triggers manual sync

Dashboard shows:
- Queue depth: 0 → 42 → 0 (clears after retry succeeds)
- Success rate: 100% → 0% (during failure window) → 100%
- Conflict events: X resolved (if concurrent edits)
- Avg retry attempts: 1-3 (depending on retry strategy)

## Integration Checklist

- [ ] Inject `SyncTracerService` into sync-related use cases
- [ ] Call `startProductPush()` when queuing a product sync
- [ ] Call `recordRetry()` on each failed attempt before retry
- [ ] Call `recordConflictResolution()` when merging local/remote versions
- [ ] Call `endProductPush()` when sync completes (success or final failure)
- [ ] Call `recordQueueDepth()` periodically (e.g., every sync cycle)
- [ ] Call `recordSyncHealth()` every 60s for health metrics
- [ ] Call `flushSyncSpans()` on app shutdown
- [ ] Link audit log entries with `getCurrentTraceId()`
