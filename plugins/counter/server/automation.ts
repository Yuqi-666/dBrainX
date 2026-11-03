// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The A/B automation fixture (plan item 67, design §4.7.5).
 *
 * A is a source node. Firing `acme.a.fire` on A publishes `acme.a.fired`.
 * The fixture's trigger listens to that event, follows the `acme.triggers`
 * edge from the event source, and dispatches `acme.b.run` at every reachable
 * `acme.b` node. B's handler writes `content.script` to
 * `nodes/<B>/script.py`, runs it with `python3 -I script.py` through
 * `ctx.sandbox`, writes `content.lastRun` back and emits `acme.b.executed`.
 *
 * The handler never runs a command itself. Its only execution surface is
 * `ctx.sandbox`, which in the server process is the `SandboxService` over the
 * `SandboxGuard`: grants are checked per call, the path is parsed by the
 * sandbox validator (an escape is `SANDBOX_PATH_ESCAPE` before any byte is
 * written), and the audit row lands in `sandbox_calls`.
 *
 * `content.script` is untrusted user text. It is validated here, before the
 * first sandbox call: an empty or non-string body and a body above
 * {@link ACME_SCRIPT_MAX_BYTES} are refused with `ACME_SCRIPT_INVALID`, so a
 * malformed payload never reaches the file layer at all.
 */

import type {
  JsonSchema,
  OperationDefinition,
  SandboxCommand,
  SandboxExecResult,
  SandboxFileRef,
  SandboxPath,
  SandboxPort,
  TriggerDefinitionShape,
} from "@workspace/plugin-sdk";
import {
  defineNodeType,
  defineOperationDefinition,
  defineTrigger,
} from "@workspace/plugin-sdk";

import { counterPluginId } from "../plugin-id.ts";

/** The event A emits when its fire operation runs. */
export const ACME_A_FIRED = "acme.a.fired";
/** The event B emits after a successful script run. */
export const ACME_B_EXECUTED = "acme.b.executed";
/** The edge semantic the trigger follows from A to B. */
export const ACME_TRIGGER_EDGE_SEMANTIC = "acme.triggers";
/** The fixture's ceiling for one script body; a larger body is refused. */
export const ACME_SCRIPT_MAX_BYTES = 64 * 1024;
/** The script name inside `nodes/<B>/`; a node may override it. */
export const ACME_DEFAULT_SCRIPT_NAME = "script.py";

/** A script body is missing, not a string, blank, or above the ceiling. */
export const ACME_SCRIPT_INVALID = "ACME_SCRIPT_INVALID" as const;
/** The script ran and did not succeed (nonzero exit, timeout or truncation). */
export const ACME_SCRIPT_FAILED = "ACME_SCRIPT_FAILED" as const;
/** The operation ran without the node snapshot it needs. */
export const ACME_TARGET_REQUIRED = "ACME_TARGET_REQUIRED" as const;

export type AcmeErrorCode =
  | typeof ACME_SCRIPT_INVALID
  | typeof ACME_SCRIPT_FAILED
  | typeof ACME_TARGET_REQUIRED;

/** A refusal a caller switches on by `code`, never by message. */
export class AcmeAutomationError extends Error {
  readonly code: AcmeErrorCode;

  constructor(code: AcmeErrorCode, detail: string, options: { cause?: unknown } = {}) {
    super(`${code}: ${detail}`, options);
    this.name = "AcmeAutomationError";
    this.code = code;
  }
}

/** The persisted state of one completed attempt. */
export interface AcmeLastRun {
  readonly ok: boolean;
  /** `null` when no process produced an exit code (a refused sandbox call). */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  /** `SANDBOX_*` for a sandbox refusal, `ACME_SCRIPT_FAILED` for a nonzero run. */
  readonly errorCode: string | null;
  readonly scriptPath: string;
  readonly scriptSha256: string | null;
  /** The `operation_runs` row that produced this attempt; never reused. */
  readonly runId: string | null;
}

export interface AcmeAContent {
  /** A message the fired event carries; the trigger does not read it. */
  readonly message: string;
}

export interface AcmeBContent {
  readonly script: string;
  readonly scriptName?: string;
  readonly lastRun?: AcmeLastRun;
}

export const acmeASchema: JsonSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string" },
  },
  additionalProperties: false,
};

export const acmeBSchema: JsonSchema = {
  type: "object",
  required: ["script"],
  properties: {
    script: { type: "string" },
    scriptName: { type: "string" },
    lastRun: { type: "object" },
  },
  additionalProperties: false,
};

