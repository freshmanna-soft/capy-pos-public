/**
 * Facade Layer - Public API
 *
 * Facades provide a single point of access between feature components
 * and the application layer (use-cases/services).
 *
 * They orchestrate but contain NO business logic.
 * They coexist with the Agent system:
 * - Facades: synchronous UI orchestration
 * - Agents: async background processing
 */
export { PosFacade } from './pos.facade';
export { InventoryFacade } from './inventory.facade';
export { CustomerFacade } from './customer.facade';
export {
  ClerkFacade,
  AUTO_ADD_CONFIDENCE,
  CONSIDER_CONFIDENCE,
  UNDO_WINDOW_MS,
} from './clerk.facade';
export type { ClerkPhase, PendingAdd, CandidateCard } from './clerk.facade';
