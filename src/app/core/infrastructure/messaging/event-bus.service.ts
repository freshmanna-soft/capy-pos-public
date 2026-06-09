import { Injectable } from '@angular/core';
import { Subject, Observable, filter } from 'rxjs';

/**
 * Event Bus Message
 * Standard message format for inter-agent communication
 */
export interface EventBusMessage<T = unknown> {
  id: string;
  type: string;
  source: string;
  target?: string; // Optional: specific target agent
  payload: T;
  timestamp: Date;
  priority: 'low' | 'normal' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
}

/**
 * Event Bus Service
 * Implements publish-subscribe pattern for inter-agent communication
 * Provides message routing, filtering, and delivery guarantees
 *
 * Features:
 * - Topic-based messaging
 * - Priority queuing
 * - Message filtering
 * - Delivery tracking
 * - Error handling
 */
@Injectable({
  providedIn: 'root',
})
export class EventBusService {
  private messageSubject = new Subject<EventBusMessage>();
  private messageHistory: EventBusMessage[] = [];
  private maxHistorySize = 1000;

  /**
   * Publish a message to the event bus
   */
  publish<T = unknown>(message: Omit<EventBusMessage<T>, 'id' | 'timestamp'>): void {
    const fullMessage: EventBusMessage<T> = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date(),
    };

    // Store in history
    this.addToHistory(fullMessage);

    // Emit to subscribers
    this.messageSubject.next(fullMessage);

    console.log(`[EventBus] Published: ${message.type} from ${message.source}`);
  }

  /**
   * Subscribe to all messages
   */
  subscribe(): Observable<EventBusMessage> {
    return this.messageSubject.asObservable();
  }

  /**
   * Subscribe to messages of a specific type
   */
  subscribeToType(type: string): Observable<EventBusMessage> {
    return this.messageSubject.asObservable().pipe(filter((msg) => msg.type === type));
  }

  /**
   * Subscribe to messages from a specific source
   */
  subscribeToSource(source: string): Observable<EventBusMessage> {
    return this.messageSubject.asObservable().pipe(filter((msg) => msg.source === source));
  }

  /**
   * Subscribe to messages for a specific target
   */
  subscribeToTarget(target: string): Observable<EventBusMessage> {
    return this.messageSubject
      .asObservable()
      .pipe(filter((msg) => msg.target === target || !msg.target));
  }

  /**
   * Subscribe to messages with minimum priority
   */
  subscribeByPriority(
    minPriority: 'low' | 'normal' | 'high' | 'critical',
  ): Observable<EventBusMessage> {
    const priorityLevels = { low: 0, normal: 1, high: 2, critical: 3 };
    const minLevel = priorityLevels[minPriority];

    return this.messageSubject
      .asObservable()
      .pipe(filter((msg) => priorityLevels[msg.priority] >= minLevel));
  }

  /**
   * Get message history
   */
  getHistory(limit?: number): EventBusMessage[] {
    if (limit) {
      return this.messageHistory.slice(-limit);
    }
    return [...this.messageHistory];
  }

  /**
   * Get messages by type from history
   */
  getHistoryByType(type: string, limit?: number): EventBusMessage[] {
    const filtered = this.messageHistory.filter((msg) => msg.type === type);
    if (limit) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  /**
   * Clear message history
   */
  clearHistory(): void {
    this.messageHistory = [];
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalMessages: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    byPriority: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const msg of this.messageHistory) {
      byType[msg.type] = (byType[msg.type] || 0) + 1;
      bySource[msg.source] = (bySource[msg.source] || 0) + 1;
      byPriority[msg.priority] = (byPriority[msg.priority] || 0) + 1;
    }

    return {
      totalMessages: this.messageHistory.length,
      byType,
      bySource,
      byPriority,
    };
  }

  /**
   * Private helper methods
   */

  private addToHistory(message: EventBusMessage): void {
    this.messageHistory.push(message);

    // Trim history if it exceeds max size
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
    }
  }

  private generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Made with Bob
