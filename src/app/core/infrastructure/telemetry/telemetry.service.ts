import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

/**
 * Metric Type
 */
export enum MetricType {
  COUNTER = 'COUNTER', // Incremental count
  GAUGE = 'GAUGE', // Current value
  HISTOGRAM = 'HISTOGRAM', // Distribution of values
  TIMER = 'TIMER', // Duration measurements
}

/**
 * Metric Data Point
 */
export interface MetricDataPoint {
  name: string;
  type: MetricType;
  value: number;
  timestamp: Date;
  tags?: Record<string, string>;
  unit?: string;
}

/**
 * Metric Summary
 */
export interface MetricSummary {
  name: string;
  type: MetricType;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50?: number; // Median
  p95?: number; // 95th percentile
  p99?: number; // 99th percentile
  lastValue: number;
  lastUpdated: Date;
  tags?: Record<string, string>;
}

/**
 * Telemetry Event
 */
export interface TelemetryEvent {
  name: string;
  timestamp: Date;
  properties?: Record<string, unknown>;
  measurements?: Record<string, number>;
}

/**
 * System Metrics
 */
export interface SystemMetrics {
  timestamp: Date;
  memory?: {
    used: number;
    total: number;
    percentage: number;
  };
  performance?: {
    fps: number;
    responseTime: number;
  };
  errors?: {
    count: number;
    rate: number;
  };
}

/**
 * Telemetry Service
 * Collects and manages application metrics and telemetry data
 *
 * Features:
 * - Multiple metric types (counter, gauge, histogram, timer)
 * - Real-time metric streaming
 * - Metric aggregation and statistics
 * - Event tracking
 * - System metrics monitoring
 * - Performance monitoring
 */
@Injectable({
  providedIn: 'root',
})
export class TelemetryService {
  private readonly metrics = new Map<string, MetricDataPoint[]>();
  private events: TelemetryEvent[] = [];
  private readonly maxDataPoints = 1000;
  private readonly maxEvents = 500;

  private readonly metricsSubject = new Subject<MetricDataPoint>();
  public metrics$: Observable<MetricDataPoint> = this.metricsSubject.asObservable();

  private readonly eventsSubject = new Subject<TelemetryEvent>();
  public events$: Observable<TelemetryEvent> = this.eventsSubject.asObservable();

  private readonly systemMetricsSubject = new Subject<SystemMetrics>();
  public systemMetrics$: Observable<SystemMetrics> = this.systemMetricsSubject.asObservable();

  private monitoringInterval?: ReturnType<typeof setInterval>;

  constructor() {
    this.startSystemMonitoring();
  }

  /**
   * Record a counter metric (incremental)
   */
  recordCounter(name: string, value = 1, tags?: Record<string, string>): void {
    this.recordMetric({
      name,
      type: MetricType.COUNTER,
      value,
      timestamp: new Date(),
      tags,
    });
  }

  /**
   * Record a gauge metric (current value)
   */
  recordGauge(name: string, value: number, tags?: Record<string, string>, unit?: string): void {
    this.recordMetric({
      name,
      type: MetricType.GAUGE,
      value,
      timestamp: new Date(),
      tags,
      unit,
    });
  }

  /**
   * Record a histogram metric (distribution)
   */
  recordHistogram(name: string, value: number, tags?: Record<string, string>, unit?: string): void {
    this.recordMetric({
      name,
      type: MetricType.HISTOGRAM,
      value,
      timestamp: new Date(),
      tags,
      unit,
    });
  }

  /**
   * Start a timer
   */
  startTimer(name: string, tags?: Record<string, string>): () => void {
    const startTime = Date.now();

    return () => {
      const duration = Date.now() - startTime;
      this.recordMetric({
        name,
        type: MetricType.TIMER,
        value: duration,
        timestamp: new Date(),
        tags,
        unit: 'ms',
      });
    };
  }

