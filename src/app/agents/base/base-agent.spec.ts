import { TestBed } from '@angular/core/testing';
import { BaseAgent } from './base-agent';
import { AgentStatus, IAgentMessage, IAgentResponse } from './base-agent.interface';

/**
 * Mock Agent for Testing
 */
class MockAgent extends BaseAgent {
  public initializeCalled = false;
  public startCalled = false;
  public stopCalled = false;
  public lastMessage?: IAgentMessage;

  constructor() {
    super('mock-agent', 'MockAgent', 'Test agent for unit tests');
  }

  protected async onInitialize(): Promise<void> {
    this.initializeCalled = true;
  }

  protected async onStart(): Promise<void> {
    this.startCalled = true;
  }

  protected async onStop(): Promise<void> {
    this.stopCalled = true;
  }

  protected async handleMessage(message: IAgentMessage): Promise<IAgentResponse> {
    this.lastMessage = message;
    return {
      success: true,
      data: { echo: message.payload },
      metadata: { agentId: this.id }
    };
  }
}

describe('BaseAgent', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent();
  });

  afterEach(async () => {
    if (agent.status !== AgentStatus.IDLE) {
      await agent.stop();
    }
  });

  describe('Initialization', () => {
    it('should create agent with correct properties', () => {
      expect(agent.id).toBe('mock-agent');
      expect(agent.name).toBe('MockAgent');
      expect(agent.description).toBe('Test agent for unit tests');
      expect(agent.status).toBe(AgentStatus.IDLE);
    });

    it('should initialize agent successfully', async () => {
      await agent.initialize();
      expect(agent.initializeCalled).toBe(true);
      expect(agent.status).toBe(AgentStatus.IDLE);
    });

    it('should not initialize twice', async () => {
      await agent.initialize();
      const firstCall = agent.initializeCalled;
      agent.initializeCalled = false;
      await agent.initialize();
      expect(agent.initializeCalled).toBe(false);
    });

    it('should throw error when starting before initialization', async () => {
      try {
        await agent.start();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Lifecycle', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should start agent successfully', async () => {
      await agent.start();
      expect(agent.startCalled).toBe(true);
      expect(agent.status).toBe(AgentStatus.PROCESSING);
    });

    it('should stop agent successfully', async () => {
      await agent.start();
      await agent.stop();
      expect(agent.stopCalled).toBe(true);
      expect(agent.status).toBe(AgentStatus.IDLE);
    });

    it('should not start twice', async () => {
      await agent.start();
      agent.startCalled = false;
      await agent.start();
      expect(agent.startCalled).toBe(false);
    });
  });

  describe('Message Processing', () => {
    beforeEach(async () => {
      await agent.initialize();
      await agent.start();
    });

    it('should process message successfully', async () => {
      const message: IAgentMessage = {
        id: 'msg-1',
        type: 'TEST',
        payload: { data: 'test' },
        timestamp: new Date()
      };

      const response = await agent.processMessage(message);
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ echo: { data: 'test' } });
      expect(agent.lastMessage).toEqual(message);
    });

    it('should validate message structure', async () => {
      const invalidMessage = {
        type: 'TEST',
        payload: {}
      } as any;

      const response = await agent.processMessage(invalidMessage);
      expect(response.success).toBe(false);
      expect(response.error).toContain('id');
    });

    it('should emit message to subscribers', (done: any) => {
      const message: IAgentMessage = {
        id: 'msg-1',
        type: 'TEST',
        payload: {},
        timestamp: new Date()
      };

      agent.subscribe().subscribe((emittedMessage) => {
        expect(emittedMessage).toEqual(message);
        done();
      });

      agent.processMessage(message);
    });

    it('should update status during processing', async () => {
      const message: IAgentMessage = {
        id: 'msg-1',
        type: 'TEST',
        payload: {},
        timestamp: new Date()
      };

      const statusChanges: AgentStatus[] = [];
      agent.status$.subscribe(status => statusChanges.push(status));

      await agent.processMessage(message);
      
      expect(statusChanges).toContain(AgentStatus.PROCESSING);
      expect(statusChanges).toContain(AgentStatus.COMPLETED);
    });
  });

  describe('Health Monitoring', () => {
    it('should report healthy status when initialized', async () => {
      await agent.initialize();
      const health = await agent.getHealth();
      
      expect(health.healthy).toBe(true);
      expect(health.status).toBe(AgentStatus.IDLE);
      expect(health.errorCount).toBe(0);
    });

    it('should report unhealthy when not initialized', async () => {
      const health = await agent.getHealth();
      expect(health.healthy).toBe(false);
    });

    it('should track last activity', async () => {
      await agent.initialize();
      await agent.start();
      
      const message: IAgentMessage = {
        id: 'msg-1',
        type: 'TEST',
        payload: {},
        timestamp: new Date()
      };
      
      await agent.processMessage(message);
      const health = await agent.getHealth();
      
      expect(health.lastActivity).toBeDefined();
    });
  });

  describe('Status Observable', () => {
    it('should emit status changes', (done: any) => {
      const statuses: AgentStatus[] = [];
      
      agent.status$.subscribe(status => {
        statuses.push(status);
        if (statuses.length === 2) {
          expect(statuses[0]).toBe(AgentStatus.IDLE);
          expect(statuses[1]).toBe(AgentStatus.PROCESSING);
          done();
        }
      });

      agent.initialize();
    });
  });
});

// Made with Bob