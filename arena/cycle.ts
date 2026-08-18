// Local loop guard, deliberately NOT `@tcg/bot-core`'s.
//
// WHY THIS IS DUPLICATED RATHER THAN IMPORTED
//
// `runBotMatch` uses `createSemanticCycleDetector` and `stableBotHash` from `@tcg/bot-core`. The
// arena cannot: that package's `src/index.ts` imports `./deadlock.js`, a `.js` specifier pointing at
// a `.ts` file. Vite rewrites those; Node's ESM resolver does not, and it fails with
// ERR_MODULE_NOT_FOUND. So the dependency surface for a plain-Node entry point is:
//
//   OK      packages/engine/src/**  (core, projection, shared, types), @tcg/op-cards
//   BROKEN  @tcg/bot-core, @tcg/engine-core  — hence also src/automation/bot-harness.ts
//
// That is the price of not hosting the arena inside vitest, and it is worth paying: vitest captures
// stdio, so a live HTTP server and a human at a keyboard are not options there.
//
// The consequence to be honest about: this fingerprint is not byte-comparable with the batch
// harness's, so "repeated-state" counts are not comparable between the two. Cycle detection is a
// safety net against a policy looping forever, not a measured quantity, so nothing downstream cares.

/** FNV-1a over a key-sorted serialisation. Deterministic across runs and machines. */
export function stableFingerprint(value: unknown): string {
  const seen = new WeakSet<object>();
  const serialise = (input: unknown): string => {
    if (input === null || input === undefined) return "null";
    if (typeof input !== "object") return JSON.stringify(input) ?? "null";
    if (seen.has(input as object)) return '"[circular]"';
    seen.add(input as object);
    if (Array.isArray(input)) return `[${input.map(serialise).join(",")}]`;
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialise(v)}`).join(",")}}`;
  };

  const text = serialise(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}:${text.length}`;
}

export interface CycleDetector {
  /** True once the same semantic state has been seen `threshold` times. */
  observe(fingerprint: string): { repeated: boolean; count: number };
}

/**
 * A state may legitimately recur — passing back and forth without acting is legal. The threshold is
 * what separates that from a policy that will never terminate.
 */
export function createCycleDetector(threshold = 3): CycleDetector {
  const counts = new Map<string, number>();
  return {
    observe(fingerprint: string) {
      const count = (counts.get(fingerprint) ?? 0) + 1;
      counts.set(fingerprint, count);
      return { repeated: count >= threshold, count };
    },
  };
}

/**
 * The volatile fields that must be excluded before fingerprinting: monotonic counters and the
 * append-only histories. Without this every state is unique and the detector never fires — the same
 * exclusion list `runBotMatch` uses.
 */
export function semanticState(state: unknown): unknown {
  return JSON.parse(
    JSON.stringify(state, (key, value) =>
      key === "idCounter" || key === "commandHistory" || key === "logHistory" ? undefined : value,
    ),
  );
}
