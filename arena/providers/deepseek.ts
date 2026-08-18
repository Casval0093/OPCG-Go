// DeepSeek provider. Verified against api-docs.deepseek.com on 2026-08-18 rather than assumed —
// several of its differences from the Anthropic path are load-bearing.
//
// WHY THE OpenAI SDK
//
// DeepSeek publishes no SDK of its own and documents the OpenAI SDK with a base_url override, so that
// is what this uses. (DeepSeek also exposes an Anthropic-compatible endpoint at
// `https://api.deepseek.com/anthropic`, which would let the Anthropic provider reach it with one
// setting changed. That route is deliberately NOT taken: the arena's Anthropic path relies on
// `output_config.format`, the `server-side-fallback` beta and `cache_control`, none of which a
// compatibility shim implements — so it would fail in three places at once, and each failure would
// look like a bug in our code rather than an unsupported parameter.)
//
// FOUR DIFFERENCES THAT CHANGED THE CODE
//
//   1. NO STRICT SCHEMA. `response_format` accepts only `text` and `json_object` — there is no
//      `json_schema`. And the docs warn json_object "may occasionally return empty content". So
//      structure comes from a FORCED FUNCTION CALL instead (`tool_choice` pinned to one function),
//      which is the strongest guarantee the API offers. `json_object` is kept as a second attempt.
//   2. TOOLS NEED TELLING. DeepSeek's parameter reference notes tool use "requires explicit
//      instruction", so the prompt gets an extra line naming the function. That line is added here,
//      not in `prompt.ts`, so the Anthropic path is not polluted by a DeepSeek quirk.
//   3. CACHING IS AUTOMATIC AND UNPRICED HERE. Context caching on disk is on by default with no
//      parameter, and the response reports `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`.
//      Matching is prefix-based, so the stable/volatile split in `prompt.ts` still pays — but there
//      is no `cache_control` to place and no minimum-prefix cliff to clear. Those fields are not in
//      the OpenAI SDK's types, hence the narrow cast below.
//   4. SAMPLING IS ALLOWED. `temperature` and `top_p` are accepted (0–2 and 0–1), unlike Claude
//      Opus 5 where sending them is a 400. Left unset by default; settable per council member.
//
// THINKING: DeepSeek takes `thinking: {type, reasoning_effort}` with reasoning_effort of low | high |
// max — three levels against the arena's five. The mapping is lossy and is therefore explicit and
// warned about once, rather than silently collapsing medium and xhigh into their neighbours.

import OpenAI, { APIConnectionError, APIError, AuthenticationError, NotFoundError, RateLimitError } from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { RenderedPrompt } from "../prompt.ts";
import {
  ANSWER_SCHEMA,
  emptyTotals,
  validateAnswer,
  type CallOptions,
  type CallResult,
  type LlmProvider,
  type Usage,
} from "./types.ts";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_MODEL = "deepseek-v4-flash";

const FUNCTION_NAME = "choose_move";

/**
 * DeepSeek accepts parameters the OpenAI schema does not know about (`thinking`, and its own
 * reasoning fields). Widening the non-streaming param type keeps the RESPONSE typed as
 * `ChatCompletion` — casting the call site instead would widen the return to a union with
 * `Stream<...>` and lose `.choices` entirely.
 */
type DeepSeekParams = ChatCompletionCreateParamsNonStreaming & Record<string, unknown>;

/** DeepSeek exposes three reasoning levels; the arena speaks five. Collapse explicitly, warn once. */
const EFFORT_MAP: Record<string, "low" | "high" | "max"> = {
  low: "low",
  medium: "low",
  high: "high",
  xhigh: "high",
  max: "max",
};
const warnedEfforts = new Set<string>();

function mapEffort(effort: string | undefined): "low" | "high" | "max" | undefined {
  if (!effort) return undefined;
  const mapped = EFFORT_MAP[effort];
  if (!mapped) return undefined;
  if ((effort === "medium" || effort === "xhigh") && !warnedEfforts.has(effort)) {
    warnedEfforts.add(effort);
    console.warn(
      `  note: DeepSeek reasoning_effort accepts low|high|max only — effort "${effort}" is being ` +
        `sent as "${mapped}". Use low, high or max in the player config to say exactly what you mean.`,
    );
  }
  return mapped;
}

