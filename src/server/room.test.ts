import { performance } from "node:perf_hooks";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pushAction } from "../engine/actions/index.ts";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  applyChoice,
  createGame,
  eventFor,
  startGame,
  viewFor,
  type GameState,
} from "../engine/index.ts";
import { builtinMaker } from "../bots/builtin/index.ts";
import { withFallback, type FallbackMaker } from "../bots/fallback.ts";
import { randomMaker, type DecisionMaker, type DecisionRequest } from "../bots/maker.ts";
import { serverMessageSchema, type ServerMessage } from "../protocol/messages.ts";
import { gameRegistry } from "../engine/game.ts";
import { push, run } from "../engine/loop.ts";
import { dealGame } from "../engine/setup.ts";
import { buildState } from "../engine/testing/build.ts";
import { pushTurn } from "../engine/turn.ts";
import { createLobby } from "./lobby.ts";
import { createGameLog, sweepGameLogs } from "./gamelog.ts";
import { replayFile } from "../../tools/replay.ts";
import { createRoom, type Room } from "./room.ts";
import { createSessions, PING_INTERVAL_MS, type Session } from "./sessions.ts";
import { memoryConnection } from "./transport.ts";

const seed = "room-test";
const initial = () =>
  createGame({ seats: 2, influences: false, kickstarter: false, startingSeat: 0 }, seed);
const opening = () =>
  startGame({ seats: 2, influences: false, kickstarter: false, startingSeat: 0 }, seed);
const create = (bots = 0) => ({
  type: "lobby.create",
  seats: 2,
  bots,
  influences: false,
  kickstarter: false,
});

/** A maker with no second one behind it: the room sees its answers as they are. */
function alone(maker: DecisionMaker): FallbackMaker {
  return withFallback(maker, maker);
}

