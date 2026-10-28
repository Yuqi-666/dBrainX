// SPDX-License-Identifier: AGPL-3.0-only

import type {
  EdgeData,
  EdgeId,
  NodeData,
  NodeId,
  View,
} from "@workspace/interfaces";
import type { RuleGroupType, RuleType } from "react-querybuilder";

type RuleObject = RuleType;

interface FilterResult {
  filteredNodes: Map<NodeId, NodeData>;
  filteredEdges: Map<EdgeId, EdgeData>;
}

function getNodeFieldValue(node: NodeData, field: string): unknown {
  switch (field) {
    case "title":
      return node.title;
    case "abstract":
      return node.abstract;
    case "permission":
      return node.permission;
    case "semanticId":
      return node.semanticId;
    case "tags":
      return node.tags;
    case "nodeType":
      return node.nodeType;
    case "createdAt":
      return node.createdAt;
    case "updatedAt":
      return node.updatedAt;
    default:
      return undefined;
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function compareValues(
  actual: unknown,
  operator: string,
  expected: unknown,
): boolean {
  if (operator === "null") {
    return actual === null || actual === undefined;
  }
  if (operator === "notNull") {
    return actual !== null && actual !== undefined;
  }

  if (actual === null || actual === undefined) {
    return false;
  }

  switch (operator) {
    case "=":
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const a = toNumber(actual);
      const b = toNumber(expected);
      if (a === undefined || b === undefined) return false;
      if (typeof actual === "string" && typeof expected === "string") {
        // Date (ISO string) comparison — lexicographic order matches chronology.
        if (operator === ">") return actual > expected;
        if (operator === ">=") return actual >= expected;
        if (operator === "<") return actual < expected;
        return actual <= expected;
      }
      if (operator === ">") return a > b;
      if (operator === ">=") return a >= b;
      if (operator === "<") return a < b;
      return a <= b;
    }
    case "contains":
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.toLowerCase().includes(expected.toLowerCase());
      }
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      return false;
    case "doesNotContain":
      if (typeof actual === "string" && typeof expected === "string") {
        return !actual.toLowerCase().includes(expected.toLowerCase());
      }
      if (Array.isArray(actual)) {
        return !actual.includes(expected);
      }
      return false;
    case "beginsWith":
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.toLowerCase().startsWith(expected.toLowerCase());
      }
      return false;
    case "endsWith":
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.toLowerCase().endsWith(expected.toLowerCase());
      }
      return false;
    case "doesNotBeginWith":
      if (typeof actual === "string" && typeof expected === "string") {
        return !actual.toLowerCase().startsWith(expected.toLowerCase());
      }
      return false;
    case "doesNotEndWith":
      if (typeof actual === "string" && typeof expected === "string") {
        return !actual.toLowerCase().endsWith(expected.toLowerCase());
      }
      return false;
    case "in":
      if (Array.isArray(expected)) {
        return expected.includes(actual);
      }
      return false;
    case "notIn":
      if (Array.isArray(expected)) {
        return !expected.includes(actual);
      }
      return false;
    default:
      return false;
  }
}

const NODE_FILTER_FIELDS = [
  "title",
  "abstract",
  "permission",
  "semanticId",
  "tags",
  "nodeType",
  "createdAt",
  "updatedAt",
] as const;

function evaluateRule(
  rule: RuleObject,
  nodes: Map<NodeId, NodeData>,
): boolean {
  const { field, operator, value } = rule;

  if (!(NODE_FILTER_FIELDS as readonly string[]).includes(field)) {
    return true;
  }

  for (const node of nodes.values()) {
    const fieldValue = getNodeFieldValue(node, field);
    if (compareValues(fieldValue, operator, value)) {
      return true;
    }
  }
  return false;
}

function evaluateRuleGroup(
  ruleGroup: RuleGroupType,
  nodes: Map<NodeId, NodeData>,
): boolean {
  const { combinator, rules } = ruleGroup;

  if (!rules || rules.length === 0) {
    return true;
  }

  const results = rules.map((rule) => {
    if ("rules" in rule) {
      return evaluateRuleGroup(rule as RuleGroupType, nodes);
    }
    return evaluateRule(rule as RuleObject, nodes);
  });

  if (combinator === "and") {
    return results.every((r) => r);
  } else {
    return results.some((r) => r);
  }
}

function shouldIncludeNode(
  nodeId: NodeId,
  node: NodeData,
  ruleGroup: RuleGroupType,
): boolean {
  const tempNodes = new Map<NodeId, NodeData>([[nodeId, node]]);
  return evaluateRuleGroup(ruleGroup, tempNodes);
}

export function filterByViewFilterConfig(
  nodes: Map<NodeId, NodeData>,
  edges: Map<EdgeId, EdgeData>,
  view?: View,
): FilterResult {
  const filterConfig = view?.filterConfig;

  if (!filterConfig) {
    return { filteredNodes: new Map(nodes), filteredEdges: new Map(edges) };
  }

  const selectedSet =
    filterConfig.selectedNodes && filterConfig.selectedNodes.length > 0
      ? new Set(filterConfig.selectedNodes)
      : null;
  const hasRule = filterConfig.ruleGroup !== undefined;

  // Global view (no enumeration AND no filter) => everything.
  const isGlobal = !selectedSet && !hasRule;

  const filteredNodes = new Map<NodeId, NodeData>();
  nodes.forEach((node, nodeId) => {
    if (isGlobal) {
      filteredNodes.set(nodeId, node);
      return;
    }
    const inEnumeration = selectedSet ? selectedSet.has(nodeId) : false;
    const matchesRule = hasRule
      ? shouldIncludeNode(nodeId, node, filterConfig.ruleGroup!)
      : false;
    if (inEnumeration || matchesRule) {
      filteredNodes.set(nodeId, node);
    }
  });

  const filteredEdges = new Map<EdgeId, EdgeData>();
  edges.forEach((edge, edgeId) => {
    const sourceIn = filteredNodes.has(edge.from);
    const targetIn = filteredNodes.has(edge.to);
    if (sourceIn && targetIn) {
      filteredEdges.set(edgeId, edge);
    }
  });

  return { filteredNodes, filteredEdges };
}
