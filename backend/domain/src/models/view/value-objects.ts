// SPDX-License-Identifier: AGPL-3.0-only

import { FilterConfig } from "../filter/value-objects";

/**
 * ViewId value object - wraps a string with validation
 */
export class ViewId {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  /**
   * Creates a new ViewId
   * @throws Error if value is empty
   */
  static create(value: string): ViewId {
    if (!value || value.trim().length === 0) {
      throw new Error("ViewId cannot be empty");
    }
    return new ViewId(value);
  }

  /**
   * Gets the underlying string value
   */
  get value(): string {
    return this._value;
  }

  /**
   * Checks if two ViewIds are equal
   */
  equals(other: ViewId): boolean {
    return this._value === other._value;
  }

  /**
   * Returns the string representation
   */
  toString(): string {
    return this._value;
  }
}

/**
 * ViewType value object - represents the high-level type of a view
 * (semantic view category, not a specific G6 layout algorithm).
 */
export class ViewType {
  private static readonly VALID_TYPES = ["Force", "Flow"] as const;

  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static force(): ViewType {
    return new ViewType("Force");
  }

  static flow(): ViewType {
    return new ViewType("Flow");
  }

  static fromString(value: string): ViewType {
    if (!ViewType.VALID_TYPES.includes(value as (typeof ViewType.VALID_TYPES)[number])) {
      throw new Error(
        `Invalid view type: ${value}. Valid values are: ${ViewType.VALID_TYPES.join(", ")}`,
      );
    }
    return new ViewType(value);
  }

  getValue(): string {
    return this.value;
  }

  equals(other: ViewType): boolean {
    return this.value === other.value;
  }

  isForce(): boolean {
    return this.value === "Force";
  }

  isFlow(): boolean {
    return this.value === "Flow";
  }
}

/**
 * VisualConfig value object - visual settings for graph display
 * All properties are readonly - use with* methods to create updated instances
 */
interface VisualConfigProps {
  backgroundColor?: string;
  colorsSyncTheme?: boolean;
  backgroundStyle?: "solid" | "grid" | "dots" | "none";
  gridSpacing?: number;
  gridColor?: string;
  snapToGrid?: boolean;
  showMinimap?: boolean;
  nodeDensity?: number;
}

export class VisualConfig {
  readonly backgroundColor?: string;
  readonly colorsSyncTheme?: boolean;
  readonly backgroundStyle?: "solid" | "grid" | "dots" | "none";
  readonly gridSpacing?: number;
  readonly gridColor?: string;
  readonly snapToGrid?: boolean;
  readonly showMinimap?: boolean;
  readonly nodeDensity?: number;

  private constructor(props: VisualConfigProps) {
    this.backgroundColor = props.backgroundColor;
    this.colorsSyncTheme = props.colorsSyncTheme;
    this.backgroundStyle = props.backgroundStyle;
    this.gridSpacing = props.gridSpacing;
    this.gridColor = props.gridColor;
    this.snapToGrid = props.snapToGrid;
    this.showMinimap = props.showMinimap;
    this.nodeDensity = props.nodeDensity;
  }

  /**
   * Creates a new VisualConfig with optional properties
   */
  static create(props?: Partial<VisualConfig>): VisualConfig {
    const legacy = props as {
      backgroundColorSyncTheme?: boolean;
      gridColorSyncTheme?: boolean;
    } | undefined;
    return new VisualConfig({
      backgroundColor: props?.backgroundColor,
      colorsSyncTheme: props?.colorsSyncTheme ?? Boolean(
        legacy?.backgroundColorSyncTheme || legacy?.gridColorSyncTheme,
      ),
      backgroundStyle: props?.backgroundStyle ?? "none",
      gridSpacing: props?.gridSpacing ?? 20,
      gridColor: props?.gridColor ?? "#e5e7eb",
      snapToGrid: props?.snapToGrid ?? false,
      showMinimap: props?.showMinimap ?? false,
      // Deliberately not defaulted: an absent density means "let the
      // renderer decide", so the physics default lives in one place.
      nodeDensity: props?.nodeDensity,
    });
  }

