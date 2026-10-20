// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The chart surface — the one place the VChart runtime is reached.
 *
 * It is `memo`-wrapped and keyed by the shell on the chart's *structure*, so a
 * data change updates the live instance while a type / encoding change remounts
 * it: morphing a treemap into a sankey in place is not something the library
 * promises, and there is no canvas state worth preserving across that switch.
 *
 * The component renders nothing but the library's own container, which sizes
 * itself to its parent (`100%` × `100%`) — the shell gives it an `absolute
 * inset-0` box inside the pane, so a chart can never resize the pane it lives
 * in (dataview/AGENTS.md — the renderer box must not scroll).
 */
import { memo } from "react";
import { VChart } from "@visactor/react-vchart";
import { VChart as VChartCore, registerLiquidChart } from "@visactor/vchart";
import type { ISpec, IVChart } from "@visactor/vchart";

import type { ChartSpec } from "../core/spec";

/**
 * 水波图 is the one catalogue entry the library's umbrella build forgets.
 *
 * `@visactor/vchart`'s main entry registers every chart type except `liquid`
 * (only react-vchart's dedicated `<LiquidChart>` does that), and without it the
 * constructor throws `init chart fail`. Registering it once here — in the module
 * the lazy renderer pulls in — keeps 水波图 working without switching this view
 * off the universal `<VChart spec>` component.
 *
 * `useRegisters` is a static factory call despite its name; aliasing it keeps
 * the React-hooks lint rule from reading it as a hook invoked at module scope.
 */
const registerChartTypes = VChartCore.useRegisters.bind(VChartCore);
registerChartTypes([registerLiquidChart]);

export interface ChartSurfaceProps {
  spec: ChartSpec;
  /** The live instance, so the toolbar's 导出图片 can call `exportImg`. */
  onReady: (instance: IVChart) => void;
  /** A click that landed on a mark, with the datum behind it. */
  onClickDatum: (datum: Record<string, unknown>) => void;
  className?: string;
}

export const ChartSurface = memo(function ChartSurface({
  spec,
  onReady,
  onClickDatum,
  className,
}: ChartSurfaceProps) {
  return (
    <VChart
      className={className}
      // The spec is assembled data, not a typed literal: every branch of
      // `buildChartSpec` writes keys that belong to one library type.
      spec={spec as unknown as ISpec}
      onReady={(instance) => onReady(instance)}
      onClick={(params) => {
        const datum = params?.datum as Record<string, unknown> | undefined;
        // Axis labels, blank canvas and legend items also emit clicks; only a
        // datum we built carries the drill / row information.
        if (!datum || (!("__dim" in datum) && !("__rowIds" in datum))) return;
        onClickDatum(datum);
      }}
    />
  );
});
