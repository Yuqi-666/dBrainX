// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain Repository Interfaces (Ports)
 *
 * These interfaces define the contract for data access.
 * Implementations (Adapters) reside in the infrastructure layer.
 *
 * Following DDD conventions:
 * - Repository interfaces are defined in the domain layer (ports)
 * - Repository implementations are in the infrastructure layer (adapters)
 * - All methods return domain entities or value objects
 * - Query objects are plain objects for flexibility
 *
 * One file per aggregate: `<aggregate>.repository.ts`.
 */

export * from "./dashboard.repository";
export * from "./edge.repository";
export * from "./node.repository";
export * from "./semantic.repository";
export * from "./user.repository";
export * from "./view.repository";
export * from "./workspace.repository";