function setup(
  options: {
    state?: GameState | ((roomIndex: number) => GameState);
    /** Wrapped with `alone`. */
    maker?: (seat: number) => DecisionMaker;
    makeMaker?: (seat: number) => FallbackMaker;
    /** `"environment"` leaves the delay to `LUNAR_BOT_DELAY_MS`. */
    delay?: number | "environment";
    takeoverDelayMs?: number;
    logDirectory?: string;
  } = {},
) {
  const rooms = new Map<string, Room>();
  const logs: string[] = [];
  const openLogs = new Set<string>();
  const roomFor = (session: Session) => [...rooms.values()].find((room) => room.has(session));
  const lobby = createLobby({
    onStart(game) {
      const started = opening();
      const room = createRoom(game, {
        state:
          typeof options.state === "function"
            ? options.state(rooms.size)
            : (options.state ?? started.state),
        events: options.state ? [] : started.events,
        gameLog: options.logDirectory
          ? createGameLog(game.id, started.state.config, seed, {
              log: (line) => logs.push(line),
              directory: options.logDirectory,
              open: openLogs,
            })
          : undefined,
        makeBuiltinMaker: (seat) => builtinMaker(seed, seat),
        makeMaker:
          options.makeMaker ??
          ((seat) => alone(options.maker ? options.maker(seat) : randomMaker(seed, seat))),
        ...(options.delay === "environment" ? {} : { botDelayMs: options.delay ?? 0 }),
        takeoverDelayMs: options.takeoverDelayMs,
        onLeave: (session) => {
          lobby.release(session);
        },
        onEmpty: () => {
          rooms.delete(game.id);
        },
        log: (line) => logs.push(line),
      });
      rooms.set(game.id, room);
    },
  });
  const sessions = createSessions({
    jev: false,
    onBound(session) {
      lobby.onBound(session);
      roomFor(session)?.onBound(session);
    },
    onDisconnect(session) {
      roomFor(session)?.onDisconnect(session);
    },
    onMessage(session, message) {
      (roomFor(session) ?? lobby).onMessage(session, message);
    },
  });
  function client(name: string, token?: string) {
    let answersPing = true;
    const [connection, server] = memoryConnection({ answersPing: () => answersPing });
    const received: ServerMessage[] = [];
    const closes: number[] = [];
    connection.onMessage((text) => received.push(serverMessageSchema.parse(JSON.parse(text))));
    connection.onClose((code) => closes.push(code));
    sessions.accept(server);
    const send = (message: unknown) => {
      connection.send(JSON.stringify(message));
    };
    send({ type: "hello", protocol: 1, name, token });
    const welcome = received[0];
    if (welcome.type !== "welcome") throw new Error("Expected welcome");
    return {
      send,
      connection,
      received,
      closes,
      /** From now on the socket is dead: it answers no ping of the server. */
      mute() {
        answersPing = false;
      },
      token: welcome.token,
      updates: () => received.filter((message) => message.type === "game.update"),
      update() {
        const update = this.updates().at(-1);
        if (!update) throw new Error("Expected game.update");
        return update;
      },
      answer() {
        const { game, view } = this.update();
        if (!view.pending || !("id" in view.pending)) throw new Error("Expected own decision");
        send({
          type: "game.decide",
          game,
          decision: view.pending.id,
          option: view.pending.options[0].id,
        });
      },
    };
  }
  function humans() {
    const a = client("A");
    const b = client("B");
    a.send(create());
    const state = b.received.at(-1);
    if (state?.type !== "lobby.state") throw new Error("Expected lobby.state");
    b.send({ type: "lobby.join", game: state.games[0].id });
    return [a, b] as const;
  }
  return { rooms, logs, openLogs, client, humans };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const failing: DecisionMaker = { decide: () => Promise.reject(new Error("no answer")) };

describe("game room", () => {
  test("a completed server game replays from its log and the command reports its result", () => {
    const directory = mkdtempSync(join(tmpdir(), "lunar-room-log-"));
    try {
      const { humans, rooms } = setup({ logDirectory: directory });
      const [a, b] = humans();
      for (let n = 0; n < 10000 && !a.update().view.result; n++) {
        (a.update().view.pending?.seat === 0 ? a : b).answer();
      }
      const result = a.update().view.result;
      expect(result).not.toBeNull();
      const file = join(directory, `${a.update().game}.jsonl`);
      const replay = replayFile(file);
      expect(replay.state).toEqual(rooms.get(a.update().game)?.getState());
      expect(replay.result).toEqual(result);
      expect(replay.view.turn).toEqual(a.update().view.turn);
      expect(a.update().view.players).toMatchObject(replay.view.players);
      const command = spawnSync("npm", ["run", "--silent", "replay", "--", file], {
        encoding: "utf8",
      });
      expect(command.status).toBe(0);
      expect(command.stdout).toContain(`result=${String(result?.reason)}`);
      expect(command.stdout).toContain(`winners=${JSON.stringify(result?.winners)}`);
      expect(readFileSync(file, "utf8")).toContain('"by":"human"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test("a Cascade cycle reports step_limit to both seats while another room answers within 1 second", () => {
    // Building Bacon Printer leaves only Cascade in hand. Its Draw finds an
    // empty Deck, then its Discard starts the forced Draw/Discard cycle.
    const bases = buildState([{ station: "stn-shackleton" }, { station: "stn-shackleton" }]);
    const cycle = run(
      pushAction(
        {
          ...dealGame({ seats: 2, influences: true, kickstarter: false, startingSeat: 0 }, seed),
          ...bases,
          cards: { ...bases.cards, bacon: "mod-bacon-printer", cascade: "inf-entropic-cascade" },
          hands: [["bacon", "cascade"], []],
          credits: [3, 0],
          deck: [],
          discard: [],
          supply: [],
          removedStations: [],
        },
        { op: "build", n: 1 },
        0,
      ),
      gameRegistry,
    ).state;
    expect(cycle.result).toBeNull();
    const build = cycle.pending?.options.find(({ card }) => card === "bacon");
    if (!build || !cycle.pending) throw new Error("Expected Bacon Printer Build choice");
    const { humans, client, rooms } = setup({
      state: (index) => (index === 0 ? cycle : initial()),
    });
    const [a, b] = humans();
    const c = client("C");
    const d = client("D");
    c.send(create());
    const lobby = d.received.at(-1);
    if (lobby?.type !== "lobby.state") throw new Error("Expected lobby.state");
    d.send({ type: "lobby.join", game: lobby.games[0].id });
    expect(rooms.size).toBe(2);
    const nextSeq = c.update().seq + 1;
    const started = performance.now();
    a.send({
      type: "game.decide",
      game: a.update().game,
      decision: cycle.pending.id,
      option: build.id,
    });
    c.answer();
    for (const seat of [a, b]) {
      expect(seat.update().view.result).toEqual({
        reason: "step_limit",
        winners: [],
        scores: [0, 0],
      });
      expect(seat.update().view.pending).toBeNull();
      expect(seat.update().events.filter(({ type }) => type === "game_ended")).toMatchObject([
        { reason: "step_limit", winners: [] },
      ]);
    }
    for (const seat of [c, d]) {
      expect(seat.update().seq).toBe(nextSeq);
      expect(seat.update().view.result).toBeNull();
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("Spybot.py's bot receives the private look in its next request; a third bot does not", async () => {
    vi.useFakeTimers();
    const config = { seats: 3, influences: false, kickstarter: false, startingSeat: 0 };
    const bases = buildState(Array.from({ length: 3 }, () => ({ station: "stn-shackleton" })));
    const state = run(
      pushTurn({
        ...dealGame(config, "spy-room"),
        ...bases,
        cards: {
          ...bases.cards,
          spy: "agt-spybot-py",
          a: "mod-inflatable-habitat",
          b: "mod-bacon-printer",
          c: "mod-rover-1",
        },
        hands: [["spy"], ["a", "b"], []],
        credits: [0, 0, 0],
        deck: ["c"],
        supply: [],
        discard: [],
        removedStations: [],
      }),
      gameRegistry,
    ).state;
    const requests: DecisionRequest[] = [];
    const { client, logs } = setup({
      state,
      maker: () => ({
        decide(request) {
          requests.push(structuredClone(request));
          const decision = request.decision;
          const option =
            decision.kind === "agent"
              ? "spy"
              : decision.kind === "target"
                ? "1"
                : decision.kind === "choose_one"
                  ? "1"
                  : decision.options[0].id;
          // Pause when the third seat is reached, so the test sees one resolution.
          return request.seat === 2 ? new Promise<string>(() => {}) : Promise.resolve(option);
        },
      }),
    });
    const watcher = client("Watcher");
    watcher.send({ ...create(3), seats: 3 });
    for (let step = 0; step < 30 && !requests.some((request) => request.seat === 2); step++) {
      await vi.advanceTimersByTimeAsync(1);
    }
    const choice = requests.find((request) => request.decision.kind === "choose_one");
    expect(choice?.seat).toBe(0);
    expect(choice?.events).toContainEqual({
      type: "hand_seen",
      looker: 0,
      opponent: 1,
      cards: [
        { instance: "a", cardId: "mod-inflatable-habitat" },
        { instance: "b", cardId: "mod-bacon-printer" },
      ],
      text: "Player 1 looked at Player 2's hand: Inflatable Habitat, Bacon Printer.",
    });
    expect(choice?.view.players[1].handSize).toBe(2);
    expect(choice?.view.hand).toEqual([]);
    const discard = requests.find((request) => request.decision.kind === "discard");
    expect(discard?.seat).toBe(1);
    const third = requests.find((request) => request.seat === 2);
    expect(third).toBeDefined();
    for (const events of [
      discard?.events,
      third?.events,
      watcher.updates().flatMap((update) => update.events),
    ]) {
      expect(events?.filter((event) => event.type === "hand_seen")).toEqual([
        { type: "hand_seen", looker: 0, opponent: 1, text: "Player 1 looked at Player 2's hand." },
      ]);
    }
    // One line per applied decision, and no line that reports a fault.
    expect(logs.length).toBe(watcher.update().seq - 1);
    for (const line of logs) expect(line).toMatch(/ decision=\S+ by=builtin$/);
  });

  test("Blood Moon's drafter gets the seen hand in request.events, while the opponent and spectators do not", async () => {
    vi.useFakeTimers();
    const bases = buildState(Array.from({ length: 3 }, () => ({ station: "stn-shackleton" })));
    const start = {
      ...dealGame({ seats: 3, influences: true, kickstarter: true, startingSeat: 0 }, "blood-room"),
      ...bases,
      cards: {
        ...bases.cards,
        blood: "ks-inf-blood-moon",
        module: "mod-inflatable-habitat",
        solicitor: "agt-solicitor",
        spy: "agt-spybot-py",
        defence: "inf-terran-embargo",
        filler: "mod-rover-1",
        filler2: "mod-rover-2",
      },
      hands: [[], ["solicitor", "module", "spy", "defence"], []],
      credits: [0, 0, 0],
      deck: [],
      supply: ["blood", "filler", "filler2"],
      discard: [],
      removedStations: [],
    };
    // The second Draft requests a decision from the looker after Blood Moon.
    const state = run(
      push(start, "box", {
        seat: 0,
        actions: [{ op: "draft", n: 2 }],
        position: 0,
        repeated: 0,
        deferred: [],
      }),
      gameRegistry,
    ).state;
    const requests: DecisionRequest[] = [];
    const { client, logs } = setup({
      state,
      maker: () => ({
        decide(request) {
          requests.push(structuredClone(request));
          if (request.events.some(({ type }) => type === "hand_seen") && request.seat === 0) {
            return new Promise<string>(() => {});
          }
          const decision = request.decision;
          const option =
            decision.kind === "draft"
              ? "blood"
              : decision.kind === "target"
                ? "1"
                : decision.kind === "discard"
                  ? "spy"
                  : decision.options[0].id;
          return Promise.resolve(option);
        },
      }),
    });
    const watcher = client("Watcher");
    // The public lobby still gates Kickstarter; setup injects the expansion state.
    watcher.send({ ...create(3), seats: 3, influences: true });
    for (
      let step = 0;
      step < 30 &&
      !requests.some(
        (request) => request.seat === 0 && request.events.some(({ type }) => type === "hand_seen"),
      );
      step++
    ) {
      await vi.advanceTimersByTimeAsync(1);
    }
    const after = requests.find(
      (request) => request.seat === 0 && request.events.some(({ type }) => type === "hand_seen"),
    );
    expect(after).toBeDefined();
    expect(after?.events).toContainEqual({
      type: "hand_seen",
      looker: 0,
      opponent: 1,
      cards: [
        { instance: "solicitor", cardId: "agt-solicitor" },
        { instance: "module", cardId: "mod-inflatable-habitat" },
        { instance: "spy", cardId: "agt-spybot-py" },
        { instance: "defence", cardId: "inf-terran-embargo" },
      ],
      text: "Player 1 looked at Player 2's hand: Solicitor, Inflatable Habitat, Spybot.py, Terran Embargo.",
    });
    expect(after?.view.players[1].handSize).toBe(2);
    expect(after?.view.discard.map(({ instance }) => instance)).toEqual(["spy", "solicitor"]);
    const discard = requests.find((request) => request.decision.kind === "discard");
    expect(discard?.seat).toBe(1);
    expect(requests.some((request) => request.decision.kind === "defence")).toBe(false);
    for (const events of [discard?.events, watcher.updates().flatMap((update) => update.events)]) {
      expect(events?.filter(({ type }) => type === "hand_seen")).toEqual([
        { type: "hand_seen", looker: 0, opponent: 1, text: "Player 1 looked at Player 2's hand." },
      ]);
    }
    expect(logs.length).toBe(watcher.update().seq - 1);
    for (const line of logs) expect(line).toMatch(/ decision=\S+ by=builtin$/);
  });

  test("a Dome gives Resell options only to the non-active human seat", () => {
    const dealt = dealGame(
      { seats: 2, influences: false, kickstarter: false, startingSeat: 0 },
      seed,
    );
    const bases = buildState([{ station: "stn-shackleton" }, { station: "stn-shackleton" }]);
    const state = run(
      pushTurn({
        ...dealt,
        ...bases,
        cards: {
          ...bases.cards,
          dome: "mod-hayashi-dome",
          a: "agt-investor",
          b: "mod-inflatable-habitat",
          c: "mod-bacon-printer",
        },
        hands: [["dome"], []],
        credits: [3, 0],
        supply: ["a", "b", "c"],
        deck: [],
        discard: [],
        removedStations: [],
      }),
      gameRegistry,
    ).state;
    const [a, b] = setup({ state }).humans();
    const select = (
      predicate: (option: { id: string; label: string; card?: string }) => boolean,
    ) => {
      const { game, view } = a.update();
      if (!view.pending || !("id" in view.pending)) throw new Error("Expected own decision");
      const option = view.pending.options.find(predicate);
      if (!option) throw new Error("Expected option");
      a.send({ type: "game.decide", game, decision: view.pending.id, option: option.id });
    };
    select((option) => option.label === "Terran Outpost: Build");
    select((option) => option.card === "dome");
    expect(a.update().view.turn.seat).toBe(0);
    expect(a.update().view.pending).toEqual({ seat: 1, kind: "resell" });
    const decision = b.update().view.pending;
    if (!decision || !("id" in decision)) throw new Error("Expected opponent decision");
    expect(decision).toMatchObject({ seat: 1, kind: "resell" });
    expect(decision.options.map((option) => option.id)).toEqual(["a", "b", "c"]);
    a.send({ type: "game.decide", game: a.update().game, decision: decision.id, option: "a" });
    expect(a.received.at(-1)).toMatchObject({ code: "not_your_decision" });
    b.answer();
    expect(a.update().view.pending).toEqual({ seat: 1, kind: "resell" });
    expect(b.update().view.pending).toMatchObject({ seat: 1, kind: "resell" });
    expect(a.update().events).toContainEqual(
      expect.objectContaining({ type: "card_resold", seat: 1 }),
    );
    b.answer();
    expect(b.update().view.players[1].credits).toBe(2);
    expect(a.update().view.players[0].credits).toBe(0);
  });

  test("opening events reach each human's first update and resume history exactly once", () => {
    const { humans, client } = setup();
    const [a, b] = humans();
    expect(opening().events.map((event) => event.type)).toEqual(["game_started", "turn_started"]);
    for (const [seat, human] of [a, b].entries()) {
      const expected = opening()
        .events.map((event) => eventFor(event, seat))
        .filter((event) => event !== null);
      expect(human.updates()[0].events).toEqual(expected);
      human.connection.close();
      const resumed = client(seat === 0 ? "A" : "B", human.token);
      expect(resumed.update().events).toEqual(expected);
      resumed.connection.close();
      expect(client(seat === 0 ? "A" : "B", human.token).update().events).toEqual(expected);
    }
  });

  test("one queued choice sends each human its next view and only its projected events", () => {
    const { humans } = setup();
    const [a, b] = humans();
    const state = initial();
    const pending = state.pending;
    if (!pending) throw new Error("Expected decision");
    const applied = applyChoice(state, {
      seat: 0,
      decision: pending.id,
      option: pending.options[0].id,
    });
    if (!applied.ok) throw new Error("Expected accepted choice");
    const seq = a.update().seq;
    a.answer();
    for (const [seat, client] of [a, b].entries()) {
      const view = viewFor(applied.state, seat);
      expect(client.updates()).toHaveLength(2);
      expect(client.update()).toEqual({
        type: "game.update",
        game: a.update().game,
        seq: seq + 1,
        view: {
          ...view,
          players: view.players.map((player, index) => ({
            ...player,
            name: index === 0 ? "A" : "B",
            kind: "human",
            connected: true,
          })),
        },
        events: applied.events
          .map((event) => eventFor(event, seat))
          .filter((event) => event !== null),
      });
    }
  });

  test("a reply during broadcast waits until every seat received the current update", () => {
    const { humans } = setup();
    const [a, b] = humans();
    let answered = false;
    a.connection.onMessage((text) => {
      const message = serverMessageSchema.parse(JSON.parse(text));
      if (
        !answered &&
        message.type === "game.update" &&
        message.view.pending &&
        "id" in message.view.pending
      ) {
        answered = true;
        a.answer();
      }
    });
    a.answer();
    expect(answered).toBe(true);
    expect(a.updates().map((update) => update.seq)).toEqual([1, 2, 3]);
    expect(b.updates().map((update) => update.seq)).toEqual([1, 2, 3]);
  });

  test("each bot request equals its engine view and last 200 projected events", async () => {
    vi.useFakeTimers();
    let oracle = initial();
    const histories = [0, 1].map((seat) => opening().events.map((event) => eventFor(event, seat)));
    const captured: { actual: DecisionRequest; expected: DecisionRequest }[] = [];
    const { client } = setup({
      maker(seat) {
        return {
          decide(request) {
            const view = viewFor(oracle, seat);
            const decision = oracle.pending;
            if (!decision) throw new Error("Expected decision");
            captured.push({
              actual: structuredClone(request),
              expected: {
                view,
                decision,
                seat,
                events: histories[seat].filter((event) => event !== null).slice(-200),
              },
            });
            const option = decision.options[0].id;
            const applied = applyChoice(oracle, { seat, decision: decision.id, option });
            if (!applied.ok) throw new Error("Expected accepted choice");
            oracle = applied.state;
            histories.forEach((history, index) =>
              history.push(...applied.events.map((event) => eventFor(event, index))),
            );
            return Promise.resolve(option);
          },
        };
      },
    });
    let a = client("A");
    a.send(create(2));
    const publicOpening = opening()
      .events.map((event) => eventFor(event, null))
      .filter((event) => event !== null);
    expect(a.update().events).toEqual(publicOpening);
    a.connection.close();
    a = client("A", a.token);
    expect(a.update().events).toEqual(publicOpening);
    // Verify truncation for both seats without playing an entire seed-dependent game.
    const bothTruncated = () =>
      [0, 1].every((seat) =>
        captured.some(({ actual }) => actual.seat === seat && actual.events.length === 200),
      );
    for (let count = 0; count < 10000 && !bothTruncated() && !a.update().view.result; count++) {
      await vi.advanceTimersToNextTimerAsync();
    }
    expect(bothTruncated()).toBe(true);
    for (const { actual, expected } of captured) expect(actual).toEqual(expected);
  });

  test("rejects wrong seat, unknown option, wrong game and a duplicate decision", () => {
    const { humans } = setup();
    const [a, b] = humans();
    const { game, view } = a.update();
    if (!view.pending || !("id" in view.pending)) throw new Error("Expected own decision");
    const message = {
      type: "game.decide",
      game,
      decision: view.pending.id,
      option: view.pending.options[0].id,
    };
    b.send(message);
    expect(b.received.at(-1)).toMatchObject({ code: "not_your_decision" });
    a.send({ ...message, option: "absent" });
    expect(a.received.at(-1)).toMatchObject({ code: "bad_option" });
    a.send({ ...message, game: "absent" });
    expect(a.received.at(-1)).toMatchObject({ code: "game_not_found" });
    expect(a.updates()).toHaveLength(1);
    a.send(message);
    a.send(message);
    expect(a.received.at(-1)).toMatchObject({ code: "stale_decision" });
    expect(a.updates()).toHaveLength(2);
  });

  test("an absent seat is answered by builtin at 60 seconds, then on later decisions", async () => {
    vi.useFakeTimers();
    const { humans, logs } = setup({
      delay: 700,
      makeMaker: (seat) => withFallback(failing, builtinMaker(seed, seat)),
    });
    const [a, b] = humans();
    const pending = b.update().view.pending;
    a.connection.close();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(b.update().view.pending).toEqual(pending);
    expect(logs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(b.update().view.pending).not.toEqual(pending);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/seat=0 .* by=builtin$/);
    expect(b.update().view.players[0]).toMatchObject({ kind: "human", connected: false });
    for (
      let count = 0;
      count < 100 && logs.filter((line) => line.includes("by=builtin")).length < 3;
      count++
    ) {
      if (b.update().view.pending?.seat === 1) b.answer();
      else await vi.advanceTimersByTimeAsync(700);
    }
    expect(logs.filter((line) => line.includes("by=builtin")).length).toBeGreaterThanOrEqual(3);
  });

  test("a configured one-second grace period answers an absent seat", async () => {
    vi.useFakeTimers();
    const { humans, logs } = setup({ takeoverDelayMs: 1000 });
    const [a, b] = humans();
    const pending = b.update().view.pending;
    a.connection.close();
    await vi.advanceTimersByTimeAsync(999);
    expect(b.update().view.pending).toEqual(pending);
    expect(logs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.update().view.pending).not.toEqual(pending);
    expect(logs[0]).toMatch(/seat=0 .* by=builtin$/);
  });

  test("resume at 30 seconds cancels takeover and the player answers", async () => {
    vi.useFakeTimers();
    const { humans, client, logs } = setup();
    const [a] = humans();
    a.connection.close();
    await vi.advanceTimersByTimeAsync(30_000);
    const resumed = client("A", a.token);
    const pending = resumed.update().view.pending;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resumed.update().view.pending).toEqual(pending);
    expect(logs).toEqual([]);
    resumed.answer();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/ by=human$/);
  });

  test("after takeover a resumed seat's next pending decision waits for the player", async () => {
    vi.useFakeTimers();
    const { humans, client, logs } = setup({ delay: 700 });
    const [a, b] = humans();
    a.connection.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(logs.some((line) => line.includes("by=builtin"))).toBe(true);
    const resumed = client("A", a.token);
    // A request already being paced may finish; the following decision is human's.
    await vi.advanceTimersByTimeAsync(700);
    for (let count = 0; count < 100 && resumed.update().view.pending?.seat !== 0; count++)
      b.answer();
    expect(resumed.update().view.pending?.seat).toBe(0);
    const pending = resumed.update().view.pending;
    const before = logs.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resumed.update().view.pending).toEqual(pending);
    expect(logs).toHaveLength(before);
    resumed.answer();
    expect(logs.at(-1)).toMatch(/seat=0 .* by=human$/);
  });

  test("resume during a paced takeover keeps that answer and gives the following decision to the human", async () => {
    vi.useFakeTimers();
    const { humans, client, logs } = setup({ delay: 700 });
    const [a, b] = humans();
    a.connection.close();
    await vi.advanceTimersByTimeAsync(60_000);
    // Let the other human play until an absent-seat request starts its pacing timer.
    for (let count = 0; count < 100 && b.update().view.pending?.seat === 1; count++) b.answer();
    expect(b.update().view.pending?.seat).toBe(0);
    const before = logs.length;
    const resumed = client("A", a.token);
    const pending = resumed.update().view.pending;
    resumed.answer();
    expect(resumed.received.at(-1)).toMatchObject({ code: "not_your_decision" });
    await vi.advanceTimersByTimeAsync(699);
    expect(resumed.update().view.pending).toEqual(pending);
    expect(logs).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(logs).toHaveLength(before + 1);
    expect(logs.at(-1)).toMatch(/seat=0 .* by=builtin$/);
    for (let count = 0; count < 100 && resumed.update().view.pending?.seat === 1; count++)
      b.answer();
    const next = resumed.update().view.pending;
    expect(next?.seat).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resumed.update().view.pending).toEqual(next);
    resumed.answer();
    expect(logs.at(-1)).toMatch(/seat=0 .* by=human$/);
  });

  test("a second disconnect gets a fresh grace period after a resume", async () => {
    vi.useFakeTimers();
    const { humans, client, logs } = setup({ delay: 700 });
    const [a] = humans();
    a.connection.close();
    await vi.advanceTimersByTimeAsync(30_000);
    const resumed = client("A", a.token);
    resumed.connection.close();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(logs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/seat=0 .* by=builtin$/);
  });

  test("the grace period starts at disconnect, even before that seat owes a decision", async () => {
    vi.useFakeTimers();
    const { humans, logs } = setup();
    const [a, b] = humans();
    b.connection.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(logs).toEqual([]);
    for (let count = 0; count < 100 && a.update().view.pending?.seat === 0; count++) a.answer();
    expect(a.update().view.pending?.seat).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(logs.some((line) => /seat=1 .* by=builtin$/.test(line))).toBe(true);
  });

  test("a seat already disconnected in the lobby retains its disconnect deadline at game start", async () => {
    vi.useFakeTimers();
    const { client, logs } = setup();
    const a = client("A");
    const b = client("B");
    a.send(create());
    const lobby = b.received.at(-1);
    if (lobby?.type !== "lobby.state") throw new Error("Expected lobby");
    a.connection.close();
    await vi.advanceTimersByTimeAsync(30_000);
    b.send({ type: "lobby.join", game: lobby.games[0].id });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(logs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(logs[0]).toMatch(/seat=0 .* by=builtin$/);
  });

  test("leave permanently gives the seat to builtin, returns to lobby, and play reaches a result", async () => {
    vi.useFakeTimers();
    const { humans, client, logs } = setup({
      makeMaker: (seat) => withFallback(failing, builtinMaker(seed, seat)),
    });
    const [a, b] = humans();
    const game = a.update().game;
    a.send({ type: "game.leave" });
    expect(a.received.at(-1)).toEqual({ type: "lobby.state", games: [] });
    expect(b.update().view.players[0]).toMatchObject({ name: "A", kind: "bot", connected: true });
    const resumed = client("A", a.token);
    expect(resumed.received.map((message) => message.type)).toEqual(["welcome", "lobby.state"]);
    // Old game messages cannot regain the abandoned seat.
    resumed.send({ type: "game.decide", game, decision: "old", option: "old" });
    for (let count = 0; count < 10_000 && !b.update().view.result; count++) {
      if (b.update().view.pending?.seat === 1) b.answer();
      else await vi.advanceTimersToNextTimerAsync();
    }
    expect(b.update().view.result).not.toBeNull();
    const takeover = logs.filter((line) => line.includes("seat=0"));
    expect(takeover.length).toBeGreaterThan(0);
    expect(takeover.every((line) => line.endsWith("by=builtin"))).toBe(true);
  });

  test.each([0, 1, 2])(
    "last participant leaving drops a running room and stops bot work (bots=%i)",
    async (bots) => {
      vi.useFakeTimers();
      const { humans, client, rooms, logs } = setup({ delay: 700 });
      const [a, b] = bots === 0 ? humans() : [client("A"), null];
      if (bots) a.send(create(bots));
      const game = a.update().game;
      a.send({ type: "game.leave" });
      if (b) {
        expect(rooms.has(game)).toBe(true);
        b.send({ type: "game.leave" });
      }
      expect(rooms.has(game)).toBe(false);
      const before = logs.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(logs).toHaveLength(before);
      a.send(create());
      expect(a.received.at(-1)).toMatchObject({ type: "lobby.state", games: [{ creator: "A" }] });
    },
  );

  test("dropping the room aborts an already-running maker and ignores its late answer", async () => {
    vi.useFakeTimers();
    let pending: { signal: AbortSignal; finish: () => void } | undefined;
    const { client, rooms, logs } = setup({
      delay: 700,
      maker: () => ({
        decide: (request, signal) =>
          new Promise<string>((resolve) => {
            pending = {
              signal,
              finish: () => {
                resolve(request.decision.options[0].id);
              },
            };
          }),
      }),
    });
    const a = client("A");
    a.send(create(2));
    await vi.advanceTimersByTimeAsync(1);
    if (!pending) throw new Error("Expected a maker already thinking");
    expect(pending.signal.aborted).toBe(false);
    a.send({ type: "game.leave" });
    expect(rooms.size).toBe(0);
    expect(pending.signal.aborted).toBe(true);
    pending.finish();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(logs).toEqual([]);
    expect(a.received.at(-1)).toEqual({ type: "lobby.state", games: [] });
  });

  test("a human answering first options and a random bot finish, with bounded private bot histories", async () => {
    vi.useFakeTimers();
    const requests: DecisionRequest[] = [];
    const { client } = setup({
      maker(seat) {
        const maker = randomMaker(seed, seat);
        return {
          decide(request, signal) {
            requests.push(structuredClone(request));
            return maker.decide(request, signal);
          },
        };
      },
    });
    const a = client("A");
    a.send(create(1));
    for (let count = 0; count < 10000 && !a.update().view.result; count++) {
      if (a.update().view.pending?.seat === 0) a.answer();
      else await vi.advanceTimersToNextTimerAsync();
    }
    expect(a.update().view.result).not.toBeNull();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((request) => request.events.length > 0)).toBe(true);
    for (const request of requests) {
      expect(request.view.you).toBe(1);
      expect(request.decision).toEqual(request.view.pending);
      expect(request.events.length).toBeLessThanOrEqual(200);
      expect(
        request.events
          .filter((event) => event.type === "card_drawn" && event.seat === 0)
          .every((event) => !("card" in event)),
      ).toBe(true);
    }
  });

  test("a bot waits the minimum delay and cannot apply an unoffered option", async () => {
    vi.useFakeTimers();
    const { client, logs } = setup({
      delay: 700,
      maker: () => ({ decide: () => Promise.resolve("not-offered") }),
    });
    const a = client("A");
    a.send(create(2));
    const before = a.update();
    expect(before.view.you).toBeNull();
    expect(before.view.hand).toEqual([]);
    await vi.advanceTimersByTimeAsync(699);
    expect(logs).toEqual([]);
    expect(a.updates()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.update()).toEqual(before);
    expect(logs.join("\n")).toContain("bad_option");
  });

  test("a human's choice logs one line with the label human", () => {
    const { humans, logs } = setup();
    const [a] = humans();
    const { game, view } = a.update();
    a.answer();
    expect(logs).toEqual([`game=${game} seat=0 decision=${String(view.pending?.kind)} by=human`]);
    // A refused choice is no decision.
    a.send({ type: "game.decide", game, decision: "absent", option: "absent" });
    expect(logs).toHaveLength(1);
  });

  test("a game with non-human seats and no credential is decided by the built-in maker; each decision logs one line with the label builtin", async () => {
    vi.useFakeTimers();
    const { client, logs } = setup({
      makeMaker(seat) {
        const builtin = builtinMaker(seed, seat);
        return withFallback(builtin, builtin);
      },
    });
    const a = client("A");
    a.send(create(2));
    for (let count = 0; count < 10000 && !a.update().view.result; count++) {
      await vi.advanceTimersToNextTimerAsync();
    }
    // The same game through the engine, decided by the built-in maker alone.
    let oracle = opening().state;
    const histories = [0, 1].map((seat) =>
      opening()
        .events.map((event) => eventFor(event, seat))
        .filter((event) => event !== null),
    );
    const makers = [0, 1].map((seat) => builtinMaker(seed, seat));
    const expected: string[] = [];
    while (oracle.pending && !oracle.result && oracle.turn.number <= 300) {
      const { id, seat, kind } = oracle.pending;
      const view = viewFor(oracle, seat);
      if (!view.pending || !("id" in view.pending)) throw new Error("Expected own decision");
      const option = await makers[seat].decide(
        { view, decision: view.pending, seat, events: histories[seat].slice(-200) },
        new AbortController().signal,
      );
      const applied = applyChoice(oracle, { seat, decision: id, option });
      if (!applied.ok) throw new Error("Expected accepted choice");
      oracle = applied.state;
      histories.forEach((history, index) =>
        history.push(
          ...applied.events
            .map((event) => eventFor(event, index))
            .filter((event) => event !== null),
        ),
      );
      expected.push(`game=${a.update().game} seat=${String(seat)} decision=${kind} by=builtin`);
    }
    expect(expected.length).toBeGreaterThan(20);
    expect(logs).toEqual(expected);
    expect(a.update().seq).toBe(expected.length + 1);
    const view = viewFor(oracle, null);
    expect(a.update().view).toMatchObject({
      turn: view.turn,
      result: oracle.result ?? { reason: "turn_limit", winners: [], scores: [0, 0] },
      players: view.players,
    });
  });

  test("a primary that rejects at once still gives an answer, and never earlier than LUNAR_BOT_DELAY_MS", async () => {
    vi.useFakeTimers();
    vi.stubEnv("LUNAR_BOT_DELAY_MS", "300");
    const { client, logs } = setup({
      delay: "environment",
      makeMaker: (seat) => withFallback(failing, builtinMaker(seed, seat)),
    });
    const a = client("A");
    a.send(create(2));
    const { game, seq, view } = a.update();
    await vi.advanceTimersByTimeAsync(299);
    expect(a.update().seq).toBe(seq);
    expect(logs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.update().seq).toBe(seq + 1);
    expect(logs).toEqual([
      `game=${game} seat=0 decision=${String(view.pending?.kind)} by=builtin-after-jev-failure`,
    ]);
    vi.clearAllTimers();
  });

  test("a primary that never answers costs the 8 s budget, not the budget and the delay", async () => {
    vi.useFakeTimers();
    const { client, logs } = setup({
      delay: 700,
      makeMaker: (seat) =>
        withFallback({ decide: () => new Promise<string>(() => {}) }, builtinMaker(seed, seat)),
    });
    const a = client("A");
    a.send(create(2));
    const seq = a.update().seq;
    await vi.advanceTimersByTimeAsync(7_999);
    expect(a.update().seq).toBe(seq);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.update().seq).toBe(seq + 1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/ by=builtin-after-jev-failure$/);
    vi.clearAllTimers();
  });

  test("a primary that names an unoffered option does not stall the game", async () => {
    vi.useFakeTimers();
    const { client, logs } = setup({
      makeMaker: (seat) =>
        withFallback({ decide: () => Promise.resolve("not-offered") }, builtinMaker(seed, seat)),
    });
    const a = client("A");
    a.send(create(2));
    for (let count = 0; count < 10000 && !a.update().view.result; count++) {
      await vi.advanceTimersToNextTimerAsync();
    }
    expect(a.update().view.result).not.toBeNull();
    expect(logs.length).toBe(a.update().seq - 1);
    for (const line of logs) expect(line).toMatch(/ by=builtin-after-jev-failure$/);
  });

  test("a valid bot answer is also delayed, then gives its watching creator a public update", async () => {
    vi.useFakeTimers();
    const { client } = setup({ delay: 700 });
    const a = client("A");
    a.send(create(2));
    const seq = a.update().seq;
    await vi.advanceTimersByTimeAsync(699);
    expect(a.update().seq).toBe(seq);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.update().seq).toBe(seq + 1);
    expect(a.update().view).toMatchObject({ you: null, hand: [] });
    vi.clearAllTimers();
  });

  test("an all-bot state at turn 301 ends without asking a maker", () => {
    const state = initial();
    const { client } = setup({
      state: { ...state, turn: { ...state.turn, number: 301 } },
      maker: () => ({
        decide() {
          throw new Error("must not decide");
        },
      }),
    });
    const a = client("A");
    a.send(create(2));
    expect(a.update().view).toMatchObject({
      pending: null,
      result: { reason: "turn_limit", winners: [], scores: [0, 0] },
    });
  });

  test("an engine throw retains a result and writes a safe log line", () => {
    const directory = mkdtempSync(join(tmpdir(), "lunar-error-log-"));
    const state = initial();
    const { humans, logs } = setup({
      state: { ...state, stack: [{ id: "broken", kind: "missing-handler" }] },
      logDirectory: directory,
    });
    const [a, b] = humans();
    a.answer();
    expect(a.update().view).toMatchObject({
      pending: null,
      result: { reason: "engine_error", winners: [] },
    });
    expect(b.update().view.result).toEqual(a.update().view.result);
    expect(logs.join("\n")).toContain("engine_error");
    expect(logs.join("\n")).toContain(a.update().game);
    expect(logs.join("\n")).toContain(join(directory, `${a.update().game}.jsonl`));
    rmSync(directory, { recursive: true, force: true });
  });

  test("a sweep keeps the log of a running game and deletes it once everyone has left", () => {
    const directory = mkdtempSync(join(tmpdir(), "lunar-open-log-"));
    const { humans, openLogs } = setup({ logDirectory: directory });
    const [a, b] = humans();
    a.answer();
    const path = join(directory, `${a.update().game}.jsonl`);
    utimesSync(path, 0, 0);
    const sweep = () => {
      sweepGameLogs({ directory, days: 30, open: openLogs, log: () => {} });
    };
    sweep();
    expect(existsSync(path)).toBe(true);
    a.send({ type: "game.leave" });
    sweep();
    expect(existsSync(path)).toBe(true);
    b.send({ type: "game.leave" });
    sweep();
    expect(existsSync(path)).toBe(false);
    rmSync(directory, { recursive: true, force: true });
  });

  test("a game continues after its log directory cannot be created", () => {
    const directory = mkdtempSync(join(tmpdir(), "lunar-write-error-"));
    const blocked = join(directory, "blocked");
    writeFileSync(blocked, "file");
    const { humans, logs } = setup({ logDirectory: blocked });
    const [a, b] = humans();
    a.answer();
    expect(b.update().seq).toBe(2);
    expect(logs.join("\n")).toContain("gamelog_write_error");
    rmSync(directory, { recursive: true, force: true });
  });

  test("resume receives only that seat's newest 200 events and connected seat fields", () => {
    const { humans, client } = setup();
    const [a, b] = humans();
    for (let count = 0; count < 160 && !a.update().view.result; count++) {
      (a.update().view.pending?.seat === 0 ? a : b).answer();
    }
    const events = a.updates().flatMap((update) => update.events);
    expect(events.length).toBeGreaterThan(200);
    a.connection.close();
    expect(b.update().view.players[0].connected).toBe(false);
    const resumed = client("A", a.token);
    expect(resumed.received.map((message) => message.type)).toEqual(["welcome", "game.update"]);
    expect(resumed.update().events).toEqual(events.slice(-200));
    expect(b.update().view.players[0].connected).toBe(true);
  });

  test("the game goes on while a seat is away; the resumed seat gets one update with its view and its last 200 events", () => {
    const { humans, client } = setup();
    const [a, b] = humans();
    let oracle = opening().state;
    const all = [...opening().events];
    const game = a.update().game;
    // The room and an engine of the test get the same choices.
    const step = (pick: number) => {
      const pending = oracle.pending;
      if (!pending) throw new Error("Expected decision");
      const option = pending.options[Math.min(pick, pending.options.length - 1)].id;
      const applied = applyChoice(oracle, { seat: pending.seat, decision: pending.id, option });
      if (!applied.ok) throw new Error("Expected accepted choice");
      const decide = { type: "game.decide", game, decision: pending.id, option };
      (pending.seat === 0 ? a : b).send(decide);
      oracle = applied.state;
      all.push(...applied.events);
    };
    const deciding = () => oracle.pending?.seat;
    const drawn = () => all.filter((event) => event.type === "card_drawn" && event.seat === 1);
    // With this seed third options Resell and Draw. After eight Draws of seat 1
    // first options play on past 200 events: that game ends at event 334.
    while (drawn().length < 8) step(2);
    while (all.length <= 200 || deciding() !== 1) step(0);
    a.connection.close();
    const heard = a.received.length;
    let whileAway = 0;
    for (; deciding() === 1; whileAway++) {
      step(0);
      expect(b.update().view.players.map((player) => player.connected)).toEqual([false, true]);
    }
    expect(whileAway).toBeGreaterThan(0);
    expect(a.received).toHaveLength(heard);

    const resumed = client("A", a.token);
    expect(resumed.received.map((message) => message.type)).toEqual(["welcome", "game.update"]);
    const view = viewFor(oracle, 0);
    const own = all.map((event) => eventFor(event, 0)).filter((event) => event !== null);
    expect(own.length).toBeGreaterThan(200);
    expect(resumed.update()).toEqual({
      type: "game.update",
      game: b.update().game,
      seq: b.update().seq,
      view: {
        ...view,
        players: view.players.map((player, index) => ({
          ...player,
          name: index === 0 ? "A" : "B",
          kind: "human",
          connected: true,
        })),
      },
      events: own.slice(-200),
    });
    // What seat 1 drew is in its own history only.
    const drawsOfB = (update: ReturnType<typeof resumed.update>) =>
      update.events.filter((event) => event.type === "card_drawn" && event.seat === 1);
    expect(drawsOfB(resumed.update()).length).toBeGreaterThan(0);
    expect(drawsOfB(resumed.update()).every((event) => !("card" in event))).toBe(true);
    const other = client("B", b.token).update();
    expect(drawsOfB(other).length).toBeGreaterThan(0);
    expect(drawsOfB(other).every((event) => "card" in event)).toBe(true);
  });

  test("a seat whose socket answers no ping shows as away after the next ping interval, and as back after hello with its token", () => {
    vi.useFakeTimers();
    const { humans, client } = setup();
    const [a, b] = humans();
    const connected = (update: ReturnType<typeof b.update>) =>
      update.view.players.map((player) => player.connected);
    a.mute();
    vi.advanceTimersByTime(2 * PING_INTERVAL_MS - 1);
    expect(a.closes).toEqual([]);
    expect(b.updates().every((update) => connected(update).every(Boolean))).toBe(true);
    vi.advanceTimersByTime(1);
    expect(a.closes).toEqual([1006]);
    expect(b.closes).toEqual([]);
    expect(connected(b.update())).toEqual([false, true]);
    const resumed = client("A", a.token);
    expect(connected(b.update())).toEqual([true, true]);
    expect(connected(resumed.update())).toEqual([true, true]);
    vi.advanceTimersByTime(4 * PING_INTERVAL_MS);
    expect(resumed.closes).toEqual([]);
    expect(connected(b.update())).toEqual([true, true]);
  });

  test("a second socket with the same token gets welcome and the game; the first is closed with 4001", () => {
    const { humans, client } = setup();
    const [a, b] = humans();
    const second = client("A", a.token);
    expect(a.closes).toEqual([4001]);
    expect(second.closes).toEqual([]);
    expect(second.received.map((message) => message.type)).toEqual(["welcome", "game.update"]);
    expect(second.update().view.you).toBe(0);
    expect(b.updates().every((update) => update.view.players[0].connected)).toBe(true);
    // The seat answers through the new socket only.
    a.answer();
    expect(second.updates()).toHaveLength(1);
    second.answer();
    expect(second.updates()).toHaveLength(2);
    expect(b.update().seq).toBe(second.update().seq);
  });

  test("a session outside a running game resumes with welcome, then lobby.state, and keeps its open seat", () => {
    const { client } = setup();
    const a = client("A");
    a.connection.close();
    let resumed = client("A", a.token);
    expect(resumed.received).toEqual([
      { type: "welcome", protocol: 1, token: a.token, name: "A", jev: false },
      { type: "lobby.state", games: [] },
    ]);
    resumed.send(create());
    resumed.connection.close();
    resumed = client("A", a.token);
    expect(resumed.received.map((message) => message.type)).toEqual(["welcome", "lobby.state"]);
    const lobby = resumed.received[1];
    if (lobby.type !== "lobby.state") throw new Error("Expected lobby.state");
    expect(lobby.games).toMatchObject([{ creator: "A", humans: ["A"], humansWanted: 2 }]);
    client("B").send({ type: "lobby.join", game: lobby.games[0].id });
    expect(resumed.update().view.you).toBe(0);
  });

  test.each([0, 2])(
    "finished humans or watching creator leave, free membership and start again (bots=%i)",
    (bots) => {
      const state = initial();
      const { humans, client, rooms } = setup({
        state: {
          ...state,
          pending: null,
          result: { reason: "victory", winners: [0], scores: [1, 0] },
        },
      });
      const [a, b] = bots === 0 ? humans() : [client("A"), null];
      if (bots === 2) a.send(create(2));
      const firstId = a.update().game;
      a.send({ type: "game.leave" });
      expect(a.received.at(-1)).toEqual({ type: "lobby.state", games: [] });
      if (b) {
        expect(rooms.has(firstId)).toBe(true);
        expect(b.update().view.result).toMatchObject({ reason: "victory" });
        b.send({ type: "game.leave" });
      }
      expect(rooms.has(firstId)).toBe(false);
      a.send(create(2));
      expect(a.update().game).not.toBe(firstId);
      expect(rooms.size).toBe(1);
    },
  );

  test("a finished room expires after 10 minutes and releases seated sessions", () => {
    vi.useFakeTimers();
    const state = initial();
    const { humans, rooms } = setup({
      state: {
        ...state,
        pending: null,
        result: { reason: "victory", winners: [0], scores: [1, 0] },
      },
    });
    const [a, b] = humans();
    const id = a.update().game;
    vi.advanceTimersByTime(10 * 60_000 - 1);
    expect(rooms.has(id)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(rooms.has(id)).toBe(false);
    expect(a.received.at(-1)).toMatchObject({ type: "lobby.state" });
    expect(b.received.at(-1)).toMatchObject({ type: "lobby.state" });
  });
});
