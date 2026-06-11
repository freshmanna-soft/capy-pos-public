import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
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
    <div class="agent-monitor">
      <!-- Low Stock Alerts Widget -->
      <div class="widget-row" data-testid="dashboard-widgets">
        <app-low-stock-widget></app-low-stock-widget>
      </div>

      <header class="monitor-header">
        <h1>Agent Monitoring Dashboard</h1>
        <div class="header-stats">
          <div class="stat">
            <span class="stat-label">Total Agents</span>
            <span class="stat-value">{{ agents.length }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Running</span>
            <span class="stat-value success">{{ runningAgents }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Messages</span>
            <span class="stat-value">{{ eventBusStats.totalMessages }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Audit Logs</span>
            <span class="stat-value">{{ auditStats.totalLogs }}</span>
          </div>
        </div>
      </header>

      <div class="monitor-grid">
        <!-- Agents Section -->
        <section class="monitor-section agents-section">
          <h2>Agents</h2>
          <div class="agent-list">
            @for (agent of agents; track agent) {
              <div
                class="agent-card"
                [class.running]="agent.isRunning"
                [class.stopped]="!agent.isRunning"
              >
                <div class="agent-header">
                  <h3>{{ agent.name }}</h3>
                  <span class="agent-status" [class.active]="agent.isRunning">
                    {{ agent.state }}
                  </span>
                </div>
                <div class="agent-details">
                  <p><strong>ID:</strong> {{ agent.id }}</p>
                  @if (agent.lastActivity) {
                    <p>
                      <strong>Last Activity:</strong>
                      {{ agent.lastActivity | date: 'short' }}
                    </p>
                  }
                </div>
              </div>
            }
          </div>
        </section>

        <!-- Circuit Breakers Section -->
        <section class="monitor-section circuit-breakers-section">
          <h2>Circuit Breakers</h2>
          <div class="circuit-breaker-list">
            @for (cb of circuitBreakers | keyvalue; track cb) {
              <div
                class="circuit-breaker-card"
                [class.open]="cb.value.state === 'OPEN'"
                [class.half-open]="cb.value.state === 'HALF_OPEN'"
                [class.closed]="cb.value.state === 'CLOSED'"
              >
                <div class="cb-header">
                  <h3>{{ cb.key }}</h3>
                  <span class="cb-state">{{ cb.value.state }}</span>
                </div>
                <div class="cb-stats">
                  <div class="cb-stat">
                    <span>Calls:</span>
                    <span>{{ cb.value.totalCalls }}</span>
                  </div>
                  <div class="cb-stat">
                    <span>Failures:</span>
                    <span class="error">{{ cb.value.totalFailures }}</span>
                  </div>
                  <div class="cb-stat">
                    <span>Successes:</span>
                    <span class="success">{{ cb.value.totalSuccesses }}</span>
                  </div>
                </div>
              </div>
            }
            @if ((circuitBreakers | keyvalue).length === 0) {
              <div class="empty-state">No circuit breakers active</div>
            }
          </div>
        </section>

        <!-- Metrics Section -->
        <section class="monitor-section metrics-section">
          <h2>Metrics</h2>
          <div class="metrics-list">
            @for (metric of metrics | keyvalue; track metric) {
              <div class="metric-card">
                <h3>{{ metric.key }}</h3>
                <div class="metric-stats">
                  <div class="metric-stat">
                    <span>Count:</span>
                    <span>{{ metric.value.count }}</span>
                  </div>
                  <div class="metric-stat">
                    <span>Avg:</span>
                    <span>{{ metric.value.avg | number: '1.2-2' }}</span>
                  </div>
                  <div class="metric-stat">
                    <span>Min:</span>
                    <span>{{ metric.value.min | number: '1.2-2' }}</span>
                  </div>
                  <div class="metric-stat">
                    <span>Max:</span>
                    <span>{{ metric.value.max | number: '1.2-2' }}</span>
                  </div>
                  @if (metric.value.p95) {
                    <div class="metric-stat">
                      <span>P95:</span>
                      <span>{{ metric.value.p95 | number: '1.2-2' }}</span>
                    </div>
                  }
                </div>
              </div>
            }
            @if ((metrics | keyvalue).length === 0) {
              <div class="empty-state">No metrics collected</div>
            }
          </div>
        </section>

        <!-- Recent Audit Logs Section -->
        <section class="monitor-section audit-logs-section">
          <h2>Recent Audit Logs</h2>
          <div class="audit-log-list">
            @for (log of recentAuditLogs; track log) {
              <div
                class="audit-log-entry"
                [class.success]="log.status === 'SUCCESS'"
                [class.failure]="log.status === 'FAILURE'"
              >
                <div class="log-header">
                  <span class="log-action">{{ log.action }}</span>
                  <span class="log-status">{{ log.status }}</span>
                  <span class="log-time">{{ log.timestamp | date: 'short' }}</span>
                </div>
                <div class="log-details">
                  <p><strong>Agent:</strong> {{ log.agentName }}</p>
                  <p><strong>Operation:</strong> {{ log.operation }}</p>
                  <p><strong>Entity:</strong> {{ log.entityType }}:{{ log.entityId }}</p>
                  @if (log.duration) {
                    <p><strong>Duration:</strong> {{ log.duration }}ms</p>
                  }
                  @if (log.errorMessage) {
                    <p class="error-message"><strong>Error:</strong> {{ log.errorMessage }}</p>
                  }
                </div>
              </div>
            }
            @if (recentAuditLogs.length === 0) {
              <div class="empty-state">No audit logs</div>
            }
          </div>
        </section>

        <!-- Event Bus Activity Section -->
        <section class="monitor-section event-bus-section">
          <h2>Event Bus Activity</h2>
          <div class="event-stats">
            <div class="stat-card">
              <h3>By Type</h3>
              <div class="stat-list">
                @for (type of eventBusStats.byType | keyvalue; track type) {
                  <div class="stat-item">
                    <span>{{ type.key }}:</span>
                    <span>{{ type.value }}</span>
                  </div>
                }
              </div>
            </div>
            <div class="stat-card">
              <h3>By Source</h3>
              <div class="stat-list">
                @for (source of eventBusStats.bySource | keyvalue; track source) {
                  <div class="stat-item">
                    <span>{{ source.key }}:</span>
                    <span>{{ source.value }}</span>
                  </div>
                }
              </div>
            </div>
            <div class="stat-card">
              <h3>By Priority</h3>
              <div class="stat-list">
                @for (priority of eventBusStats.byPriority | keyvalue; track priority) {
                  <div class="stat-item">
                    <span>{{ priority.key }}:</span>
                    <span>{{ priority.value }}</span>
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
      .agent-monitor {
        padding: 20px;
        background: #f5f5f5;
        min-height: 100vh;
      }

      .monitor-header {
        background: white;
        padding: 20px;
        border-radius: 8px;
        margin-bottom: 20px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .monitor-header h1 {
        margin: 0 0 20px 0;
        color: #333;
      }

      .header-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 15px;
      }

      .stat {
        display: flex;
        flex-direction: column;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 6px;
      }

      .stat-label {
        font-size: 12px;
        color: #666;
        margin-bottom: 5px;
      }

      .stat-value {
        font-size: 24px;
        font-weight: bold;
        color: #333;
      }

      .stat-value.success {
        color: #28a745;
      }

      .monitor-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
        gap: 20px;
      }

      .monitor-section {
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .monitor-section h2 {
        margin: 0 0 15px 0;
        color: #333;
        font-size: 18px;
        border-bottom: 2px solid #007bff;
        padding-bottom: 10px;
      }

      .agent-card,
      .circuit-breaker-card,
      .metric-card {
        padding: 15px;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        margin-bottom: 10px;
      }

      .agent-card.running {
        border-left: 4px solid #28a745;
      }

      .agent-card.stopped {
        border-left: 4px solid #dc3545;
      }

      .agent-header,
      .cb-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }

      .agent-header h3,
      .cb-header h3,
      .metric-card h3 {
        margin: 0;
        font-size: 16px;
        color: #333;
      }

      .agent-status {
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: bold;
      }

      .agent-status.active {
        background: #d4edda;
        color: #155724;
      }

      .cb-state {
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: bold;
      }

      .circuit-breaker-card.closed {
        border-left: 4px solid #28a745;
      }

      .circuit-breaker-card.closed .cb-state {
        background: #d4edda;
        color: #155724;
      }

      .circuit-breaker-card.open {
        border-left: 4px solid #dc3545;
      }

      .circuit-breaker-card.open .cb-state {
        background: #f8d7da;
        color: #721c24;
      }

      .circuit-breaker-card.half-open {
        border-left: 4px solid #ffc107;
      }

      .circuit-breaker-card.half-open .cb-state {
        background: #fff3cd;
        color: #856404;
      }

      .cb-stats,
      .metric-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        gap: 10px;
        margin-top: 10px;
      }

      .cb-stat,
      .metric-stat {
        display: flex;
        justify-content: space-between;
        padding: 8px;
        background: #f8f9fa;
        border-radius: 4px;
        font-size: 14px;
      }

      .cb-stat .error {
        color: #dc3545;
        font-weight: bold;
      }

      .cb-stat .success {
        color: #28a745;
        font-weight: bold;
      }

      .audit-log-entry {
        padding: 12px;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        margin-bottom: 10px;
      }

      .audit-log-entry.success {
        border-left: 4px solid #28a745;
      }

      .audit-log-entry.failure {
        border-left: 4px solid #dc3545;
      }

      .log-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 14px;
      }

      .log-action {
        font-weight: bold;
        color: #007bff;
      }

      .log-status {
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 12px;
        font-weight: bold;
      }

      .audit-log-entry.success .log-status {
        background: #d4edda;
        color: #155724;
      }

      .audit-log-entry.failure .log-status {
        background: #f8d7da;
        color: #721c24;
      }

      .log-time {
        color: #666;
        font-size: 12px;
      }

      .log-details {
        font-size: 13px;
        color: #666;
      }

      .log-details p {
        margin: 4px 0;
      }

      .error-message {
        color: #dc3545;
      }

      .event-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 15px;
      }

      .stat-card h3 {
        margin: 0 0 10px 0;
        font-size: 14px;
        color: #666;
      }

      .stat-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .stat-item {
        display: flex;
        justify-content: space-between;
        padding: 8px;
        background: #f8f9fa;
        border-radius: 4px;
        font-size: 13px;
      }

      .empty-state {
        text-align: center;
        padding: 40px;
        color: #999;
        font-style: italic;
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

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();

  agents: AgentStatus[] = [];
  runningAgents = 0;
  circuitBreakers: Record<string, CircuitBreakerStats> = {};
  metrics: Record<string, MetricSummary> = {};
  recentAuditLogs: AuditLogEntry[] = [];
  eventBusStats: {
    totalMessages: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    byPriority: Record<string, number>;
  } = {
    totalMessages: 0,
    byType: {},
    bySource: {},
    byPriority: {},
  };
  auditStats: { totalLogs: number } = {
    totalLogs: 0,
  };

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

    this.agents = await Promise.all(agentPromises);
    this.runningAgents = this.agents.filter((a) => a.isRunning).length;
    this.cdr.detectChanges();
  }

  private loadCircuitBreakers(): void {
    this.circuitBreakers = this.circuitBreakerService.getAllStats();
  }

  private loadMetrics(): void {
    this.metrics = this.telemetry.getAllMetricSummaries();
  }

  private async loadAuditLogs(): Promise<void> {
    this.recentAuditLogs = this.auditLog.getRecentLogs(10);
    this.auditStats = await this.auditLog.getStatistics();
    this.cdr.detectChanges();
  }

  private loadEventBusStats(): void {
    this.eventBusStats = this.eventBus.getStatistics();
  }
}

// Made with Bob
