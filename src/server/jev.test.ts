import { afterEach, beforeEach, expect, test, vi } from "vitest";
import WebSocket from "ws";
import type { Fetch } from "@typesafe-ai/sdk";
import type { DecisionMaker, DecisionRequest } from "../bots/maker.ts";
import { serverMessageSchema, type ServerMessage } from "../protocol/messages.ts";
import * as http from "./http.ts";
import { main } from "./main.ts";

// Fictional credential; the transport is always stubbed before startup.
const KEY = "fake-server-credential-67";
let running: http.RunningServer | undefined;
let output: string[];
let bytes: string[];
let requests: { model: string; authorization: string | null }[];

beforeEach(() => {
  output = [];
  bytes = [];
  requests = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
  }
  vi.stubEnv("PORT", "0");
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("LUNAR_SEED", "builtin-only");
  vi.stubEnv("LUNAR_BOT_DELAY_MS", "0");
  vi.stubEnv("LUNAR_JEV_MODEL", undefined);
  vi.stubEnv("LUNAR_JEV_MAX_DECISIONS_PER_HOUR", undefined);
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function start(key: string | undefined, fail = false) {
  vi.stubEnv("TYPESAFE_API_KEY", key);
  const fetch: Fetch = (_url, init = {}) => {
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
    const body = JSON.parse(init.body) as {
      model: string;
      questions: { pick: { criteria: Record<string, string> } };
    };
    requests.push({
      model: body.model,
      authorization: new Headers(init.headers).get("authorization"),
    });
    // Resell progresses to a credit victory without needing a model in the test.
    const choices = Object.entries(body.questions.pick.criteria);
    const choice = (choices.find(([, label]) => /resell/i.test(label)) ?? choices[0])[0];
    return Promise.resolve(
      new Response(
        JSON.stringify(
          fail
            ? { detail: KEY }
            : {
                model: KEY, // Even an echoed credential must never reach a log or client.
                answers: {
                  pick: { type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } },
                },
                usage: { input_tokens: 1, output_tokens: 1 },
              },
        ),
        { status: fail ? 422 : 200, headers: { "content-type": "application/json" } },
      ),
    );
  };
  vi.stubGlobal("fetch", fetch);
  running = await main();
  return watch(running);
}

/** A named session in the lobby of `server`, with every message it received. */
async function watch(server: http.RunningServer) {
  const socket = new WebSocket(`ws://127.0.0.1:${String(server.port)}/ws`, {
    origin: `http://127.0.0.1:${String(server.port)}`,
  });
  const messages: ServerMessage[] = [];
  socket.on("message", (data: Buffer) => {
    bytes.push(data.toString());
    messages.push(serverMessageSchema.parse(JSON.parse(data.toString())));
  });
  await new Promise<void>((resolve) => socket.once("open", resolve));
  socket.send(JSON.stringify({ type: "hello", protocol: 1, name: "Watcher" }));
  await vi.waitFor(() => {
    expect(messages.some((m) => m.type === "lobby.state")).toBe(true);
  });
  return { socket, messages };
}

function create(socket: WebSocket, botBrain?: "jev" | "builtin") {
  socket.send(
    JSON.stringify({
      type: "lobby.create",
      seats: 2,
      bots: 2,
      influences: false,
      kickstarter: false,
      ...(botBrain ? { botBrain } : {}),
    }),
  );
}

async function finish(messages: ServerMessage[]) {
  await vi.waitFor(
    () => {
      expect(messages.findLast((m) => m.type === "error")).toBeUndefined();
      expect(messages.some((m) => m.type === "game.update" && m.view.result)).toBe(true);
    },
    { timeout: 4_000, interval: 20 },
  );
  const last = messages.findLast((m) => m.type === "game.update");
  if (last?.type !== "game.update") throw new Error("Missing game result");
  const decisions = output.filter((line) => line.startsWith(`game=${last.game} `));
  expect(decisions).toHaveLength(last.seq - 1);
  expect(decisions.length).toBeGreaterThan(20);
  expect([...output, ...bytes].join("\n")).not.toContain(KEY);
  return decisions;
}

