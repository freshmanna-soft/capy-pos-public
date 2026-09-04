/**
 * What a caller may ask the admin staff-management routes to do, and nothing
 * else — same "narrow to exactly what's forwarded" shape as `validate.ts`.
 */
import type { CreateStaffRequest, AssignRoleRequest } from './admin-http.ts';

/** What a validator returned when it refused the body. */
export interface Rejection {
  readonly error: string;
}

/** Transport cap — an email and a role id, nothing that ever needs to be large. */
export const MAX_BODY_BYTES = 4 * 1024;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCreate(body: unknown): CreateStaffRequest | Rejection {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;

  const email = record['email'];
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
    return { error: 'email must be a valid email address.' };
  }

  const roleId = record['roleId'];
  if (typeof roleId !== 'string' || roleId.trim().length === 0) {
    return { error: 'roleId is required.' };
  }

  return { email: email.trim().toLowerCase(), roleId };
}

export function validateAssignRole(body: unknown): AssignRoleRequest | Rejection {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;

  const roleId = record['roleId'];
  if (typeof roleId !== 'string' || roleId.trim().length === 0) {
    return { error: 'roleId is required.' };
  }

  return { roleId };
}
