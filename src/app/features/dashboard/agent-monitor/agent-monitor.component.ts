import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil, interval } from 'rxjs';
import { AgentRegistry } from '@app/agents/agent.registry';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { AuditLogService, AuditLogEntry } from '@core/infrastructure/audit/audit-log.service';
import {
  CircuitBreakerService,
  CircuitBreakerStats,
} from '@core/infrastructure/resilience/circuit-breaker.service';
import { TelemetryService, MetricSummary } from '@core/infrastructure/telemetry/telemetry.service';
import { LowStockWidgetComponent } from '../low-stock-widget/low-stock-widget.component';

interface AgentStatus {
  id: string;
  name: string;
  state: string;
  isRunning: boolean;
  lastActivity?: Date;
}

/**
 * Agent Monitor Component
 * Real-time dashboard for monitoring agent health, metrics, and activity
 */
@Component({
  selector: 'app-agent-monitor',
  standalone: true,
  imports: [CommonModule, LowStockWidgetComponent],
  template: `
    <div class="p-4 md:p-6 bg-gray-100 min-h-screen">
      <!-- Low Stock Alerts Widget -->
      <div class="mb-4" data-testid="dashboard-widgets">
        <app-low-stock-widget></app-low-stock-widget>
      </div>

      <!-- Header -->
      <header class="bg-white p-4 md:p-5 rounded-lg shadow-sm mb-4 md:mb-6">
        <h1 class="text-xl md:text-2xl font-bold text-gray-900 mb-4">Agent Monitoring Dashboard</h1>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="flex flex-col p-3 bg-gray-50 rounded-lg">
            <span class="text-xs text-gray-500 mb-1">Total Agents</span>
            <span class="text-xl md:text-2xl font-bold text-gray-900">{{ agents().length }}</span>
          </div>
          <div class="flex flex-col p-3 bg-gray-50 rounded-lg">
            <span class="text-xs text-gray-500 mb-1">Running</span>
            <span class="text-xl md:text-2xl font-bold text-green-600">{{ runningAgents() }}</span>
          </div>
          <div class="flex flex-col p-3 bg-gray-50 rounded-lg">
            <span class="text-xs text-gray-500 mb-1">Messages</span>
            <span class="text-xl md:text-2xl font-bold text-gray-900">{{
              eventBusStats().totalMessages
            }}</span>
          </div>
          <div class="flex flex-col p-3 bg-gray-50 rounded-lg">
            <span class="text-xs text-gray-500 mb-1">Audit Logs</span>
            <span class="text-xl md:text-2xl font-bold text-gray-900">{{
              auditStats().totalLogs
            }}</span>
          </div>
        </div>
      </header>

      <!-- Grid of sections -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <!-- Agents Section -->
        <section class="bg-white p-4 rounded-lg shadow-sm">
          <h2
            class="text-base md:text-lg font-semibold text-gray-900 mb-3 pb-2 border-b-2 border-blue-500"
          >
            Agents
          </h2>
          <div class="space-y-2">
            @for (agent of agents(); track agent) {
              <div
                class="p-3 border rounded-lg"
                [class]="
                  agent.isRunning
                    ? 'border-l-4 border-l-green-500 border-gray-200'
                    : 'border-l-4 border-l-red-500 border-gray-200'
                "
              >
                <div class="flex justify-between items-center mb-1">
                  <h3 class="text-sm font-semibold text-gray-900">{{ agent.name }}</h3>
                  <span
                    class="px-2 py-0.5 rounded text-xs font-bold"
                    [class]="
                      agent.isRunning ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    "
                  >
                    {{ agent.state }}
                  </span>
                </div>
                <p class="text-xs text-gray-500">ID: {{ agent.id }}</p>
                @if (agent.lastActivity) {
                  <p class="text-xs text-gray-500">
                    Last: {{ agent.lastActivity | date: 'short' }}
                  </p>
                }
              </div>
            }
          </div>
        </section>

        <!-- Circuit Breakers Section -->
        <section class="bg-white p-4 rounded-lg shadow-sm">
          <h2
            class="text-base md:text-lg font-semibold text-gray-900 mb-3 pb-2 border-b-2 border-blue-500"
          >
            Circuit Breakers
          </h2>
          <div class="space-y-2">
            @for (cb of circuitBreakers() | keyvalue; track cb) {
              <div
                class="p-3 border rounded-lg border-l-4"
                [class]="
                  cb.value.state === 'OPEN'
                    ? 'border-l-red-500'
                    : cb.value.state === 'HALF_OPEN'
                      ? 'border-l-yellow-500'
                      : 'border-l-green-500'
                "
              >
                <div class="flex justify-between items-center mb-2">
                  <h3 class="text-sm font-semibold text-gray-900 truncate">{{ cb.key }}</h3>
                  <span
                    class="px-2 py-0.5 rounded text-xs font-bold shrink-0"
                    [class]="
                      cb.value.state === 'OPEN'
                        ? 'bg-red-100 text-red-800'
                        : cb.value.state === 'HALF_OPEN'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-green-100 text-green-800'
                    "
                  >
                    {{ cb.value.state }}
                  </span>
                </div>
                <div class="grid grid-cols-3 gap-2">
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span>Calls</span>
                    <span class="font-semibold">{{ cb.value.totalCalls }}</span>
                  </div>
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span>Fail</span>
                    <span class="font-bold text-red-600">{{ cb.value.totalFailures }}</span>
                  </div>
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span>OK</span>
                    <span class="font-bold text-green-600">{{ cb.value.totalSuccesses }}</span>
                  </div>
                </div>
              </div>
            }
            @if ((circuitBreakers() | keyvalue).length === 0) {
              <div class="text-center py-8 text-gray-400 italic">No circuit breakers active</div>
            }
          </div>
        </section>

        <!-- Metrics Section -->
        <section class="bg-white p-4 rounded-lg shadow-sm">
          <h2
            class="text-base md:text-lg font-semibold text-gray-900 mb-3 pb-2 border-b-2 border-blue-500"
          >
            Metrics
          </h2>
          <div class="space-y-2">
            @for (metric of metrics() | keyvalue; track metric) {
              <div class="p-3 border border-gray-200 rounded-lg">
                <h3 class="text-sm font-semibold text-gray-900 mb-2 truncate">{{ metric.key }}</h3>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span>Count</span>
                    <span class="font-semibold">{{ metric.value.count }}</span>
                  </div>
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span>Avg</span>
                    <span class="font-semibold">{{ metric.value.avg | number: '1.2-2' }}</span>
                  </div>
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span>Min</span>
                    <span class="font-semibold">{{ metric.value.min | number: '1.2-2' }}</span>
                  </div>
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span>Max</span>
                    <span class="font-semibold">{{ metric.value.max | number: '1.2-2' }}</span>
                  </div>
                  @if (metric.value.p95) {
                    <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                      <span>P95</span>
                      <span class="font-semibold">{{ metric.value.p95 | number: '1.2-2' }}</span>
                    </div>
                  }
                </div>
              </div>
            }
            @if ((metrics() | keyvalue).length === 0) {
              <div class="text-center py-8 text-gray-400 italic">No metrics collected</div>
            }
          </div>
        </section>

        <!-- Recent Audit Logs Section -->
        <section class="bg-white p-4 rounded-lg shadow-sm">
          <h2
            class="text-base md:text-lg font-semibold text-gray-900 mb-3 pb-2 border-b-2 border-blue-500"
          >
            Recent Audit Logs
          </h2>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            @for (log of recentAuditLogs(); track log) {
              <div
                class="p-3 border rounded-lg border-l-4"
                [class]="log.status === 'SUCCESS' ? 'border-l-green-500' : 'border-l-red-500'"
              >
                <div class="flex flex-wrap justify-between items-center gap-1 mb-1">
                  <span class="text-xs font-bold text-blue-600">{{ log.action }}</span>
                  <span
                    class="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    [class]="
                      log.status === 'SUCCESS'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    "
                  >
                    {{ log.status }}
                  </span>
                  <span class="text-[10px] text-gray-400">{{ log.timestamp | date: 'short' }}</span>
                </div>
                <div class="text-xs text-gray-600 space-y-0.5">
                  <p><span class="font-medium">Agent:</span> {{ log.agentName }}</p>
                  <p><span class="font-medium">Op:</span> {{ log.operation }}</p>
                  <p>
                    <span class="font-medium">Entity:</span> {{ log.entityType }}:{{ log.entityId }}
                  </p>
                  @if (log.duration) {
                    <p><span class="font-medium">Duration:</span> {{ log.duration }}ms</p>
                  }
                  @if (log.errorMessage) {
                    <p class="text-red-600">
                      <span class="font-medium">Error:</span> {{ log.errorMessage }}
                    </p>
                  }
                </div>
              </div>
            }
            @if (recentAuditLogs().length === 0) {
              <div class="text-center py-8 text-gray-400 italic">No audit logs</div>
            }
          </div>
        </section>

        <!-- Event Bus Activity Section -->
        <section class="bg-white p-4 rounded-lg shadow-sm lg:col-span-2">
          <h2
            class="text-base md:text-lg font-semibold text-gray-900 mb-3 pb-2 border-b-2 border-blue-500"
          >
            Event Bus Activity
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <h3 class="text-xs font-medium text-gray-500 mb-2">By Type</h3>
              <div class="space-y-1">
                @for (type of eventBusStats().byType | keyvalue; track type) {
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span class="truncate">{{ type.key }}</span>
                    <span class="font-semibold shrink-0 ml-2">{{ type.value }}</span>
                  </div>
                }
              </div>
            </div>
            <div>
              <h3 class="text-xs font-medium text-gray-500 mb-2">By Source</h3>
              <div class="space-y-1">
                @for (source of eventBusStats().bySource | keyvalue; track source) {
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span class="truncate">{{ source.key }}</span>
                    <span class="font-semibold shrink-0 ml-2">{{ source.value }}</span>
                  </div>
                }
              </div>
            </div>
            <div>
              <h3 class="text-xs font-medium text-gray-500 mb-2">By Priority</h3>
              <div class="space-y-1">
                @for (priority of eventBusStats().byPriority | keyvalue; track priority) {
                  <div class="flex justify-between p-2 bg-gray-50 rounded text-xs">
                    <span class="truncate">{{ priority.key }}</span>
                    <span class="font-semibold shrink-0 ml-2">{{ priority.value }}</span>
                  </div>
                }
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class AgentMonitorComponent implements OnInit, OnDestroy {
  private readonly agentRegistry = inject(AgentRegistry);
  private readonly eventBus = inject(EventBusService);
  private readonly auditLog = inject(AuditLogService);
  private readonly circuitBreakerService = inject(CircuitBreakerService);
  private readonly telemetry = inject(TelemetryService);

  private readonly destroy$ = new Subject<void>();

  agents = signal<AgentStatus[]>([]);
  runningAgents = signal(0);
  circuitBreakers = signal<Record<string, CircuitBreakerStats>>({});
  metrics = signal<Record<string, MetricSummary>>({});
  recentAuditLogs = signal<AuditLogEntry[]>([]);
  eventBusStats = signal<{
    totalMessages: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    byPriority: Record<string, number>;
  }>({
    totalMessages: 0,
    byType: {},
    bySource: {},
    byPriority: {},
  });
  auditStats = signal<{ totalLogs: number }>({
    totalLogs: 0,
  });

  ngOnInit(): void {
    this.loadAgentStatus();
    this.loadCircuitBreakers();
    this.loadMetrics();
    this.loadAuditLogs();
    this.loadEventBusStats();

    // Refresh data every 5 seconds
    interval(5000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadAgentStatus();
        this.loadCircuitBreakers();
        this.loadMetrics();
        this.loadAuditLogs();
        this.loadEventBusStats();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadAgentStatus(): Promise<void> {
    const allAgents = this.agentRegistry.getAllAgents();

    const agentPromises = allAgents.map(async (agent) => {
      const health = await agent.getHealth();
      const status = agent.getStatus();
      return {
        id: agent.id,
        name: agent.name,
        state: status,
        isRunning: health.healthy,
        lastActivity: health.lastActivity,
      };
    });

    const results = await Promise.all(agentPromises);
    this.agents.set(results);
    this.runningAgents.set(results.filter((a) => a.isRunning).length);
  }

  private loadCircuitBreakers(): void {
    this.circuitBreakers.set(this.circuitBreakerService.getAllStats());
  }

  private loadMetrics(): void {
    this.metrics.set(this.telemetry.getAllMetricSummaries());
  }

  private async loadAuditLogs(): Promise<void> {
    this.recentAuditLogs.set(this.auditLog.getRecentLogs(10));
    this.auditStats.set(await this.auditLog.getStatistics());
  }

  private loadEventBusStats(): void {
    this.eventBusStats.set(this.eventBus.getStatistics());
  }
}

// Made with Bob
