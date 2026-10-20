// SPDX-License-Identifier: AGPL-3.0-only

"use client";

/**
 * The single-value readout — the number a gauge / liquid / progress chart
 * cannot draw for itself.
 *
 * VChart only gives an `indicator` to `gauge` and `pie`; the progress and liquid
 * series have no text mark at all, so the canvas would show an unlabelled arc.
 * The shell therefore draws the absolute value as DOM chrome over the chart
 * (pointer-events off, so every gesture still reaches the canvas), which also
 * keeps the number crisp at any zoom and in both themes.
 */
import { cn } from "@workspace/ui/lib/utils";

/** `4230.5` → `4,230.5`; two decimals is as much as a canvas readout needs. */
export function formatChartValue(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function ChartValueReadout({
  value,
  label,
  ratio,
  /** 线性进度 fills the middle of its pane; the round charts have a centre. */
  align = "center",
  className,
}: {
  value: number;
  label: string;
  ratio: number;
  align?: "center" | "top";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 flex flex-col items-center gap-0.5 px-4 text-center",
        align === "top" ? "justify-start pt-8" : "justify-center",
        className,
      )}
    >
      <span className="text-2xl leading-tight font-semibold tabular-nums text-foreground">
        {formatChartValue(value)}
      </span>
      <span className="max-w-40 truncate text-[11px] text-muted-foreground">
        {label} · {Math.round(ratio * 100)}%
      </span>
    </div>
  );
}
