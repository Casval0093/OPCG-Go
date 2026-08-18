// Provider factory. A player config names a provider by string; this is the only place that maps a
// name to an implementation, and providers are constructed lazily so a DeepSeek-only tournament never
// requires an Anthropic key (or the reverse).

import { createAnthropicProvider } from "./anthropic.ts";
import { createDeepSeekProvider } from "./deepseek.ts";
import type { LlmProvider } from "./types.ts";

export type ProviderName = "anthropic" | "deepseek";

export const PROVIDERS: ProviderName[] = ["anthropic", "deepseek"];

const cache = new Map<ProviderName, LlmProvider>();

export function getProvider(name: ProviderName): LlmProvider {
  const existing = cache.get(name);
  if (existing) return existing;
  const created = name === "deepseek" ? createDeepSeekProvider() : createAnthropicProvider();
  cache.set(name, created);
  return created;
}

export type { LlmProvider } from "./types.ts";
export * from "./types.ts";