export function createAcmeAContent(): AcmeAContent {
  return { message: "ping" };
}

export function createAcmeBContent(): AcmeBContent {
  return { script: "print('hello from acme.b')\n" };
}

export const acmeANodeType = defineNodeType<AcmeAContent>({
  type: "acme.a",
  version: 1,
  pluginId: counterPluginId,
  schema: acmeASchema,
  defaultContent: createAcmeAContent,
  display: { label: "Automation source (A)", icon: "Play" },
  operations: ["acme.a.fire"],
});

export const acmeBNodeType = defineNodeType<AcmeBContent>({
  type: "acme.b",
  version: 1,
  pluginId: counterPluginId,
  schema: acmeBSchema,
  defaultContent: createAcmeBContent,
  display: { label: "Automation script (B)", icon: "Terminal" },
  operations: ["acme.b.run"],
});

export const acmeAFireOperation: OperationDefinition =
  defineOperationDefinition({
    id: "acme.a.fire",
    pluginId: counterPluginId,
    exportName: "acmeAFire",
    target: "node",
    appliesTo: { nodeTypes: ["acme.a"] },
    effect: "invoke",
    reach: "self",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiredCapabilities: ["event.emit"],
    idempotent: false,
  });

export const acmeBRunOperation: OperationDefinition =
  defineOperationDefinition({
    id: "acme.b.run",
    pluginId: counterPluginId,
    exportName: "acmeBRun",
    target: "node",
    appliesTo: { nodeTypes: ["acme.b"] },
    effect: "invoke",
    reach: "self",
    inputSchema: {
      type: "object",
      required: ["sourceNodeId"],
      properties: {
        sourceNodeId: { type: "string" },
      },
      additionalProperties: false,
    },
    /**
     * The operation-level grant check covers what the gateway can derive from
     * the target and the trigger's server-side input: the node write and the
     * event emission. The three sandbox capabilities are enforced one call at a
     * time by `SandboxGuard`, which sees the actual path and executable; the
     * manifest still declares them, and a missing grant is `CAPABILITY_DENIED`
     * on the first sandbox primitive, with its `sandbox_calls` row.
     */
    requiredCapabilities: ["node.write", "event.emit"],
    /**
     * A script run may be retried: the same delivery therefore keeps the run in
     * `failed` (retryable) instead of `dead`, which is what the plan item's
     * "the run status is failed" acceptance asserts. The dead letter stays the
     * destination for a non-idempotent operation, not for this fixture.
     */
    idempotent: true,
  });

/**
 * A trigger declaration with the fields the host's trigger registry reads.
 *
 * `TriggerDefinitionShape` in `@workspace/plugin-sdk` is the registration
 * minimum (id, pluginId, event, operation); the domain `TriggerDefinition`
 * additionally carries the route, the target and the input template. The host
 * keeps the whole object, so this local extension states the rest without
 * copying the domain type into the package.
 */
export interface AcmeTrigger extends TriggerDefinitionShape {
  readonly route:
    | {
        readonly kind: "edge-follow";
        readonly from: "event.source";
        readonly direction: "forward" | "both";
        readonly edgeSemantic?: string;
      }
    | { readonly kind: "scope"; readonly scope: "automation" | "workspace" };
  readonly target:
    | { readonly kind: "node-type"; readonly nodeType: string }
    | { readonly kind: "event-source" };
  readonly input?: Record<string, unknown>;
  readonly maxCascadeDepth?: number;
}

/**
 * The trigger that connects A to B through the graph.
 *
 * The publisher follows `route.edge-follow` from the event's own source node,
 * restricted to the `acme.triggers` semantic, and then keeps only the reached
 * nodes whose type is `acme.b`. A second B node with no edge is therefore not
 * a target.
 */
export const acmeBTrigger: AcmeTrigger = defineTrigger<AcmeTrigger>({
  id: "acme.b.on-a-fired",
  pluginId: counterPluginId,
  event: ACME_A_FIRED,
  operation: "acme.b.run",
  route: {
    kind: "edge-follow",
    from: "event.source",
    direction: "forward",
    edgeSemantic: ACME_TRIGGER_EDGE_SEMANTIC,
  },
  target: { kind: "node-type", nodeType: "acme.b" },
  input: { sourceNodeId: "$event.aggregateId" },
  maxCascadeDepth: 4,
});

