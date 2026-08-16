// Dump the engine's live card catalog to JSON for deckbuilding and analysis.
//
//   ./scripts/simulate.sh --dump-catalog
//
// Runs inside the engine because `allCards` is only assembled there. Everything downstream —
// picking a legal Block 2+ deck, checking a decklist resolves, auditing encoding coverage — can
// then work from plain JSON without a TypeScript toolchain.
//
// `hasEffects` is the field that matters for this project: it distinguishes a card whose effect is
// *executable* from one that merely has printed text. The OP15/OP16 shells generated in Task 1 have
// `effect` text and `hasEffects: false` until their encodings are authored.

import { test } from "vite-plus/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { allCards } from "@tcg/op-cards";

const run = process.env.SIM_DUMP_CATALOG === "1" ? test : test.skip;

run("dump catalog", () => {
  const root = process.env.SIM_ROOT ?? process.cwd();
  const out = resolve(root, process.env.SIM_CATALOG_OUT ?? "sim/catalog.json");

  const rows = allCards.map((c) => {
    const card = c as Record<string, unknown>;
    return {
      id: card.id as string,
      set: card.setId as string,
      name: card.name as string,
      cardType: card.cardType as string,
      color: (card.color ?? []) as string[],
      rarity: card.rarity as string,
      cost: card.cost ?? null,
      power: card.power ?? null,
      counter: card.counter ?? null,
      life: card.life ?? null,
      traits: (card.traits ?? []) as string[],
      attribute: card.attribute ?? null,
      hasEffectText: Boolean(card.effect),
      // Executable encoding present, as opposed to printed text. Alternate arts inherit this by
      // spread from their base printing, so it follows the spread rather than the file.
      hasEffects: Boolean(card.effects),
    };
  });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rows, null, 1));

  const bySet = new Map<string, number>();
  for (const r of rows) bySet.set(r.set, (bySet.get(r.set) ?? 0) + 1);
  console.log(`\nwrote ${out}: ${rows.length} cards across ${bySet.size} sets`);
  console.log(
    `encoded ${rows.filter((r) => r.hasEffects).length}, ` +
      `printed-text-only ${rows.filter((r) => r.hasEffectText && !r.hasEffects).length}, ` +
      `vanilla ${rows.filter((r) => !r.hasEffectText).length}`,
  );
}, 300_000);
