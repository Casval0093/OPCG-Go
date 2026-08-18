// The provider seam. A council member names a provider and a model; nothing above this layer knows
// which vendor answered.
//
// This exists because the arena's job is comparing configurations. A tournament that can field an
// Anthropic council against a DeepSeek council is measuring something; one locked to a single vendor
// is measuring less. The `Usage` shape below is deliberately vendor-neutral for the same reason.

import type { RenderedPrompt } from "../prompt.ts";

export interface ChoiceAnswer {
  index: number;
  reason: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from a cached prefix. Anthropic: cache_read_input_tokens. DeepSeek: prompt_cache_hit_tokens. */
  cacheReadTokens: number;
  /** Tokens written to cache. DeepSeek does not report writes separately, so it stays 0 there. */
  cacheWriteTokens: number;
}

/** Every failure mode degrades to the scripted heuristic and is counted. None is swallowed. */
export type CallFailure =
  | { kind: "refusal"; detail: string }
  | { kind: "invalid"; detail: string }
  | { kind: "error"; detail: string };

export type CallResult =
  | { ok: true; answer: ChoiceAnswer; usage: Usage }
  | { ok: false; failure: CallFailure };

export interface CallOptions {
  model: string;
  /** Portable levels: low | medium | high | xhigh | max. Providers map these onto their own knob. */
  effort?: string;
  temperature?: number;
  maxTokens?: number;
  /** Upper bound on the index the model may return. Validated in code, never trusted from the model. */
  choiceCount: number;
  label: string;
}

export interface LlmProvider {
  readonly name: string;
  /** Default model when a council member does not name one. */
  readonly defaultModel: string;
  choose(prompt: RenderedPrompt, options: CallOptions): Promise<CallResult>;
  readonly totals: Usage & { calls: number; failures: number };
}

/** The one schema every provider must satisfy, however it enforces it. */
export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    index: { type: "integer", description: "The index of the chosen legal move." },
    reason: { type: "string", description: "One sentence. Why this move." },
  },
  required: ["index", "reason"],
  additionalProperties: false,
} as const;

/**
 * Shared validation. Neither provider can express a numeric range in its schema — Anthropic's
 * structured outputs reject `minimum`/`maximum`, and DeepSeek has no strict schema at all — so the
 * bound is checked here for both.
 */
export function validateAnswer(raw: unknown, choiceCount: number): ChoiceAnswer | CallFailure {
  if (typeof raw !== "object" || raw === null) {
    return { kind: "invalid", detail: "answer was not an object" };
  }
  const candidate = raw as { index?: unknown; reason?: unknown };
  const index = typeof candidate.index === "string" ? Number(candidate.index) : candidate.index;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= choiceCount) {
    return { kind: "invalid", detail: `index ${String(candidate.index)} outside 0..${choiceCount - 1}` };
  }
  return {
    index: index as number,
    reason: typeof candidate.reason === "string" ? candidate.reason : "",
  };
}

export function emptyTotals(): Usage & { calls: number; failures: number } {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    calls: 0,
    failures: 0,
  };
}
