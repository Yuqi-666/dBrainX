// SPDX-License-Identifier: AGPL-3.0-only

import type { RuleGroupType, Field } from "@workspace/utils";
import type { NodeId } from "../node";

export class FilterConfig {
  private readonly _selectedNodes: NodeId[];
  private readonly _ruleGroup?: RuleGroupType;
  private readonly _collectionType?: string;

  private constructor(props: {
    selectedNodes?: NodeId[];
    ruleGroup?: RuleGroupType;
    collectionType?: string;
  }) {
    this._selectedNodes = props.selectedNodes ?? [];
    this._ruleGroup = props.ruleGroup;
    this._collectionType = props.collectionType;
  }

  static create(props?: {
    selectedNodes?: NodeId[];
    ruleGroup?: RuleGroupType;
    collectionType?: string;
  }): FilterConfig {
    return new FilterConfig(props ?? {});
  }

  static empty(): FilterConfig {
    return new FilterConfig({});
  }

  withSelectedNodes(nodes: NodeId[]): FilterConfig {
    return new FilterConfig({
      selectedNodes: nodes,
      ruleGroup: this._ruleGroup,
      collectionType: this._collectionType,
    });
  }

  withRuleGroup(ruleGroup: RuleGroupType): FilterConfig {
    return new FilterConfig({
      selectedNodes: this._selectedNodes,
      ruleGroup,
      collectionType: this._collectionType,
    });
  }

  withCollectionType(type: string): FilterConfig {
    return new FilterConfig({
      selectedNodes: this._selectedNodes,
      ruleGroup: this._ruleGroup,
      collectionType: type,
    });
  }

  clearRuleGroup(): FilterConfig {
    return new FilterConfig({
      selectedNodes: this._selectedNodes,
      ruleGroup: undefined,
      collectionType: this._collectionType,
    });
  }

  hasSelectedNodes(): boolean {
    return this._selectedNodes.length > 0;
  }

  hasRuleGroup(): boolean {
    return this._ruleGroup !== undefined;
  }

  hasCollectionType(): boolean {
    return this._collectionType !== undefined;
  }

  isEmpty(): boolean {
    return (
      !this.hasSelectedNodes() &&
      !this.hasRuleGroup() &&
      !this.hasCollectionType()
    );
  }

  equals(other: FilterConfig): boolean {
    return (
      JSON.stringify(this._selectedNodes) ===
      JSON.stringify(other._selectedNodes) &&
      JSON.stringify(this._ruleGroup) === JSON.stringify(other._ruleGroup) &&
      this._collectionType === other._collectionType
    );
  }

  get selectedNodes(): NodeId[] {
    return this._selectedNodes;
  }

  get ruleGroup(): RuleGroupType | undefined {
    return this._ruleGroup;
  }

  get collectionType(): string | undefined {
    return this._collectionType;
  }
}

export class NodeFilterField {
  private readonly field: Field;

  private constructor(field: Field) {
    this.field = field;
  }

  static fromField(field: Field): NodeFilterField {
    return new NodeFilterField(field);
  }

  getName(): string {
    return this.field.name;
  }

  getLabel(): string {
    return this.field.label;
  }

  getInputType(): string {
    return this.field.inputType ?? "text";
  }

  getField(): Field {
    return this.field;
  }
}

export class EdgeFilterField {
  private readonly field: Field;

  private constructor(field: Field) {
    this.field = field;
  }

  static fromField(field: Field): EdgeFilterField {
    return new EdgeFilterField(field);
  }

  getName(): string {
    return this.field.name;
  }

  getLabel(): string {
    return this.field.label;
  }

  getInputType(): string {
    return this.field.inputType ?? "text";
  }

  getField(): Field {
    return this.field;
  }
}