/** Everything this module contributes to the counter fixture package. */
export const acmeNodeTypes = [acmeANodeType, acmeBNodeType];
export const acmeOperations = [acmeAFireOperation, acmeBRunOperation];
export const acmeTriggers = [acmeBTrigger];

// ---------------------------------------------------------------------------
// The host surface the handlers run against.
// ---------------------------------------------------------------------------

/**
 * The `ctx.sandbox` surface the worker host provides (§4.7.3).
 *
 * It is the domain `SandboxPort` itself: the host proxies each primitive over
 * the request table, so a handler calls `sandbox.writeFile(path, data)` and
 * `sandbox.exec(command)` with the same signatures it would see in-process.
 * The helpers below are thin wrappers that keep the two call sites readable.
 */

/** What one handler may see: the worker context plus its host ports. */
export interface AcmeContext {
  readonly node?: { readonly id: string; readonly content: unknown };
  readonly correlationId: string;
  readonly runId?: string;
  /**
   * The event this run was dispatched for; the cause of anything it emits.
   *
   * Absent for a run no event started (a job or a manual call), where causation
   * is `null`. It is not the correlation id: that id names the whole intent and
   * is shared by every run of the chain.
   */
  readonly eventId?: string;
  readonly sandbox: SandboxPort;
  writeNode(nodeId: string, patch: { readonly content: unknown }): Promise<void>;
  emit(eventType: string, payload: unknown): Promise<void>;
}

function nodeOf(context: AcmeContext) {
  const node = context.node;
  if (node === undefined) {
    throw new AcmeAutomationError(
      ACME_TARGET_REQUIRED,
      "the operation needs the node snapshot of its target",
    );
  }
  return node;
}

function contentOf(context: AcmeContext): Record<string, unknown> {
  const content = nodeOf(context).content;
  if (typeof content !== "object" || content === null || Array.isArray(content)) {
    return {};
  }
  return content as Record<string, unknown>;
}

/** One `writeFile` primitive call, in the exact `{path, data}` shape. */
export function sandboxWriteFile(
  sandbox: SandboxPort,
  path: SandboxPath,
  data: string,
): Promise<SandboxFileRef> {
  return sandbox.writeFile(path, data);
}

/** One `exec` primitive call, in the exact `{executable, argv, cwd}` shape. */
export function sandboxExec(
  sandbox: SandboxPort,
  command: SandboxCommand,
): Promise<SandboxExecResult> {
  return sandbox.exec(command);
}

/** The error code a thrown sandbox refusal carries, when it carries one. */
export function sandboxErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && code.trim() !== "") return code;
  }
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function scriptNameOf(content: Record<string, unknown>): string {
  const name = content.scriptName;
  return typeof name === "string" && name.trim() !== ""
    ? name
    : ACME_DEFAULT_SCRIPT_NAME;
}

/**
 * The script body, or a named refusal.
 *
 * Every branch is a value the handler can see from a user write: a number, an
 * object, a blank string, or a body above the fixture ceiling.
 */
export function validateScript(script: unknown): string {
  if (typeof script !== "string") {
    throw new AcmeAutomationError(
      ACME_SCRIPT_INVALID,
      `content.script must be a string, got ${script === null ? "null" : typeof script}`,
    );
  }
  if (script.trim() === "") {
    throw new AcmeAutomationError(
      ACME_SCRIPT_INVALID,
      "content.script must not be blank",
    );
  }
  const bytes = utf8Length(script);
  if (bytes > ACME_SCRIPT_MAX_BYTES) {
    throw new AcmeAutomationError(
      ACME_SCRIPT_INVALID,
      `content.script is ${bytes} bytes, above the ${ACME_SCRIPT_MAX_BYTES}-byte ceiling`,
    );
  }
  return script;
}

/** The `lastRun` a refused sandbox call records, before it is thrown again. */
function failureOf(
  error: unknown,
  scriptPath: string,
  runId: string | undefined,
  scriptSha256: string | null,
): AcmeLastRun {
  const code = sandboxErrorCode(error) ?? "ACME_SCRIPT_FAILED";
  return {
    ok: false,
    exitCode: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    errorCode: code,
    scriptPath,
    scriptSha256,
    runId: runId ?? null,
  };
}

async function recordLastRun(
  context: AcmeContext,
  nodeId: string,
  content: Record<string, unknown>,
  lastRun: AcmeLastRun,
): Promise<void> {
  await context.writeNode(nodeId, {
    content: { ...content, lastRun },
  });
}

