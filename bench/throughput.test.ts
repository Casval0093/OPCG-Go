import { test } from "vite-plus/test";
import { runBotMatch } from "../../src/automation/bot-harness.ts";
import { valueRankedStrategy } from "../../src/automation/bot-strategies.ts";
import { eb01Doma005, eb01Fourtricks025, eb01Koza004, eb01MsMonday035, op13MonkeyDLuffy001 } from "@tcg/op-cards";
import type { MatchConfig } from "../../src/types.ts";

const DECK_CARDS = [eb01Doma005, eb01Koza004, eb01Fourtricks025, eb01MsMonday035];
function buildDeck(){ const d:string[]=[]; for(let i=0;i<50;i++) d.push(DECK_CARDS[i%4]!.id); return d; }
function cfg(seed:number): MatchConfig {
  return { firstPlayer: seed%2===0?"south":"north", seed, shuffleDecks:true, openingHandSize:5,
    skipFirstTurnDraw:true, maxCharacterSlots:5,
    players:{ south:{leaderCardId:op13MonkeyDLuffy001.id, mainDeck:buildDeck(), playerName:"S"},
              north:{leaderCardId:op13MonkeyDLuffy001.id, mainDeck:buildDeck(), playerName:"N"} } };
}
test("bench", () => {
  const N = 100;
  const t0 = process.hrtime.bigint();
  let cmds = 0, done = 0;
  for (let i=0;i<N;i++){
    const r = runBotMatch(cfg(1000+i), {south:valueRankedStrategy, north:valueRankedStrategy}, {maxCommands:500});
    cmds += r.totalCommands; if(r.winner) done++;
  }
  const ms = Number(process.hrtime.bigint()-t0)/1e6;
  console.log(`BENCH games=${N} decided=${done} ms=${ms.toFixed(0)} games/s=${(N/(ms/1000)).toFixed(2)} cmds=${cmds} cmds/s=${(cmds/(ms/1000)).toFixed(0)}`);
}, 300000);
