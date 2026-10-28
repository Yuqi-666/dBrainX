// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { Component, type ReactNode } from "react";

interface ForceGraphErrorBoundaryProps {
  children: ReactNode;
}

interface ForceGraphErrorBoundaryState {
  error: Error | null;
}

export class ForceGraphErrorBoundary extends Component<
  ForceGraphErrorBoundaryProps,
  ForceGraphErrorBoundaryState
> {
  state: ForceGraphErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ForceGraphErrorBoundaryState {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            padding: 16,
            color: "#ef4444",
            fontSize: 14,
          }}
        >
          <GraphErrorLabel /> {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function GraphErrorLabel() {
  const { t } = useI18n();
  return <>{t("ForceGraph render error:")}</>;
}
