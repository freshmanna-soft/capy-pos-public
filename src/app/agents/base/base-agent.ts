import { Observable, Subject, BehaviorSubject } from 'rxjs';
import {
  IBaseAgent,
  AgentStatus,
  IAgentMessage,
  IAgentResponse,
} from '@app/agents/base/base-agent.interface';

/**
 * Base Agent Abstract Class
 * Implements common agent functionality
 * Follows Template Method Pattern for agent lifecycle
 *
 * Concrete agents extend this class and implement:
 * - onInitialize(): Custom initialization logic
 * - onStart(): Custom start logic
 * - onStop(): Custom stop logic
 * - handleMessage(): Message processing logic
 */
export abstract class BaseAgent implements IBaseAgent {
  private readonly _status$ = new BehaviorSubject<AgentStatus>(AgentStatus.IDLE);
  private readonly _messages$ = new Subject<IAgentMessage>();
  private _lastActivity?: Date;
  private _errorCount = 0;
  private _isInitialized = false;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string,
  ) {}

  /**
   * Get current agent status
   */
  get status(): AgentStatus {
    return this._status$.value;
  }

  /**
   * Get agent status as observable
   */
  get status$(): Observable<AgentStatus> {
    return this._status$.asObservable();
  }

  /**
   * Initialize the agent
   * Template method that calls onInitialize hook
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      console.warn(`Agent ${this.name} is already initialized`);
      return;
    }

    try {
      this._status$.next(AgentStatus.PROCESSING);
      await this.onInitialize();
      this._isInitialized = true;
      this._status$.next(AgentStatus.IDLE);
      this._lastActivity = new Date();
      console.log(`Agent ${this.name} initialized successfully`);
    } catch (error) {
      this._errorCount++;
      this._status$.next(AgentStatus.ERROR);
      console.error(`Failed to initialize agent ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Start the agent
   * Template method that calls onStart hook
   */
  async start(): Promise<void> {
    if (!this._isInitialized) {
      throw new Error(`Agent ${this.name} must be initialized before starting`);
    }

    if (this.status === AgentStatus.PROCESSING) {
      console.warn(`Agent ${this.name} is already running`);
      return;
    }

    try {
      this._status$.next(AgentStatus.PROCESSING);
      await this.onStart();
      this._lastActivity = new Date();
      console.log(`Agent ${this.name} started successfully`);
    } catch (error) {
      this._errorCount++;
      this._status$.next(AgentStatus.ERROR);
      console.error(`Failed to start agent ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Stop the agent
   * Template method that calls onStop hook
   */
  async stop(): Promise<void> {
    try {
      await this.onStop();
      this._status$.next(AgentStatus.IDLE);
      this._lastActivity = new Date();
      console.log(`Agent ${this.name} stopped successfully`);
    } catch (error) {
      this._errorCount++;
      this._status$.next(AgentStatus.ERROR);
      console.error(`Failed to stop agent ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Process a message
   * Template method that calls handleMessage hook
   */
  async processMessage(message: IAgentMessage): Promise<IAgentResponse> {
    const previousStatus = this.status;

    try {
      this._status$.next(AgentStatus.PROCESSING);
      this._lastActivity = new Date();

      // Validate message
      this.validateMessage(message);

      // Process message
      const response = await this.handleMessage(message);

      // Emit message to subscribers
      this._messages$.next(message);

      // Update status
      this._status$.next(AgentStatus.COMPLETED);

      // Return to previous status after a brief moment
      setTimeout(() => {
        if (this.status === AgentStatus.COMPLETED) {
          this._status$.next(previousStatus);
        }
      }, 100);

      return response;
    } catch (error) {
      this._errorCount++;
      this._status$.next(AgentStatus.ERROR);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Agent ${this.name} failed to process message:`, error);

      return {
        success: false,
        error: errorMessage,
        metadata: {
          agentId: this.id,
          agentName: this.name,
          messageId: message.id,
          timestamp: new Date(),
        },
      };
    }
  }

  /**
   * Get agent status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get agent health information
   */
  async getHealth(): Promise<{
    healthy: boolean;
    status: AgentStatus;
    lastActivity?: Date;
    errorCount?: number;
  }> {
    return {
      healthy: this.status !== AgentStatus.ERROR && this._isInitialized,
      status: this.status,
      lastActivity: this._lastActivity,
      errorCount: this._errorCount,
    };
  }

  /**
   * Subscribe to agent messages
   */
  subscribe(): Observable<IAgentMessage> {
    return this._messages$.asObservable();
  }

  /**
   * Validate message structure
   * Can be overridden by concrete agents
   */
  protected validateMessage(message: IAgentMessage): void {
    if (!message.id) {
      throw new Error('Message must have an id');
    }
    if (!message.type) {
      throw new Error('Message must have a type');
    }
    if (!message.timestamp) {
      throw new Error('Message must have a timestamp');
    }
  }

  /**
   * Emit a message to subscribers
   * Useful for agents to communicate with each other
   */
  protected emitMessage(message: IAgentMessage): void {
    this._messages$.next(message);
  }

  /**
   * Reset error count
   * Useful after recovering from errors
   */
  protected resetErrorCount(): void {
    this._errorCount = 0;
  }

  /**
   * Hook: Called during initialization
   * Override in concrete agents for custom initialization
   */
  protected abstract onInitialize(): Promise<void>;

  /**
   * Hook: Called when agent starts
   * Override in concrete agents for custom start logic
   */
  protected abstract onStart(): Promise<void>;

  /**
   * Hook: Called when agent stops
   * Override in concrete agents for custom stop logic
   */
  protected abstract onStop(): Promise<void>;

  /**
   * Hook: Called to handle incoming messages
   * Override in concrete agents to implement message processing
   */
  protected abstract handleMessage(message: IAgentMessage): Promise<IAgentResponse>;
}

// Made with Bob
