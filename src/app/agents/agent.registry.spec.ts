import { TestBed } from '@angular/core/testing';
import { AgentRegistry } from '@app/agents/agent.registry';
import { AgentStatus } from '@app/agents/base/base-agent.interface';
import { InventoryAgent } from '@app/agents/inventory/infrastructure/inventory.agent';
import { SalesAgent } from '@app/agents/sales/infrastructure/sales.agent';
import { PaymentAgent } from '@app/agents/payment/infrastructure/payment.agent';
import { AnalyticsAgent } from '@app/agents/analytics/infrastructure/analytics.agent';
import { CustomerAgent } from '@app/agents/customer/infrastructure/customer.agent';
import { IntegrationAgent } from '@app/agents/integration/infrastructure/integration.agent';
import { IProductRepository } from '@core/domain/interfaces/product.repository.interface';
import { ITransactionRepository } from '@core/domain/interfaces/transaction.repository.interface';
import { IPaymentRepository } from '@core/domain/interfaces/payment.repository.interface';
import {
  PAYMENT_REPOSITORY,
  PRODUCT_REPOSITORY,
  TRANSACTION_REPOSITORY,
} from '@core/infrastructure/factories/repository.factory';
import { PRODUCT_REPOSITORY_TOKEN } from '@app/agents/inventory/infrastructure/inventory.agent';
import { AuditLogService } from '@core/infrastructure/audit/audit-log.service';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';

// Mock repositories
const mockProductRepository: Partial<IProductRepository> = {
  findAll: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue(null),
  findLowStock: vi.fn().mockResolvedValue([]),
  updateStock: vi.fn().mockResolvedValue(undefined),
  adjustStock: vi.fn().mockResolvedValue(undefined),
};

const mockTransactionRepository: Partial<ITransactionRepository> = {
  findAll: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue(null),
  findByDateRange: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
};

const mockPaymentRepository: Partial<IPaymentRepository> = {
  findAll: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue(null),
  findByTransactionId: vi.fn().mockResolvedValue([]),
};