test.each([undefined, "", "   "])(
  "credential %j keeps Jev off and bots finish with builtin",
  async (key) => {
    const { socket, messages } = await start(key);
    expect(messages[0]).toMatchObject({ type: "welcome", jev: false });
    expect(output).toContain("Jev is off");
    create(socket, "jev");
    await vi.waitFor(() => {
      expect(messages.at(-1)).toMatchObject({ type: "error", code: "bad_message" });
    });
    messages.length = 0;
    create(socket);
    expect((await finish(messages)).every((line) => line.endsWith("by=builtin"))).toBe(true);
    expect(requests).toHaveLength(0);
  },
);

test.each([undefined, "jev-selected-test-model"])(
  "Jev games request each decision using model %j without leaking the key",
  async (model) => {
    vi.stubEnv("LUNAR_JEV_MODEL", model);
    const { socket, messages } = await start(KEY);
    expect(messages[0]).toMatchObject({ type: "welcome", jev: true });
    expect(output).toContain("Jev is on, at most 2000 decisions per hour");
    create(socket, "jev");
    const decisions = await finish(messages);
    expect(decisions.every((line) => line.endsWith("by=jev"))).toBe(true);
    expect(requests).toHaveLength(decisions.length);
    expect(requests.every((request) => request.model === (model ?? "jev-latest"))).toBe(true);
    expect(requests.every((request) => request.authorization === `Bearer ${KEY}`)).toBe(true);
  },
);

test("an omitted brain uses builtin even with a credential", async () => {
  const { socket, messages } = await start(KEY);
  messages.length = 0;
  create(socket);
  expect((await finish(messages)).every((line) => line.endsWith("by=builtin"))).toBe(true);
  expect(requests).toHaveLength(0);
});

test("Jev failures finish with fallback and share the open breaker across seats and games", async () => {
  const { socket, messages } = await start(KEY, true);
  create(socket, "jev");
  const decisions = await finish(messages);
  expect(decisions.slice(0, 3).every((line) => line.endsWith("by=builtin-after-jev-failure"))).toBe(
    true,
  );
  expect(decisions.slice(3).every((line) => line.endsWith("by=builtin"))).toBe(true);
  expect(requests).toHaveLength(3);
  messages.length = 0;
  socket.send(JSON.stringify({ type: "game.leave" }));
  await vi.waitFor(() => {
    expect(messages.at(-1)).toMatchObject({ type: "lobby.state" });
  });
  create(socket, "jev");
  expect((await finish(messages)).every((line) => line.endsWith("by=builtin"))).toBe(true);
  expect(requests).toHaveLength(3);
});

/** Leaves the finished game and plays a new one to its end. */
async function next(socket: WebSocket, messages: ServerMessage[], botBrain?: "jev" | "builtin") {
  messages.length = 0;
  socket.send(JSON.stringify({ type: "game.leave" }));
  await vi.waitFor(() => {
    expect(messages.at(-1)).toMatchObject({ type: "lobby.state" });
  });
  create(socket, botBrain);
  return finish(messages);
}

const EXHAUSTED = "jev budget exhausted limit=5 window=60m";
const RESUMED = "jev budget resumed limit=5 window=60m";

/** A server with a stand-in for Jev, a budget of 5 and a clock the test moves. */
async function budgeted(jev: DecisionMaker & { asked: number }, clock: { at: number }) {
  return http.startServer({
    port: 0,
    host: "127.0.0.1",
    seed: "builtin-only",
    botDelayMs: 0,
    jev,
    jevDecisionsPerHour: 5,
    now: () => clock.at,
    log: (line) => output.push(line),
  });
}

/** Stands in for Jev: it takes the first option and counts how often it was asked. */
function fakeJev() {
  const maker = {
    asked: 0,
    decide({ decision }: DecisionRequest) {
      maker.asked += 1;
      return Promise.resolve(decision.options[0].id);
    },
  };
  return maker;
}

const by = (decisions: string[]) => decisions.map((line) => line.replace(/^.* by=/, ""));
const count = (line: string) => output.filter((logged) => logged === line).length;