/**
 * `acme.a.fire`: publish the event a trigger can route on.
 *
 * The node is A itself, so its own id is the event's source; the correlation
 * id comes from the run, never from input.
 */
export async function acmeAFire(
  _input: unknown,
  context: AcmeContext,
): Promise<{ nodeId: string }> {
  const node = nodeOf(context);
  const message = contentOf(context).message;
  await context.emit(ACME_A_FIRED, {
    sourceNodeId: node.id,
    message: typeof message === "string" ? message : "",
  });
  return { nodeId: node.id };
}

/**
 * `acme.b.run`: write, execute and report one script.
 *
 * Order, and the reason for it:
 *
 * 1. validate `content.script` before any sandbox call, so a malformed body is
 *    a named refusal and never reaches the file layer;
 * 2. write `nodes/<B>/<scriptName>`; a `..` or absolute name is refused by the
 *    host's path validator with `SANDBOX_PATH_ESCAPE` and the refusal is itself
 *    audited in `sandbox_calls`;
 * 3. execute `python3 -I script.py` with the node directory as cwd;
 * 4. write `content.lastRun` in every outcome — a failure still records which
 *    run, script and exit code produced it;
 * 5. on success emit `acme.b.executed`; on failure throw with the exit code,
 *    timeout state and stderr in the message, so the `operation_runs` row
 *    carries the same facts as the `sandbox_calls` row.
 */
export async function acmeBRun(
  input: unknown,
  context: AcmeContext,
): Promise<{
  nodeId: string;
  exitCode: number;
  stdout: string;
  scriptPath: string;
}> {
  const node = nodeOf(context);
  const content = contentOf(context);
  const scriptName = scriptNameOf(content);
  const scriptPath = `nodes/${node.id}/${scriptName}`;

  let script: string;
  try {
    script = validateScript(content.script);
  } catch (error) {
    await recordLastRun(
      context,
      node.id,
      content,
      failureOf(error, scriptPath, context.runId, null),
    );
    throw error;
  }

  const sourceNodeId =
    typeof input === "object" && input !== null
      ? (input as { sourceNodeId?: unknown }).sourceNodeId
      : undefined;
  if (typeof sourceNodeId !== "string" || sourceNodeId.trim() === "") {
    throw new AcmeAutomationError(
      ACME_SCRIPT_INVALID,
      "acme.b.run needs the sourceNodeId of the event that dispatched it",
    );
  }

  const directory: SandboxPath = { path: `nodes/${node.id}` };

  let written: SandboxFileRef;
  try {
    written = await sandboxWriteFile(
      context.sandbox,
      { path: scriptPath },
      script,
    );
  } catch (error) {
    await recordLastRun(
      context,
      node.id,
      content,
      failureOf(error, scriptPath, context.runId, null),
    );
    throw error;
  }

  let result: SandboxExecResult;
  try {
    result = await sandboxExec(context.sandbox, {
      executable: "python3",
      argv: ["-I", "script.py"],
      cwd: directory,
      timeoutMs: 30_000,
    });
  } catch (error) {
    await recordLastRun(
      context,
      node.id,
      content,
      failureOf(error, scriptPath, context.runId, written.sha256),
    );
    throw error;
  }

  const ok =
    result.exitCode === 0 && !result.timedOut && !result.outputTruncated;
  const lastRun: AcmeLastRun = {
    ok,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    errorCode: ok ? null : (result.errorCode ?? "ACME_SCRIPT_FAILED"),
    scriptPath,
    scriptSha256: written.sha256,
    runId: context.runId ?? null,
  };
  await recordLastRun(context, node.id, content, lastRun);

  if (!ok) {
    throw new AcmeAutomationError(
      ACME_SCRIPT_FAILED,
      `exitCode=${result.exitCode} timedOut=${result.timedOut} stderr=${JSON.stringify(result.stderr)}`,
    );
  }

  await context.emit(ACME_B_EXECUTED, {
    sourceNodeId,
    nodeId: node.id,
    exitCode: result.exitCode,
    runId: context.runId ?? null,
  });

  return {
    nodeId: node.id,
    exitCode: result.exitCode,
    stdout: result.stdout,
    scriptPath,
  };
}

/** The handlers by operation id, for a host that binds them in-process. */
export function acmeHandlers(): Readonly<
  Record<string, (input: unknown, context: AcmeContext) => Promise<unknown>>
> {
  return {
    "acme.a.fire": acmeAFire,
    "acme.b.run": acmeBRun,
  };
}

export { messageOf };