describe('AgentRegistry', () => {
  let registry: AgentRegistry;
  let inventoryAgent: InventoryAgent;
  let salesAgent: SalesAgent;
  let paymentAgent: PaymentAgent;
  let analyticsAgent: AnalyticsAgent;
  let customerAgent: CustomerAgent;
  let integrationAgent: IntegrationAgent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuditLogService,
        EventBusService,
        // Provide mock repositories with InjectionTokens
        {
          provide: PRODUCT_REPOSITORY_TOKEN,
          useValue: mockProductRepository,
        },
        {
          provide: PRODUCT_REPOSITORY,
          useValue: mockProductRepository,
        },
        {
          provide: TRANSACTION_REPOSITORY,
          useValue: mockTransactionRepository,
        },
        {
          provide: PAYMENT_REPOSITORY,
          useValue: mockPaymentRepository,
        },
        // Provide agents explicitly
        InventoryAgent,
        SalesAgent,
        PaymentAgent,
        AnalyticsAgent,
        CustomerAgent,
        IntegrationAgent,
        AgentRegistry,
      ],
    });

    registry = TestBed.inject(AgentRegistry);
    inventoryAgent = TestBed.inject(InventoryAgent);
    salesAgent = TestBed.inject(SalesAgent);
    paymentAgent = TestBed.inject(PaymentAgent);
    analyticsAgent = TestBed.inject(AnalyticsAgent);
    customerAgent = TestBed.inject(CustomerAgent);
    integrationAgent = TestBed.inject(IntegrationAgent);
  });

  afterEach(async () => {
    if (registry) {
      await registry.stopAll();
    }
  });

  describe('Agent Registration', () => {
    it('should register all agents on construction', () => {
      const agents = registry.getAllAgents();
      expect(agents.length).toBe(6);
    });

    it('should get agent by ID', () => {
      const agent = registry.getAgent('inventory-agent');
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('Inventory Agent');
    });

    it('should return undefined for non-existent agent', () => {
      const agent = registry.getAgent('non-existent');
      expect(agent).toBeUndefined();
    });

    it('should get all agents', () => {
      const agents = registry.getAllAgents();
      expect(agents).toContain(inventoryAgent);
      expect(agents).toContain(salesAgent);
      expect(agents).toContain(paymentAgent);
      expect(agents).toContain(analyticsAgent);
      expect(agents).toContain(customerAgent);
      expect(agents).toContain(integrationAgent);
    });
  });

  describe('Lifecycle Management', () => {
    it('should initialize all agents', async () => {
      await registry.initializeAll();

      const agents = registry.getAllAgents();
      for (const agent of agents) {
        const health = await agent.getHealth();
        expect(health.healthy).toBe(true);
      }
    });

    it('should start all agents', async () => {
      await registry.initializeAll();
      await registry.startAll();

      const agents = registry.getAllAgents();
      for (const agent of agents) {
        expect(agent.getStatus()).toBe(AgentStatus.PROCESSING);
      }
    });

    it('should stop all agents', async () => {
      await registry.initializeAll();
      await registry.startAll();
      await registry.stopAll();

      const agents = registry.getAllAgents();
      for (const agent of agents) {
        expect(agent.getStatus()).toBe(AgentStatus.IDLE);
      }
    });
  });

  describe('Health Monitoring', () => {
    it('should get health status of all agents', async () => {
      await registry.initializeAll();
      const healthMap = await registry.getHealthStatus();

      expect(healthMap.size).toBe(6);
      expect(healthMap.has('inventory-agent')).toBe(true);
      expect(healthMap.has('sales-agent')).toBe(true);
      expect(healthMap.has('payment-agent')).toBe(true);
    });

    it('should check if all agents are healthy', async () => {
      await registry.initializeAll();
      const allHealthy = await registry.areAllHealthy();
      expect(allHealthy).toBe(true);
    });

    it('should report unhealthy when agents not initialized', async () => {
      const allHealthy = await registry.areAllHealthy();
      expect(allHealthy).toBe(false);
    });
  });

  describe('Agent Statistics', () => {
    it('should get agent statistics', async () => {
      await registry.initializeAll();
      const stats = registry.getStatistics();

      expect(stats.total).toBe(6);
      expect(stats.byStatus[AgentStatus.IDLE]).toBe(6);
    });

    it('should update statistics after starting agents', async () => {
      await registry.initializeAll();
      await registry.startAll();

      const stats = registry.getStatistics();
      expect(stats.byStatus[AgentStatus.PROCESSING]).toBe(6);
    });
  });

  describe('Agent Discovery', () => {
    it('should find agents by name pattern', () => {
      const agents = registry.findAgentsByName('Agent');
      expect(agents.length).toBe(6);
    });

    it('should find specific agent by name', () => {
      const agents = registry.findAgentsByName('Inventory');
      expect(agents.length).toBe(1);
      expect(agents[0].name).toBe('Inventory Agent');
    });

    it('should return empty array for no matches', () => {
      const agents = registry.findAgentsByName('NonExistent');
      expect(agents.length).toBe(0);
    });
  });

  describe('Status Filtering', () => {
    it('should get agents by status', async () => {
      await registry.initializeAll();
      const idleAgents = registry.getAgentsByStatus(AgentStatus.IDLE);
      expect(idleAgents.length).toBe(6);
    });

    it('should filter processing agents', async () => {
      await registry.initializeAll();
      await registry.startAll();

      const processingAgents = registry.getAgentsByStatus(AgentStatus.PROCESSING);
      expect(processingAgents.length).toBe(6);
    });
  });

  describe('Combined Status Observable', () => {
    it('should emit status changes from all agents', async () => {
      const statusChanges: { agentId: string; status: AgentStatus }[] = [];

      const statusPromise = new Promise<void>((resolve) => {
        registry.getCombinedStatus$().subscribe((change) => {
          statusChanges.push(change);

          // Wait for some status changes
          if (statusChanges.length >= 6) {
            resolve();
          }
        });
      });

      registry.initializeAll();
      await statusPromise;
      expect(statusChanges.length).toBeGreaterThanOrEqual(6);
    });
  });
});

// Made with Bob
