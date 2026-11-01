// SPDX-License-Identifier: AGPL-3.0-only

import { trpc } from "../provider";
import type { OperationCatalogBody } from "../operations";

/**
 * The one graph-write hook: `operation.invoke`.
 *
 * Components that need the mutation's own state use this; a data-layer write
 * (store update included) belongs in `@workspace/services`.
 */
export const useOperation = () => trpc.operation.invoke.useMutation();

/** The registered operations, for a picker that must not guess an id. */
export const useOperationCatalog = (input: OperationCatalogBody = {}) =>
  trpc.operation.list.useQuery(input);
