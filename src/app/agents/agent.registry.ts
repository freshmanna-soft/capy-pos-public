import { Injectable, inject } from '@angular/core';
import { AgentStatus } from '@app/agents/base/base-agent.interface';
import { BaseAgent } from '@app/agents/base/base-agent';
import { Observable, merge } from 'rxjs';
import { InventoryAgent } from '@app/agents/inventory/infrastructure/inventory.agent';
import { SalesAgent } from '@app/agents/sales/infrastructure/sales.agent';
import { PaymentAgent } from '@app/agents/payment/infrastructure/payment.agent';
import { AnalyticsAgent } from '@app/agents/analytics/infrastructure/analytics.agent';
import { CustomerAgent } from '@app/agents/customer/infrastructure/customer.agent';
import { IntegrationAgent } from '@app/agents/integration/infrastructure/integration.agent';

/**
 * Agent Registry
 * Centralized management of all agents in the system
 * Provides unified interface for agent lifecycle and communication
 *
 * Features:
 * - Agent registration and discovery
 * - Unified initialization and lifecycle management
 * - Health monitoring
 * - Message routing between agents
 * - Status aggregation
 */
@Injectable({
  providedIn: 'root',
})
export class AgentRegistry {
  private readonly inventoryAgent = inject(InventoryAgent);
  private readonly salesAgent = inject(SalesAgent);
  private readonly paymentAgent = inject(PaymentAgent);
  private readonly analyticsAgent = inject(AnalyticsAgent);
  private readonly customerAgent = inject(CustomerAgent);
  private readonly integrationAgent = inject(IntegrationAgent);

  private readonly agents = new Map<string, BaseAgent>();

  constructor() {
    const inventoryAgent = this.inventoryAgent;
    const salesAgent = this.salesAgent;
    const paymentAgent = this.paymentAgent;
    const analyticsAgent = this.analyticsAgent;
    const customerAgent = this.customerAgent;
    const integrationAgent = this.integrationAgent;

    // Register all agents
    this.registerAgent(inventoryAgent);
    this.registerAgent(salesAgent);
    this.registerAgent(paymentAgent);
    this.registerAgent(analyticsAgent);
    this.registerAgent(customerAgent);
    this.registerAgent(integrationAgent);
  }

  /**
   * Register an agent
   */
  registerAgent(agent: BaseAgent): void {
    if (this.agents.has(agent.id)) {
      console.warn(`Agent ${agent.id} is already registered`);
      return;
    }
    this.agents.set(agent.id, agent);
    console.log(`Registered agent: ${agent.name} (${agent.id})`);
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    console.log(`Unregistered agent: ${agentId}`);
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by status
   */
  getAgentsByStatus(status: AgentStatus): BaseAgent[] {
    return this.getAllAgents().filter((agent) => agent.getStatus() === status);
  }

  /**
   * Initialize all agents
   */
  async initializeAll(): Promise<void> {
    console.log('Initializing all agents...');
    const promises = this.getAllAgents().map((agent) => agent.initialize());
    await Promise.all(promises);
    console.log('All agents initialized');
  }

  /**
   * Start all agents
   */
  async startAll(): Promise<void> {
    console.log('Starting all agents...');
    const promises = this.getAllAgents().map((agent) => agent.start());
    await Promise.all(promises);
    console.log('All agents started');
  }

  /**
   * Stop all agents
   */
  async stopAll(): Promise<void> {
    console.log('Stopping all agents...');
    const promises = this.getAllAgents().map((agent) => agent.stop());
    await Promise.all(promises);
    console.log('All agents stopped');
  }

  /**
   * Get health status of all agents
   */
  async getHealthStatus(): Promise<
    Map<
      string,
      {
        name: string;
        healthy: boolean;
        status: AgentStatus;
        lastActivity?: Date;
        errorCount?: number;
      }
    >
  > {
    const healthMap = new Map<
      string,
      {
        name: string;
        healthy: boolean;
        status: AgentStatus;
        lastActivity?: Date;
        errorCount?: number;
      }
    >();

    for (const agent of this.getAllAgents()) {
      const health = await agent.getHealth();
      healthMap.set(agent.id, {
        name: agent.name,
        ...health,
      });
    }

    return healthMap;
  }

  /**
   * Check if all agents are healthy
   */
  async areAllHealthy(): Promise<boolean> {
    const healthMap = await this.getHealthStatus();
    return Array.from(healthMap.values()).every((health) => health.healthy);
  }

  /**
   * Get combined status observable from all agents
   */
  getCombinedStatus$(): Observable<{ agentId: string; status: AgentStatus }> {
    const statusObservables = this.getAllAgents().map(
      (agent) =>
        new Observable<{ agentId: string; status: AgentStatus }>((observer) => {
          const subscription = agent.status$.subscribe((status: AgentStatus) => {
            observer.next({ agentId: agent.id, status });
          });
          return () => subscription.unsubscribe();
        }),
    );

    return merge(...statusObservables);
  }

  /**
   * Get agent statistics
   */
  getStatistics(): {
    total: number;
    byStatus: Record<AgentStatus, number>;
  } {
    const agents = this.getAllAgents();
    const byStatus: Record<AgentStatus, number> = {
      [AgentStatus.IDLE]: 0,
      [AgentStatus.PROCESSING]: 0,
      [AgentStatus.COMPLETED]: 0,
      [AgentStatus.ERROR]: 0,
    };

    agents.forEach((agent) => {
      const status = agent.getStatus();
      byStatus[status]++;
    });

    return {
      total: agents.length,
      byStatus,
    };
  }

  /**
   * Find agents by name pattern
   */
  findAgentsByName(pattern: string): BaseAgent[] {
    const regex = new RegExp(pattern, 'i');
    return this.getAllAgents().filter((agent) => regex.test(agent.name));
  }
}

// Made with Bob
