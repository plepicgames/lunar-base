import { Console } from "node:console";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { afterEach, expect, test, vi } from "vitest";
import { builtinMaker } from "../bots/builtin/index.ts";
import { withFallback } from "../bots/fallback.ts";
import {
  applyChoice,
  eventFor,
  startGame,
  viewFor,
  type Choice,
  type GameConfig,
} from "../engine/index.ts";
import { serverMessageSchema, type ServerMessage } from "../protocol/messages.ts";
import { createLobby, type LobbyGameRoom } from "./lobby.ts";
import { MAX_TURNS } from "./limits.ts";
import { createRoom, type Room } from "./room.ts";
import { createSessions } from "./sessions.ts";
import { memoryConnection } from "./transport.ts";

type Update = Extract<ServerMessage, { type: "game.update" }>;
type Recording = { seat: number | null; messages: string[] };
type Frame = ReturnType<typeof startGame>;
type Played = {
  game: LobbyGameRoom;
  seed: string;
  frames: Frame[];
  recordings: Recording[];
};

function requireThat(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function present<T>(value: T | null | undefined): T {
  requireThat(value !== undefined && value !== null, "Missing test fixture value");
  return value;
}

function expectedUpdate(played: Played, seat: number | null, index: number): Update {
  const { state, events } = played.frames[index];
  const view = viewFor(state, seat);
  const result =
    state.result ??
    (state.turn.number > MAX_TURNS
      ? { reason: "turn_limit" as const, winners: [], scores: state.credits.map(() => 0) }
      : null);
  return {
    type: "game.update",
    game: played.game.id,
    seq: index + 1,
    view: {
      ...view,
      result,
      pending: result ? null : view.pending,
      players: view.players.map((player, i) => ({
        ...player,
        name: present(played.game.seats[i]).name,
        kind: present(played.game.seats[i]).kind,
        connected: true,
      })),
    },
    events: events.map((event) => eventFor(event, seat)).filter((event) => event !== null),
  };
}

/** Check original wire bytes, never a schema's possibly stripped output. */
function checkStream(played: Played, recording: Recording, credential: string): void {
  let updateIndex = 0;
  for (const [index, raw] of recording.messages.entries()) {
    const label = `seat ${String(recording.seat)} message ${String(index + 1)}`;
    requireThat(!raw.includes(played.seed), `${label}: seed leaked`);
    requireThat(!raw.includes(credential), `${label}: credential leaked`);
    requireThat(!/"(?:seed|rng)"\s*:/.test(raw), `${label}: private state field leaked`);
    for (const { state } of played.frames) {
      requireThat(!raw.includes(JSON.stringify(state.rng)), `${label}: RNG state leaked`);
    }
    requireThat(
      !raw.includes(JSON.stringify(played.frames[0].state.cards)),
      `${label}: instance-to-card table leaked`,
    );
    const message: unknown = JSON.parse(raw);
    const parsed = serverMessageSchema.safeParse(message);
    requireThat(parsed.success, `${label}: invalid server message`);
    if (parsed.data.type !== "game.update") continue;
    requireThat(updateIndex < played.frames.length, `${label}: unexpected update`);
    requireThat(
      isDeepStrictEqual(message, expectedUpdate(played, recording.seat, updateIndex)),
      `${label} (game.update seq ${String(parsed.data.seq)}): wrong seat projection`,
    );
    updateIndex++;
  }
  requireThat(updateIndex === played.frames.length, "Missing game updates");
}

function checkLogs(output: string, games: Played[], credential: string): void {
  const secrets = [credential, ...games.map((game) => game.seed)];
  const handCards = new Set<string>();
  for (const game of games) {
    for (const { state } of game.frames) {
      for (const hand of state.hands) {
        for (const instance of hand) {
          handCards.add(instance);
          handCards.add(state.cards[instance]);
        }
      }
    }
  }
  for (const [index, line] of output.split("\n").entries()) {
    const label = `stdout line ${String(index + 1)}`;
    requireThat(!secrets.some((secret) => line.includes(secret)), `${label}: secret leaked`);
    // c60 inside a UUID is not the card c60. Check complete identifiers,
    // including catalogue ids, in plain text and inspected/JSON objects.
    requireThat(
      !line.split(/[^a-zA-Z0-9_-]+/).some((token) => handCards.has(token)),
      `${label}: hand card leaked`,
    );
  }
}

async function play(config: GameConfig, bots: number, seed: string): Promise<Played> {
  let room: Room | undefined;
  let game: LobbyGameRoom | undefined;
  const choices: Choice[] = [];
  const lobby = createLobby({
    onStart(startedGame) {
      game = startedGame;
      const opening = startGame(config, seed);
      room = createRoom(game, {
        ...opening,
        botDelayMs: 0,
        makeBuiltinMaker: (seat) => builtinMaker(seed, seat),
        makeMaker(seat) {
          const maker = builtinMaker(seed, seat);
          return withFallback(maker, maker);
        },
        // Keep the accepted choices in memory for an independent engine replay.
        gameLog: { path: "memory", choice: (choice) => choices.push(structuredClone(choice)) },
        onLeave: (session) => {
          lobby.release(session);
        },
        onEmpty: () => undefined,
      });
    },
  });
  const sessions = createSessions({
    jev: false,
    onBound: (session) => {
      lobby.onBound(session);
    },
    onMessage: (session, message) => {
      (room?.has(session) ? room : lobby).onMessage(session, message);
    },
  });
  const clients = Array.from({ length: Math.max(1, config.seats - bots) }, (_, index) => {
    const seat = bots === config.seats ? null : index === 0 ? 0 : index + bots;
    const recording: Recording = { seat, messages: [] };
    const [connection, server] = memoryConnection();
    let latest: Update | undefined;
    connection.onMessage((raw) => {
      recording.messages.push(raw);
      const message = JSON.parse(raw) as ServerMessage;
      if (message.type === "game.update") latest = message;
    });
    sessions.accept(server);
    const send = (message: unknown) => {
      connection.send(JSON.stringify(message));
    };
    send({ type: "hello", protocol: 1, name: `Human ${String(index)}` });
    return {
      recording,
      connection,
      send,
      latest: () => latest,
      maker: builtinMaker(seed, seat ?? 0),
    };
  });
  try {
    clients[0].send({ type: "lobby.create", ...config, bots });
    for (const client of clients.slice(1)) {
      const message = JSON.parse(present(client.recording.messages.at(-1))) as ServerMessage;
      requireThat(message.type === "lobby.state", "Missing lobby state");
      client.send({ type: "lobby.join", game: message.games[0].id });
    }
    requireThat(!!game && !!room, "Game did not start");
    for (let steps = 0; !clients[0].latest()?.view.result && steps < 10_000; steps++) {
      const seat = clients[0].latest()?.view.pending?.seat;
      const human = clients.find((client) => client.recording.seat === seat);
      if (human) {
        const update = present(human.latest());
        const decision = update.view.pending;
        requireThat(!!decision && "id" in decision, "Missing human decision");
        const option = await human.maker.decide(
          {
            seat: present(seat),
            view: { ...update.view, result: null },
            decision,
            events: [...update.events],
          },
          new AbortController().signal,
        );
        human.send({ type: "game.decide", game: game.id, decision: decision.id, option });
      } else {
        await vi.advanceTimersByTimeAsync(1);
      }
    }
    const result = clients[0].latest()?.view.result;
    requireThat(!!result && result.reason !== "engine_error", "Game did not finish normally");
    const frames = [startGame(config, seed)];
    for (const choice of choices) {
      const applied = applyChoice(present(frames.at(-1)).state, choice);
      requireThat(applied.ok, "Recorded choice did not replay");
      frames.push({ state: applied.state, events: applied.events });
    }
    expect(room.getState()).toEqual(present(frames.at(-1)).state);
    return { game, seed, frames, recordings: clients.map((client) => client.recording) };
  } finally {
    // Cleanup traffic is outside the complete-game recording.
    for (const client of clients) client.connection.close();
    vi.clearAllTimers();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function captureStdout() {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  });
  // Vitest replaces console with its reporter; restore Node's real stdout route.
  vi.stubGlobal("console", new Console({ stdout: process.stdout, stderr: process.stderr }));
  return () => chunks.join("");
}

test("whole-game messages and stdout keep private data inside the server", async () => {
  const started = performance.now();
  vi.useFakeTimers();
  const output = captureStdout();
  // An inert sentinel generated at runtime; no live credential or network calls.
  const credential = `privacy-sentinel-${randomUUID()}`;
  vi.stubEnv("TYPESAFE_API_KEY", credential);
  const games: Played[] = [];
  for (const seats of [2, 3, 4, 5, 6]) {
    for (const influences of [false, true]) {
      for (const bots of [0, Math.floor(seats / 2), seats]) {
        const game = await play(
          { seats, influences, kickstarter: false },
          bots,
          `privacy-${String(seats)}-${String(influences)}-${String(bots)}`,
        );
        for (const recording of game.recordings) checkStream(game, recording, credential);
        games.push(game);
      }
    }
  }
  expect(games).toHaveLength(30);
  expect(output()).toContain("by=human");
  expect(output()).toContain("by=builtin");
  checkLogs(output(), games, credential);
  expect(performance.now() - started).toBeLessThan(20_000);
}, 20_000);

test("the stream checker names an update to A containing B's view", async () => {
  vi.useFakeTimers();
  captureStdout();
  const game = await play({ seats: 2, influences: true, kickstarter: false }, 0, "privacy-swap");
  const original = game.recordings[0];
  const index = original.messages.findIndex(
    (raw) => (JSON.parse(raw) as ServerMessage).type === "game.update",
  );
  const corrupted = structuredClone(original);
  const wrong = expectedUpdate(game, 1, 0);
  const actual = JSON.parse(corrupted.messages[index]) as Update;
  corrupted.messages[index] = JSON.stringify({ ...actual, view: wrong.view });
  expect(() => {
    checkStream(game, original, "unused-sentinel");
  }).not.toThrow();
  expect(() => {
    checkStream(game, corrupted, "unused-sentinel");
  }).toThrow(`seat 0 message ${String(index + 1)} (game.update seq 1): wrong seat projection`);
});

test("privacy checkers reject planted private fields and log values", async () => {
  vi.useFakeTimers();
  captureStdout();
  const game = await play({ seats: 2, influences: false, kickstarter: false }, 0, "privacy-plants");
  const original = game.recordings[0];
  const state = game.frames[0].state;
  const credential = `privacy-sentinel-${randomUUID()}`;
  for (const [extra, reason] of [
    [{ diagnostic: game.seed }, "seed leaked"],
    [{ diagnostic: credential }, "credential leaked"],
    [{ diagnostic: state.rng }, "RNG state leaked"],
    [{ diagnostic: state.cards }, "instance-to-card table leaked"],
  ] as const) {
    const corrupted = structuredClone(original);
    // A non-update message must be checked too, before schema parsing.
    corrupted.messages[0] = JSON.stringify({
      ...(JSON.parse(corrupted.messages[0]) as ServerMessage),
      ...extra,
    });
    expect(() => {
      checkStream(game, corrupted, credential);
    }).toThrow(`seat 0 message 1: ${reason}`);
  }
  const handCard = state.hands[0][0];
  for (const secret of [game.seed, credential]) {
    expect(() => {
      checkLogs(`safe line\nsecret=${secret}`, [game], credential);
    }).toThrow("stdout line 2: secret leaked");
  }
  for (const card of [handCard, state.cards[handCard]]) {
    expect(() => {
      checkLogs(`safe line\n${JSON.stringify({ hand: [card] })}`, [game], credential);
    }).toThrow("stdout line 2: hand card leaked");
  }
  expect(() => {
    checkLogs(`game=${handCard}01993d-76af-4254-9bd1-3e771f333b89`, [game], credential);
  }).not.toThrow();
});