  /**
   * Creates a copy with updated background color
   */
  withBackgroundColor(color: string): VisualConfig {
    return new VisualConfig({
      backgroundColor: color,
      colorsSyncTheme: this.colorsSyncTheme,
      backgroundStyle: this.backgroundStyle,
      gridSpacing: this.gridSpacing,
      gridColor: this.gridColor,
      snapToGrid: this.snapToGrid,
      showMinimap: this.showMinimap,
      nodeDensity: this.nodeDensity,
    });
  }

  /**
   * Creates a copy with updated background style
   */
  withBackgroundStyle(style: VisualConfig["backgroundStyle"]): VisualConfig {
    return new VisualConfig({
      backgroundColor: this.backgroundColor,
      colorsSyncTheme: this.colorsSyncTheme,
      backgroundStyle: style,
      gridSpacing: this.gridSpacing,
      gridColor: this.gridColor,
      snapToGrid: this.snapToGrid,
      showMinimap: this.showMinimap,
      nodeDensity: this.nodeDensity,
    });
  }

  /**
   * Creates a copy with updated grid spacing
   */
  withGridSpacing(spacing: number): VisualConfig {
    return new VisualConfig({
      backgroundColor: this.backgroundColor,
      colorsSyncTheme: this.colorsSyncTheme,
      backgroundStyle: this.backgroundStyle,
      gridSpacing: spacing,
      gridColor: this.gridColor,
      snapToGrid: this.snapToGrid,
      showMinimap: this.showMinimap,
      nodeDensity: this.nodeDensity,
    });
  }

  /**
   * Creates a copy with updated grid color
   */
  withGridColor(color: string): VisualConfig {
    return new VisualConfig({
      backgroundColor: this.backgroundColor,
      colorsSyncTheme: this.colorsSyncTheme,
      backgroundStyle: this.backgroundStyle,
      gridSpacing: this.gridSpacing,
      gridColor: color,
      snapToGrid: this.snapToGrid,
      showMinimap: this.showMinimap,
      nodeDensity: this.nodeDensity,
    });
  }

  /**
   * Creates a copy with updated snap to grid setting
   */
  withSnapToGrid(enabled: boolean): VisualConfig {
    return new VisualConfig({
      backgroundColor: this.backgroundColor,
      colorsSyncTheme: this.colorsSyncTheme,
      backgroundStyle: this.backgroundStyle,
      gridSpacing: this.gridSpacing,
      gridColor: this.gridColor,
      snapToGrid: enabled,
      showMinimap: this.showMinimap,
      nodeDensity: this.nodeDensity,
    });
  }

  /**
   * Creates a copy with updated minimap visibility
   */
  withShowMinimap(show: boolean): VisualConfig {
    return new VisualConfig({
      backgroundColor: this.backgroundColor,
      colorsSyncTheme: this.colorsSyncTheme,
      backgroundStyle: this.backgroundStyle,
      gridSpacing: this.gridSpacing,
      gridColor: this.gridColor,
      snapToGrid: this.snapToGrid,
      showMinimap: show,
      nodeDensity: this.nodeDensity,
    });
  }

  /**
   * Checks if two VisualConfigs are equal
   */
  equals(other: VisualConfig): boolean {
    return (
      this.backgroundColor === other.backgroundColor &&
      this.colorsSyncTheme === other.colorsSyncTheme &&
      this.backgroundStyle === other.backgroundStyle &&
      this.gridSpacing === other.gridSpacing &&
      this.gridColor === other.gridColor &&
      this.snapToGrid === other.snapToGrid &&
      this.showMinimap === other.showMinimap &&
      this.nodeDensity === other.nodeDensity
    );
  }
}