test("LUNAR_JEV_MAX_DECISIONS_PER_HOUR caps the Jev requests of the server", async () => {
  vi.stubEnv("LUNAR_JEV_MAX_DECISIONS_PER_HOUR", "5");
  const { socket, messages } = await start(KEY);
  expect(output).toContain("Jev is on, at most 5 decisions per hour");
  create(socket, "jev");
  const first = by(await finish(messages));
  expect(first.slice(0, 5)).toEqual(Array(5).fill("jev"));
  expect(first.slice(5).every((who) => who === "builtin")).toBe(true);
  expect((await next(socket, messages, "jev")).every((line) => line.endsWith("by=builtin"))).toBe(
    true,
  );
  expect(requests).toHaveLength(5);
  expect(count(EXHAUSTED)).toBe(1);
  expect(count(RESUMED)).toBe(0);
  // Over the budget is no failure of Jev: nothing failed and no pause began.
  expect(output.filter((line) => /failed=|breaker=/.test(line))).toEqual([]);
});

test("a budget of 0 builds no Jev maker: the lobby offers no Jev and refuses a Jev game", async () => {
  vi.stubEnv("LUNAR_JEV_MAX_DECISIONS_PER_HOUR", "0");
  const started = vi.spyOn(http, "startServer");
  const { socket, messages } = await start(KEY);
  expect(started.mock.calls[0][0]?.jev).toBeUndefined();
  expect(messages[0]).toMatchObject({ type: "welcome", jev: false });
  expect(output).toContain("Jev is off because the budget is 0 decisions per hour");
  create(socket, "jev");
  await vi.waitFor(() => {
    expect(messages.at(-1)).toMatchObject({ type: "error", code: "bad_message" });
  });
  messages.length = 0;
  create(socket);
  expect((await finish(messages)).every((line) => line.endsWith("by=builtin"))).toBe(true);
  expect(requests).toHaveLength(0);
  expect(output.filter((line) => line.startsWith("jev "))).toEqual([]);
});

test("a bad Jev budget stops startup before the server listens", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", KEY);
  vi.stubEnv("LUNAR_JEV_MAX_DECISIONS_PER_HOUR", "abc");
  const started = vi.spyOn(http, "startServer");
  await expect(main()).rejects.toThrow(
    'LUNAR_JEV_MAX_DECISIONS_PER_HOUR must be a whole number, 0 or more; got "abc"',
  );
  expect(started).not.toHaveBeenCalled();
});

test("the games of one server share its budget, and Jev plays again when the hour has passed", async () => {
  const jev = fakeJev();
  const clock = { at: 0 };
  running = await budgeted(jev, clock);
  const { socket, messages } = await watch(running);

  // A built-in game leaves the budget untouched.
  create(socket, "builtin");
  expect((await finish(messages)).every((line) => line.endsWith("by=builtin"))).toBe(true);
  expect(jev.asked).toBe(0);

  const first = by(await next(socket, messages, "jev"));
  expect(first.slice(0, 5)).toEqual(Array(5).fill("jev"));
  expect(first.slice(5).every((who) => who === "builtin")).toBe(true);
  // A second game finds the budget the first one spent.
  expect(by(await next(socket, messages, "jev")).every((who) => who === "builtin")).toBe(true);
  expect(jev.asked).toBe(5);
  expect([count(EXHAUSTED), count(RESUMED)]).toEqual([1, 0]);

  clock.at = 61 * 60_000;
  const later = by(await next(socket, messages, "jev"));
  expect(later.slice(0, 5)).toEqual(Array(5).fill("jev"));
  expect(later.slice(5).every((who) => who === "builtin")).toBe(true);
  expect(jev.asked).toBe(10);
  expect([count(EXHAUSTED), count(RESUMED)]).toEqual([2, 1]);
});

test("a second server has its own budget", async () => {
  const jev = fakeJev();
  const clock = { at: 0 };
  running = await budgeted(jev, clock);
  const other = await budgeted(jev, clock);
  try {
    const one = await watch(running);
    create(one.socket, "jev");
    expect(by(await finish(one.messages)).filter((who) => who === "jev")).toHaveLength(5);
    expect(jev.asked).toBe(5);
    const two = await watch(other);
    create(two.socket, "jev");
    expect(by(await finish(two.messages)).filter((who) => who === "jev")).toHaveLength(5);
    expect(jev.asked).toBe(10);
  } finally {
    await other.close();
  }
});