  /**
   * Measure execution time of a function
   */
  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    tags?: Record<string, string>
  ): Promise<T> {
    const stopTimer = this.startTimer(name, tags);
    try {
      const result = await fn();
      stopTimer();
      return result;
    } catch (error) {
      stopTimer();
      this.recordCounter(`${name}.error`, 1, tags);
      throw error;
    }
  }

  /**
   * Track an event
   */
  trackEvent(
    name: string,
    properties?: Record<string, unknown>,
    measurements?: Record<string, number>
  ): void {
    const event: TelemetryEvent = {
      name,
      timestamp: new Date(),
      properties,
      measurements,
    };

    this.events.push(event);

    // Trim events if exceeds max
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    this.eventsSubject.next(event);
    console.log(`[Telemetry] Event: ${name}`, { properties, measurements });
  }

  /**
   * Get metric summary
   */
  getMetricSummary(name: string, tags?: Record<string, string>): MetricSummary | null {
    const dataPoints = this.getMetricDataPoints(name, tags);
    if (dataPoints.length === 0) return null;

    const values = dataPoints.map((dp) => dp.value);
    const sortedValues = [...values].sort((a, b) => a - b);

    return {
      name,
      type: dataPoints[0].type,
      count: values.length,
      sum: values.reduce((a, b) => a + b, 0),
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      p50: this.percentile(sortedValues, 50),
      p95: this.percentile(sortedValues, 95),
      p99: this.percentile(sortedValues, 99),
      lastValue: values[values.length - 1],
      lastUpdated: dataPoints[dataPoints.length - 1].timestamp,
      tags,
    };
  }

  /**
   * Get all metric summaries
   */
  getAllMetricSummaries(): Record<string, MetricSummary> {
    const summaries: Record<string, MetricSummary> = {};

    this.metrics.forEach((_, name) => {
      const summary = this.getMetricSummary(name);
      if (summary) {
        summaries[name] = summary;
      }
    });

    return summaries;
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit?: number): TelemetryEvent[] {
    if (limit) {
      return this.events.slice(-limit);
    }
    return [...this.events];
  }

  /**
   * Get events by name
   */
  getEventsByName(name: string, limit?: number): TelemetryEvent[] {
    const filtered = this.events.filter((e) => e.name === name);
    if (limit) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  /**
   * Clear all metrics
   */
  clearMetrics(name?: string): void {
    if (name) {
      this.metrics.delete(name);
    } else {
      this.metrics.clear();
    }
  }

  /**
   * Clear all events
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * Get system metrics snapshot
   */
  getSystemMetrics(): SystemMetrics {
    const metrics: SystemMetrics = {
      timestamp: new Date(),
    };

    // Memory metrics (if available - Chrome only)
    const perfWithMemory = performance as unknown as {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    };
    if (perfWithMemory.memory) {
      const memory = perfWithMemory.memory;
      metrics.memory = {
        used: memory.usedJSHeapSize,
        total: memory.totalJSHeapSize,
        percentage: (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100,
      };
    }

    return metrics;
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(): string {
    const data = {
      metrics: this.getAllMetricSummaries(),
      events: this.events,
      systemMetrics: this.getSystemMetrics(),
      exportedAt: new Date(),
    };

    return JSON.stringify(data, null, 2);
  }

  /**
   * Stop system monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  /**
   * Private methods
   */

  private recordMetric(dataPoint: MetricDataPoint): void {
    const key = this.getMetricKey(dataPoint.name, dataPoint.tags);

    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    const dataPoints = this.metrics.get(key)!;
    dataPoints.push(dataPoint);

    // Trim data points if exceeds max
    if (dataPoints.length > this.maxDataPoints) {
      this.metrics.set(key, dataPoints.slice(-this.maxDataPoints));
    }

    this.metricsSubject.next(dataPoint);
  }

  private getMetricDataPoints(name: string, tags?: Record<string, string>): MetricDataPoint[] {
    const key = this.getMetricKey(name, tags);
    return this.metrics.get(key) || [];
  }

  private getMetricKey(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) {
      return name;
    }
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    return `${name}{${tagString}}`;
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  private startSystemMonitoring(): void {
    // Monitor system metrics every 5 seconds
    this.monitoringInterval = setInterval(() => {
      const metrics = this.getSystemMetrics();
      this.systemMetricsSubject.next(metrics);

      // Record as gauge metrics
      if (metrics.memory) {
        this.recordGauge('system.memory.used', metrics.memory.used, undefined, 'bytes');
        this.recordGauge('system.memory.percentage', metrics.memory.percentage, undefined, '%');
      }
    }, 5000);
  }
}

/**
 * Telemetry Decorator
 * Automatically measure method execution time
 */
export function Measure(metricName?: string) {
  return function (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const name =
      metricName ||
      `${(target as { constructor: { name: string } }).constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: unknown[]) {
      const telemetry = new TelemetryService();
      return telemetry.measureAsync(name, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

// Made with Bob
