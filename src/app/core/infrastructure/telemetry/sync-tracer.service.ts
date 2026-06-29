import { Injectable, inject } from '@angular/core';
import { trace, Span, SpanStatusCode } from '@opentelemetry/api';
import { OtlpExporterService } from './otlp-exporter.service';

/**
 * Sync Tracer Service
 * Instruments offline-first sync operations with OpenTelemetry spans
 * Tracks queue depth, retry attempts, conflicts, and sync health
 */
@Injectable({
  providedIn: 'root',
})
export class SyncTracerService {
  private tracer = trace.getTracer('sync-service', '0.0.0');
  private syncSpans = new Map<string, Span>(); // Key: productId or operation name
  private otlpExporter = inject(OtlpExporterService);

  /**
   * Start tracing a sync operation (enqueue, flush, merge, etc.)
   */
  startSyncOperation(
    operation: 'enqueue' | 'flush' | 'merge' | 'conflict' | 'retry',
    metadata?: Record<string, unknown>,
  ): Span {
    return this.tracer.startSpan(`sync.${operation}`, {
      attributes: {
        'sync.operation': operation,
        'sync.timestamp': new Date().toISOString(),
        ...metadata,
      },
    });
  }

  /**
   * Track a product push (CREATE/UPDATE/DELETE)
   */
  startProductPush(
    productId: string,
    action: 'create' | 'update' | 'delete',
    metadata?: Record<string, unknown>,
  ): Span {
    const spanName = `sync.product_push.${action}`;
    const span = this.tracer.startSpan(spanName, {
      attributes: {
        'sync.product_id': productId,
        'sync.action': action,
        'sync.type': 'product_push',
        ...metadata,
      },
    });

    this.syncSpans.set(productId, span);
    return span;
  }

  /**
   * Record a retry attempt for a product sync
   */
  recordRetry(productId: string, attempt: number, error?: Error): void {
    const span = this.syncSpans.get(productId);
    if (span) {
      span.addEvent('retry', {
        'sync.retry_attempt': attempt,
        'sync.error': error?.message,
      });
    }
  }

  /**
   * Record a conflict resolution
   */
  recordConflictResolution(
    productId: string,
    conflictType: 'data_mismatch' | 'version_conflict' | 'concurrent_edit',
    resolution: Record<string, unknown>,
  ): void {
    const span = this.syncSpans.get(productId);
    if (span) {
      span.addEvent('conflict_resolved', {
        'sync.conflict_type': conflictType,
        'sync.resolution': JSON.stringify(resolution),
      });
    }
  }

  /**
   * End tracing for a product sync with success/failure status
   */
  endProductPush(productId: string, success: boolean, metadata?: Record<string, unknown>): void {
    const span = this.syncSpans.get(productId);
    if (span) {
      span.setAttributes({
        'sync.success': success,
        ...metadata,
      });

      if (!success) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
      this.syncSpans.delete(productId);
    }
  }

  /**
   * Track offline queue depth as a metric
   */
  recordQueueDepth(depth: number, pending: number, failed: number): void {
    const span = this.tracer.startSpan('sync.queue_status', {
      attributes: {
        'sync.queue.total': depth,
        'sync.queue.pending': pending,
        'sync.queue.failed': failed,
      },
    });
    span.end();
  }

  /**
   * Track sync health (success/failure rates over time window)
   */
  recordSyncHealth(
    successCount: number,
    failureCount: number,
    avgDuration: number,
    timeWindowMs: number,
  ): void {
    const span = this.tracer.startSpan('sync.health_check', {
      attributes: {
        'sync.success_count': successCount,
        'sync.failure_count': failureCount,
        'sync.avg_duration_ms': avgDuration,
        'sync.time_window_ms': timeWindowMs,
        'sync.success_rate': successCount / (successCount + failureCount) || 0,
      },
    });
    span.end();
  }

  /**
   * Get current trace ID for correlation with audit logs
   */
  getCurrentTraceId(): string | undefined {
    return this.otlpExporter.getCurrentTraceId();
  }

  /**
   * Flush all pending sync spans before shutdown
   */
  async flushSyncSpans(): Promise<void> {
    // End any open product sync spans
    for (const [productId, span] of this.syncSpans.entries()) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Incomplete sync on shutdown' });
      span.end();
    }
    this.syncSpans.clear();

    // Flush OTLP exporter
    await this.otlpExporter.flush();
  }
}
