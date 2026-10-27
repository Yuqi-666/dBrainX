// SPDX-License-Identifier: AGPL-3.0-only

import { Extension } from "@tiptap/core";

/**
 * AI 在当前版本中不可用：没有后端（代理、流式补全、配额）。
 *
 * 保留的东西有两样，都不产生任何 mock 行为：
 *
 * 1. `Ai` 扩展本身 —— AI 入口（斜杠菜单的 AI 分组、`Ask AI`、工具栏 `Improve`）
 *    以「`ai` 扩展是否注册」为可用性判据，注册它入口才继续可见；它的每个命令都是
 *    空实现，只报告成功，绝不触碰 `editor.state`。入口自身负责展示
 *    `AI_UNAVAILABLE_NOTICE`，所以用户点到的是一句明确说明，而不是静默失败。
 * 2. AI 生成面板的 UI（`components/tiptap-ui/ai-menu/ai-menu.tsx` 容器及其
 *    `ai-menu-input` / `ai-menu-actions` / `ai-menu-items` 子组件）被有意留在仓库里、
 *    但**没有任何地方引用**：它需要真实后端才成立，等接入时再由 `index.tsx` 导出并挂回
 *    编辑器。编辑器当前挂载的是同一目录下的 `ai-unavailable-notice.tsx`。
 *    为了让这套未引用的 UI 仍然通过类型检查，命令表面与 storage 形状
 *    （`state` / `generatedWith` / `response`）在这里声明并由扩展提供空容器。
 *
 * 早期版本的占位实现（`lib/mock-ai.ts`）会向用户正文插入 `[AI: 功能在此版本中不可用]`
 * 并伪造「正在生成」的加载状态，既污染内容又让入口看起来可用，已随 mock 一并删除。
 *
 * 接入真实 AI 时：把各命令换成对后端代理的调用，让 `ai-menu/index.tsx` 重新导出生成
 * 面板并在编辑器里挂载它，然后删除入口处的不可用提示。
 */
export const AI_UNAVAILABLE_NOTICE = "AI 功能在当前版本中不可用";

export type Language = string;
export type Tone = string;

export type TextOptions = {
  stream?: boolean;
  format?: string;
  insertAt?: { from: number; to: number } | "start" | "end" | "cursor";
  regenerate?: boolean;
  text?: string;
  tone?: string;
  language?: string;
};

export interface AiGeneratedWith {
  range?: { from: number; to: number };
}

export interface AiStorage {
  state: string;
  generatedWith?: AiGeneratedWith;
  response?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ai: {
      aiComplete: (options?: {
        stream?: boolean;
        format?: string;
      }) => ReturnType;
      aiAccept: () => ReturnType;
      aiReject: (options?: { type?: string }) => ReturnType;
      aiFixSpellingAndGrammar: (options?: {
        stream?: boolean;
        format?: string;
      }) => ReturnType;
      aiExtend: (options?: { stream?: boolean; format?: string }) => ReturnType;
      aiShorten: (options?: {
        stream?: boolean;
        format?: string;
      }) => ReturnType;
      aiSimplify: (options?: {
        stream?: boolean;
        format?: string;
      }) => ReturnType;
      aiEmojify: (options?: {
        stream?: boolean;
        format?: string;
      }) => ReturnType;
      aiSummarize: (options?: {
        stream?: boolean;
        format?: string;
      }) => ReturnType;
      aiAdjustTone: (
        tone: string,
        options?: { stream?: boolean; format?: string },
      ) => ReturnType;
      aiTranslate: (
        language: string,
        options?: { stream?: boolean; format?: string },
      ) => ReturnType;
      aiRegenerate: (options?: {
        stream?: boolean;
        format?: string;
      }) => ReturnType;
      aiRephrase: (options?: {
        stream?: boolean;
        format?: string;
      }) => ReturnType;
      aiTextPrompt: (options?: {
        text?: string;
        insert?: boolean;
        stream?: boolean;
        tone?: string;
        format?: string;
      }) => ReturnType;
    };
  }

  interface Storage {
    ai: AiStorage;
    aiAdvanced: { state: string };
  }
}

/**
 * The AI command surface, deliberately unimplemented: every command reports
 * success so the chains around it keep working, and none of them touches
 * `editor.state`. See the file header for what is kept and why.
 */
export const Ai = Extension.create({
  name: "ai",

  addStorage(): AiStorage {
    return { state: "idle" };
  },

  addCommands() {
    const noop = () => () => true;

    return {
      aiComplete: noop,
      aiAccept: noop,
      aiReject: noop,
      aiFixSpellingAndGrammar: noop,
      aiExtend: noop,
      aiShorten: noop,
      aiSimplify: noop,
      aiEmojify: noop,
      aiSummarize: noop,
      aiAdjustTone: noop,
      aiTranslate: noop,
      aiRegenerate: noop,
      aiRephrase: noop,
      aiTextPrompt: noop,
    };
  },
});

export default Ai;
