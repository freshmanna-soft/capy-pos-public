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
import { Product } from '@core/domain/entities/product.entity';

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
    vi.clearAllMocks();
    mockProductRepository.findAll = vi.fn().mockResolvedValue([]);
    mockProductRepository.findById = vi.fn().mockResolvedValue(null);
    mockProductRepository.findLowStock = vi.fn().mockResolvedValue([]);
    mockProductRepository.updateStock = vi.fn().mockResolvedValue(undefined);
    mockProductRepository.adjustStock = vi.fn().mockResolvedValue(undefined);
    mockTransactionRepository.findAll = vi.fn().mockResolvedValue([]);
    mockTransactionRepository.findById = vi.fn().mockResolvedValue(null);
    mockTransactionRepository.findByDateRange = vi.fn().mockResolvedValue([]);
    mockTransactionRepository.count = vi.fn().mockResolvedValue(0);

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
      expect(agents).toHaveLength(6);
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

  describe('Inventory mutation ordering', () => {
    it('serializes bulk updates so a later write starts only after the prior write settles', async () => {
      const product = new Product('p-1', 'Coffee', 4, 'COF-1', 'Drinks', 10);
      mockProductRepository.findById = vi.fn().mockResolvedValue(product);

      let releaseFirst!: () => void;
      const firstWrite = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      mockProductRepository.updateStock = vi
        .fn()
        .mockImplementationOnce(() => firstWrite)
        .mockResolvedValue(product);

      const operation = inventoryAgent.bulkUpdateStock({
        updates: [
          { productId: 'p-1', quantity: 8 },
          { productId: 'p-1', quantity: 6 },
        ],
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(mockProductRepository.updateStock).toHaveBeenCalledTimes(1);

      releaseFirst();
      const response = await operation;

      expect(response.success).toBe(true);
      expect(mockProductRepository.updateStock).toHaveBeenNthCalledWith(1, 'p-1', 8);
      expect(mockProductRepository.updateStock).toHaveBeenNthCalledWith(2, 'p-1', 6);
    });
  });

  describe('Sales stock mutation ordering', () => {
    it('serializes stock decrements so duplicate product lines cannot race', async () => {
      const product = new Product('p-1', 'Coffee', 4, 'COF-1', 'Drinks', 10);
      mockTransactionRepository.create = vi
        .fn()
        .mockImplementation(async (transaction) => transaction);
      mockTransactionRepository.update = vi
        .fn()
        .mockImplementation(async (_id, transaction) => transaction);

      let releaseFirst!: () => void;
      const firstWrite = new Promise<Product>((resolve) => {
        releaseFirst = () => resolve(product);
      });
      mockProductRepository.adjustStock = vi
        .fn()
        .mockImplementationOnce(() => firstWrite)
        .mockResolvedValue(product);

      const operation = salesAgent.recordSale({
        transactionId: 'sale-1',
        items: [
          { productId: 'p-1', productName: 'Coffee', quantity: 1, unitPrice: 4 },
          { productId: 'p-1', productName: 'Coffee', quantity: 2, unitPrice: 4 },
        ],
        subtotal: 12,
        taxRate: 0,
        paymentIds: [],
      });

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockProductRepository.adjustStock).toHaveBeenCalledTimes(1);

      releaseFirst();
      const response = await operation;

      expect(response.success).toBe(true);
      expect(mockProductRepository.adjustStock).toHaveBeenNthCalledWith(1, 'p-1', -1);
      expect(mockProductRepository.adjustStock).toHaveBeenNthCalledWith(2, 'p-1', -2);
    });
  });

  describe('Health Monitoring', () => {
    it('should get health status of all agents', async () => {
      await registry.initializeAll();
      const healthMap = await registry.getHealthStatus();

      expect(healthMap.size).toBe(6);
      expect([...healthMap.keys()]).toContain('inventory-agent');
      expect([...healthMap.keys()]).toContain('sales-agent');
      expect([...healthMap.keys()]).toContain('payment-agent');
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
      expect(agents).toHaveLength(6);
    });

    it('should find specific agent by name', () => {
      const agents = registry.findAgentsByName('Inventory');
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('Inventory Agent');
    });

    it('should return empty array for no matches', () => {
      const agents = registry.findAgentsByName('NonExistent');
      expect(agents).toHaveLength(0);
    });
  });

  describe('Status Filtering', () => {
    it('should get agents by status', async () => {
      await registry.initializeAll();
      const idleAgents = registry.getAgentsByStatus(AgentStatus.IDLE);
      expect(idleAgents).toHaveLength(6);
    });

    it('should filter processing agents', async () => {
      await registry.initializeAll();
      await registry.startAll();

      const processingAgents = registry.getAgentsByStatus(AgentStatus.PROCESSING);
      expect(processingAgents).toHaveLength(6);
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
