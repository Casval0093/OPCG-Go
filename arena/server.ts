// The board server. Zero dependencies: node:http, Server-Sent Events for push, fetch for images.
//
// WHY SSE AND NOT WEBSOCKETS
//
// Node 22 ships a WebSocket *client* but no server, and the engine's node_modules has no `ws`. The
// traffic here is one-directional push (board updates) plus occasional POSTs (a click), so SSE is a
// better fit than a dependency.
//
// THE INTEGRITY BOUNDARY IS ENFORCED HERE, NOT TRUSTED
//
// The server is handed `PlayerView`s by the driver and forwards ONLY the human seat's own view.
// It never sees `MatchState`. A spectator or opponent view is never sent to a playing client — which
// matters because the opponent's hand is `[null, null, ...]` in the human's projection and would be
// real card ids in theirs.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getCard } from "../../cards/src/runtime-catalog.ts";
import type { MatchSeat, PlayerView } from "../src/types.ts";
import type { Decision } from "./types.ts";
import type { PublicProgress } from "./driver.ts";

/** Official Bandai card art. Personal-use local cache only — never committed, never redistributed. */
const IMAGE_BASE = "https://en.onepiece-cardgame.com/images/cardlist/card";

export interface BoardPayload {
  seat: MatchSeat;
  view: PlayerView | null;
  progress: PublicProgress | null;
  decision: Decision | null;
  /** Set while the arena is waiting on this human. */
  awaitingYou: boolean;
  message: string | null;
}

/**
 * A human's answer. The `reason` is OPTIONAL and that is the whole design: at ~60 substantive
 * decisions per seat per game, a mandatory text box would be abandoned by the third turn and the
 * seat would stop being playable. So the board offers a box, sends whatever is in it, and never
 * blocks on it — which makes a typed reason a signal in itself, marking the positions Ping thought
 * were worth a note. `log.ts`'s `contested` filter uses exactly that.
 */
export interface HumanChoice {
  index: number;
  reason: string | null;
}

export interface ArenaServer {
  readonly url: string;
  /** Publish a new board state to every connected client. */
  publish(payload: Partial<BoardPayload>): void;
  /** Block until the human clicks a choice. Resolves with the chosen index and any typed reason. */
  awaitChoice(decision: Decision, view: PlayerView, rejection: string | null): Promise<HumanChoice>;
  close(): void;
}

function cardInfo(cardId: string) {
  const card = getCard(cardId);
  return {
    id: card.id,
    name: card.i18n.en.name,
    cardType: card.cardType,
    cost: "cost" in card ? card.cost : null,
    power: "power" in card ? card.power : null,
    counter: "counter" in card ? card.counter : null,
    life: "life" in card ? card.life : null,
    colors: card.color,
    traits: card.traits,
    attribute: "attribute" in card ? card.attribute : null,
    // `OPCardLocale` is { name, effect?, imageUrl? } — there is no separate trigger field; the
    // engine folds Trigger text into `effect`. And its `imageUrl` points at www.optcgapi.com, the
    // ONE host CLAUDE.md records as timing out on this machine, which is why the board derives art
    // from en.onepiece-cardgame.com instead of using the value the card carries.
    effect: card.i18n.en.effect ?? null,
  };
}

export function startServer(options: {
  seat: MatchSeat;
  port: number;
  cacheDir: string;
  webDir: string;
}): ArenaServer {
  const clients = new Set<ServerResponse>();
  let current: BoardPayload = {
    seat: options.seat,
    view: null,
    progress: null,
    decision: null,
    awaitingYou: false,
    message: "Waiting for the match to start…",
  };
  let pending: ((choice: HumanChoice) => void) | null = null;

  const broadcast = () => {
    const frame = `data: ${JSON.stringify(current)}\n\n`;
    for (const client of clients) client.write(frame);
  };

  const publish = (patch: Partial<BoardPayload>) => {
    current = { ...current, ...patch };
    broadcast();
  };

  const imagePath = (cardId: string) => resolve(options.cacheDir, `${cardId}.png`);

  async function serveImage(cardId: string, res: ServerResponse) {
    // Ids come from the projected view, but this is a URL path: refuse anything that is not a card
    // id before it can become a traversal.
    if (!/^[A-Za-z0-9-]{3,20}$/.test(cardId)) {
      res.writeHead(400).end("bad card id");
      return;
    }
    const path = imagePath(cardId);
    try {
      if (!existsSync(path)) {
        const response = await fetch(`${IMAGE_BASE}/${cardId}.png`);
        if (!response.ok) {
          res.writeHead(404).end("no art");
          return;
        }
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, Buffer.from(await response.arrayBuffer()));
      }
      res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=31536000" });
      res.end(readFileSync(path));
    } catch (error) {
      res.writeHead(502).end(String(error));
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(resolve(options.webDir, "board.html")));
      return;
    }

    if (url.pathname === "/api/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      clients.add(res);
      res.write(`data: ${JSON.stringify(current)}\n\n`);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (url.pathname.startsWith("/img/")) {
      void serveImage(url.pathname.slice("/img/".length).replace(/\.png$/, ""), res);
      return;
    }

    if (url.pathname.startsWith("/api/card/")) {
      const cardId = url.pathname.slice("/api/card/".length);
      try {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(cardInfo(cardId)));
      } catch {
        res.writeHead(404).end("{}");
      }
      return;
    }

    if (url.pathname === "/api/choose" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const payload = JSON.parse(body || "{}") as { index?: unknown; reason?: unknown };
        const index = Number(payload.index);
        if (!pending || !Number.isInteger(index)) {
          res.writeHead(409).end('{"ok":false}');
          return;
        }
        // Capped and trimmed here rather than in the browser: this is the boundary an arbitrary POST
        // can reach, and an unbounded string would go straight into every log line.
        const raw = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 600) : "";
        const resolvePending = pending;
        pending = null;
        publish({ awaitingYou: false, decision: null, message: "Resolving…" });
        res.writeHead(200).end('{"ok":true}');
        resolvePending({ index, reason: raw.length > 0 ? raw : null });
      });
      return;
    }

    res.writeHead(404).end("not found");
  });

  server.listen(options.port);
  const url = `http://localhost:${options.port}`;

  return {
    url,
    publish,
    awaitChoice(decision, view, rejection) {
      return new Promise<HumanChoice>((resolvePromise) => {
        pending = resolvePromise;
        publish({
          view,
          decision,
          awaitingYou: true,
          message: rejection ? `Rejected: ${rejection}` : null,
        });
      });
    },
    close() {
      for (const client of clients) client.end();
      server.close();
    },
  };
}
