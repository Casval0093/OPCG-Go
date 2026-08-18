// Anthropic client for the arena. One job: given a rendered prompt, return a validated choice index.
//
// API-KEY HANDLING — the whole of it
//
// The key is read from `ANTHROPIC_API_KEY` (via the SDK's own credential resolution) and never
// appears anywhere else. It is not in a player config, not in a game record, not in a log line, and
// `.env` / `arena/.cache/` / `arena/results/` are gitignored. Player configs name a MODEL, never a
// credential.
//
// STRUCTURED OUTPUT
//
// `output_config.format` with a json_schema, not free-form text and not a regex. Note the schema has
// no `minimum`/`maximum` on `index` — numeric constraints are not supported in structured-output
// schemas — so the range check is in code below, where it belongs anyway.
//
// PROMPT CACHING IS THE COST LEVER, AND IT IS LARGE HERE
//
// Measured on this engine: 89.2 substantive decisions per seat per game on a real Block 2+ deck. The
// rules primer + playbook + lens is identical across all of them, so it goes in `system` with a
// cache breakpoint and the per-decision board state goes in the user turn, after it. Claude Opus 5's
// minimum cacheable prefix is 512 tokens, which the primer alone clears.

import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from "@anthropic-ai/sdk";
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

/** Default model for every role. Override per role in a player config if you want to tier. */
export const DEFAULT_MODEL = "claude-opus-5";

export function createAnthropicProvider(): LlmProvider {
  // Do NOT hard-fail on a missing ANTHROPIC_API_KEY. The SDK resolves credentials in order:
  // ANTHROPIC_API_KEY -> ANTHROPIC_AUTH_TOKEN -> an `ant auth login` OAuth profile. A machine with a
  // live profile and no env var is correctly authenticated, and refusing to start there would be
  // wrong. Warn, then let the SDK decide; a genuine auth failure surfaces as an AuthenticationError
  // on the first call, which `choose` turns into a named failure.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn(
      "  note: no ANTHROPIC_API_KEY in the environment — falling back to your `ant auth login` " +
        "profile. If calls fail with 401, either re-run `ant auth login` or set the key:\n" +
        "        echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env   (.env is gitignored)",
    );
  }
  // Zero-arg construction so the SDK owns credential resolution. Never pass a literal key.
  const client = new Anthropic();
  const totals = emptyTotals();

  return {
    name: "anthropic",
    defaultModel: DEFAULT_MODEL,
    totals,
    async choose(prompt, options): Promise<CallResult> {
      totals.calls++;
      try {
        const response = await client.beta.messages.create({
          model: options.model,
          max_tokens: options.maxTokens ?? 2048,
          // Opus 5 declines a small class of requests; server-side fallback re-runs them on the
          // recommended model in the same call rather than handing us a dead turn.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: {
            ...(options.effort ? { effort: options.effort } : {}),
            format: { type: "json_schema", schema: ANSWER_SCHEMA },
          },
          system: [
            { type: "text", text: prompt.stable, cache_control: { type: "ephemeral" } },
          ],
          messages: [{ role: "user", content: prompt.volatile }],
        } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

        const usage: Usage = {
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        };
        totals.inputTokens += usage.inputTokens;
        totals.outputTokens += usage.outputTokens;
        totals.cacheReadTokens += usage.cacheReadTokens;
        totals.cacheWriteTokens += usage.cacheWriteTokens;

        // Check stop_reason BEFORE reading content: on a refusal, content is empty or partial.
        if (response.stop_reason === "refusal") {
          totals.failures++;
          return {
            ok: false,
            failure: { kind: "refusal", detail: String(response.stop_details?.category ?? "unknown") },
          };
        }

        const text = response.content.find((block) => block.type === "text");
        if (!text || text.type !== "text") {
          totals.failures++;
          return { ok: false, failure: { kind: "invalid", detail: "no text block in response" } };
        }

        const validated = validateAnswer(JSON.parse(text.text), options.choiceCount);
        if ("kind" in validated) {
          totals.failures++;
          return { ok: false, failure: validated };
        }
        return { ok: true, answer: validated, usage };
      } catch (error) {
        totals.failures++;
        // Most-specific first, per the SDK's exception hierarchy; a bare catch would lose the
        // retryable/non-retryable distinction the classes exist to carry. Two notes verified against
        // @anthropic-ai/sdk 0.116: these are NAMED exports, not statics on the default export
        // (`Anthropic.RateLimitError` is undefined at runtime), and there is no `APIStatusError` in
        // the TypeScript SDK — that is the Python name; here the base class is `APIError`, carrying
        // `.status`. `APIConnectionError` extends `APIError`, so it must be checked first.
        if (error instanceof AuthenticationError) {
          return {
            ok: false,
            failure: {
              kind: "error",
              detail:
                "401 unauthorized — set ANTHROPIC_API_KEY (see .env) or re-run `ant auth login`",
            },
          };
        }
        if (error instanceof NotFoundError) {
          return { ok: false, failure: { kind: "error", detail: `unknown model: ${options.model}` } };
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
        return { ok: false, failure: { kind: "error", detail: String(error) } };
      }
    },
  };
}