/** Fields DeepSeek adds to `usage` that the OpenAI SDK does not type. */
interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export function createDeepSeekProvider(): LlmProvider {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Unlike Anthropic there is no profile fallback for DeepSeek, so " +
        "the key is required:\n" +
        "        echo 'DEEPSEEK_API_KEY=sk-...' >> .env   (.env is gitignored)\n" +
        "        set -a; source .env; set +a",
    );
  }

  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: DEEPSEEK_BASE_URL,
  });
  const totals = emptyTotals();

  const accrue = (usage: DeepSeekUsage | undefined): Usage => {
    const out: Usage = {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      cacheReadTokens: usage?.prompt_cache_hit_tokens ?? 0,
      // DeepSeek reports misses, not writes. Leaving this 0 is honest; miss count is not a write count.
      cacheWriteTokens: 0,
    };
    totals.inputTokens += out.inputTokens;
    totals.outputTokens += out.outputTokens;
    totals.cacheReadTokens += out.cacheReadTokens;
    return out;
  };

  return {
    name: "deepseek",
    defaultModel: DEFAULT_MODEL,
    totals,

    async choose(prompt: RenderedPrompt, options: CallOptions): Promise<CallResult> {
      totals.calls++;
      const effort = mapEffort(options.effort);

      // The system turn carries the stable prefix so DeepSeek's prefix cache can match it, and the
      // volatile board state goes in the user turn — same ordering discipline as the Anthropic path,
      // for the same reason, just without an explicit breakpoint to place.
      const messages = [
        { role: "system" as const, content: prompt.stable },
        {
          role: "user" as const,
          content:
            `${prompt.volatile}\n\n` +
            `Call the ${FUNCTION_NAME} function with your chosen index and reason. Do not reply with prose.`,
        },
      ];

      const base = {
        model: options.model,
        messages,
        max_tokens: options.maxTokens ?? 2048,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(effort ? { thinking: { type: "enabled", reasoning_effort: effort } } : {}),
      };

      try {
        // Attempt 1: forced function call. Strongest structure DeepSeek offers.
        const forced = (await client.chat.completions.create({
          ...base,
          tools: [
            {
              type: "function",
              function: {
                name: FUNCTION_NAME,
                description: "Commit to one legal move from the numbered list.",
                parameters: ANSWER_SCHEMA as unknown as Record<string, unknown>,
              },
            },
          ],
          tool_choice: { type: "function", function: { name: FUNCTION_NAME } },
        } as DeepSeekParams)) as ChatCompletion;

        const usage = accrue(forced.usage as DeepSeekUsage | undefined);
        const call = forced.choices?.[0]?.message?.tool_calls?.[0];
        if (call && "function" in call && call.function?.arguments) {
          const validated = validateAnswer(JSON.parse(call.function.arguments), options.choiceCount);
          if (!("kind" in validated)) return { ok: true, answer: validated, usage };
          totals.failures++;
          return { ok: false, failure: validated };
        }

        // Attempt 2: json_object. The docs' own warning is that content can come back empty, so a
        // missing tool call is an expected outcome to retry rather than a hard failure.
        const jsonMode = (await client.chat.completions.create({
          ...base,
          response_format: { type: "json_object" },
          messages: [
            messages[0]!,
            {
              role: "user" as const,
              content:
                `${prompt.volatile}\n\n` +
                `Reply with json only, in exactly this shape:\n` +
                `{"index": <integer index of your chosen move>, "reason": "<one sentence>"}`,
            },
          ],
        } as DeepSeekParams)) as ChatCompletion;

        const usage2 = accrue(jsonMode.usage as DeepSeekUsage | undefined);
        const content = jsonMode.choices?.[0]?.message?.content;
        if (!content) {
          totals.failures++;
          return { ok: false, failure: { kind: "invalid", detail: "empty content from both attempts" } };
        }
        const validated = validateAnswer(JSON.parse(content), options.choiceCount);
        if ("kind" in validated) {
          totals.failures++;
          return { ok: false, failure: validated };
        }
        return { ok: true, answer: validated, usage: usage2 };
      } catch (error) {
        totals.failures++;
        // Most-specific first; APIConnectionError before APIError, which it extends.
        if (error instanceof AuthenticationError) {
          return {
            ok: false,
            failure: { kind: "error", detail: "401 unauthorized — check DEEPSEEK_API_KEY in .env" },
          };
        }
        if (error instanceof NotFoundError) {
          return {
            ok: false,
            failure: {
              kind: "error",
              detail: `unknown model "${options.model}" — DeepSeek serves deepseek-v4-flash and deepseek-v4-pro`,
            },
          };
        }
        if (error instanceof RateLimitError) {
          return { ok: false, failure: { kind: "error", detail: "rate limited" } };
        }
        if (error instanceof APIConnectionError) {
          return { ok: false, failure: { kind: "error", detail: "connection failed" } };
        }
        if (error instanceof APIError) {
          return { ok: false, failure: { kind: "error", detail: `${error.status}: ${error.message}` } };
        }
        if (error instanceof SyntaxError) {
          return { ok: false, failure: { kind: "invalid", detail: `unparseable JSON: ${error.message}` } };
        }
        return { ok: false, failure: { kind: "error", detail: String(error) } };
      }
    },
  };
}
