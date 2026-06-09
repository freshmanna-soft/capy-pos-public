import { Observable } from 'rxjs';

/**
 * Agent Status Enum
 * Represents the current state of an agent
 */
export enum AgentStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  ERROR = 'ERROR',
  COMPLETED = 'COMPLETED',
}

/**
 * Agent Message Interface
 * Represents a message that can be sent to or from an agent
 */
export interface IAgentMessage {
  id: string;
  type: string;
  payload: unknown;
  timestamp: Date;
  source?: string;
  target?: string;
}

/**
 * Agent Response Interface
 * Represents the response from an agent
 */
export interface IAgentResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Base Agent Interface
 * Defines the contract for all agents in the system
 * Agents are autonomous components that handle specific business domains
 *
 * Following the Agent Pattern for distributed, autonomous processing
 */
export interface IBaseAgent {
  /**
   * Agent unique identifier
   */
  readonly id: string;

  /**
   * Agent name
   */
  readonly name: string;

  /**
   * Agent description
   */
  readonly description: string;

  /**
   * Current agent status
   */
  readonly status: AgentStatus;

  /**
   * Initialize the agent
   * Called when the agent is first created
   */
  initialize(): Promise<void>;

  /**
   * Start the agent
   * Begin processing messages and tasks
   */
  start(): Promise<void>;

  /**
   * Stop the agent
   * Gracefully shutdown and cleanup resources
   */
  stop(): Promise<void>;

  /**
   * Process a message
   * Main entry point for agent communication
   */
  processMessage(message: IAgentMessage): Promise<IAgentResponse>;

  /**
   * Get agent status
   */
  getStatus(): AgentStatus;

  /**
   * Get agent health information
   */
  getHealth(): Promise<{
    healthy: boolean;
    status: AgentStatus;
    lastActivity?: Date;
    errorCount?: number;
  }>;

  /**
   * Subscribe to agent events
   * Returns an observable stream of agent messages
   */
  subscribe(): Observable<IAgentMessage>;
}

// Made with Bob
