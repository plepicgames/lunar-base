import { afterEach, beforeEach, expect, test, vi } from "vitest";
import WebSocket from "ws";
import type { Fetch } from "@typesafe-ai/sdk";
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
  const started = vi.spyOn(http, "startServer");
  await main();
  running = (await started.mock.results[0].value) as http.RunningServer;
  const socket = new WebSocket(`ws://127.0.0.1:${String(running.port)}/ws`, {
    origin: `http://127.0.0.1:${String(running.port)}`,
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
    expect(output).toContain("Jev is on");
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
