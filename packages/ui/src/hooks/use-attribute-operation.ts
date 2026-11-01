// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback, useRef } from "react";
import { useI18n } from "@workspace/ui/lib/i18n";

import { toast } from "@workspace/ui/components/ui/toast";
import {
  runAttributeOperation,
  type AttributeOperationOutcome,
  type AttributeOperationRequest,
} from "@workspace/ui/lib/attribute-operations";
import type { GraphInvokeOptions } from "@workspace/services";

/**
 * Runs one panel edit and reports a refusal with the code the server named.
 *
 * A text control sends one edit per keystroke, so the same refusal must not
 * stack a toast per character: a code is shown once, and the next success lets
 * it be shown again.
 */
export function useAttributeOperation(): (
  request: AttributeOperationRequest,
  options?: GraphInvokeOptions,
) => Promise<AttributeOperationOutcome> {
  const { t } = useI18n();
  const lastFailure = useRef<string | null>(null);

  return useCallback(
    async (request, options) => {
      const outcome = await runAttributeOperation(request, options);
      if (outcome.ok) {
        lastFailure.current = null;
        return outcome;
      }
      if (lastFailure.current !== outcome.code) {
        lastFailure.current = outcome.code;
        toast({
          title: t("保存失败，请稍后重试"),
          description: outcome.code,
          variant: "destructive",
        });
      }
      return outcome;
    },
    [t],
  );
}
