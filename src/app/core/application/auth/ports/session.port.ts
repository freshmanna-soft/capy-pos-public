import { InjectionToken } from '@angular/core';
import { AuthSessionDto } from '../dtos/auth-session.dto';

/**
 * SessionPort
 *
 * Token/claims read model consumed by route guards and UI components.
 * Provides synchronous access to the current session state.
 */
export interface SessionPort {
  /** Current session or null when not authenticated */
  getSession(): AuthSessionDto | null;

  /** True when a valid, non-expired session exists */
  isAuthenticated(): boolean;

  /** Returns true when the active session includes the given permission */
  hasPermission(permission: string): boolean;

  /** Returns true when the active session includes the given role */
  hasRole(role: string): boolean;
}

export const SESSION_PORT = new InjectionToken<SessionPort>('SESSION_PORT');
