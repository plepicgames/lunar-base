import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import WebSocket from "ws";
import { serverMessageSchema, type ServerMessage } from "../protocol/messages.ts";
import * as http from "./http.ts";
import { main } from "./main.ts";

let directory: string;
let output: string[];
let running: http.RunningServer | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lunar-main-"));
  output = [];
  for (const method of ["log", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
  }
  vi.stubEnv("PORT", "0");
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("TYPESAFE_API_KEY", undefined);
  vi.stubEnv("LUNAR_BOT_DELAY_MS", "0");
  vi.stubEnv("LUNAR_BUILD", undefined);
  vi.stubEnv("LUNAR_LOG_DIR", directory);
  vi.stubEnv("LUNAR_LOG_DAYS", undefined);
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

test("startup says where logs go, for how long, and which build runs", async () => {
  vi.stubEnv("LUNAR_LOG_DAYS", "7");
  vi.stubEnv("LUNAR_BUILD", "1.4.0");
  running = await main();
  expect(output).toContain(`Game logs go to ${directory} and are kept for 7 days; build 1.4.0`);
});

test("startup uses 30 days and build dev when nothing is set", async () => {
  running = await main();
  expect(output).toContain(`Game logs go to ${directory} and are kept for 30 days; build dev`);
});

test.each(["0", "-1", "abc", "", "1.5"])(
  "LUNAR_LOG_DAYS=%j stops startup before the server listens",
  async (value) => {
    vi.stubEnv("LUNAR_LOG_DAYS", value);
    const started = vi.spyOn(http, "startServer");
    await expect(main()).rejects.toThrow(/LUNAR_LOG_DAYS must be/);
    expect(started).not.toHaveBeenCalled();
  },
);

test("startup deletes an old log and keeps a fresh one", async () => {
  const old = join(directory, "00000000-0000-4000-8000-000000000001.jsonl");
  const fresh = join(directory, "00000000-0000-4000-8000-000000000002.jsonl");
  for (const path of [old, fresh]) writeFileSync(path, "{}\n");
  const then = Date.now() / 1000 - 3 * 24 * 60 * 60;
  utimesSync(old, then, then);
  vi.stubEnv("LUNAR_LOG_DAYS", "1");
  running = await main();
  expect(existsSync(old)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
  expect(output).toContain(`Game logs go to ${directory} and are kept for 1 day; build dev`);
});

test("the log of a game with a named human holds no name and no session token", async () => {
  running = await main();
  const socket = new WebSocket(`ws://127.0.0.1:${String(running.port)}/ws`, {
    origin: `http://127.0.0.1:${String(running.port)}`,
  });
  const messages: ServerMessage[] = [];
  socket.on("message", (data: Buffer) => {
    messages.push(serverMessageSchema.parse(JSON.parse(data.toString())));
  });
  await new Promise<void>((resolve) => socket.once("open", resolve));
  socket.send(JSON.stringify({ type: "hello", protocol: 1, name: "Zebedee Quux" }));
  await vi.waitFor(() => {
    expect(messages.some((message) => message.type === "lobby.state")).toBe(true);
  });
  const welcome = messages.find((message) => message.type === "welcome");
  if (welcome?.type !== "welcome") throw new Error("Missing welcome");
  socket.send(
    JSON.stringify({
      type: "lobby.create",
      seats: 2,
      bots: 1,
      influences: true,
      kickstarter: true,
    }),
  );
  // The human answers every decision that reaches seat 0 until a few are logged.
  const answered = new Set<string>();
  await vi.waitFor(
    () => {
      const update = messages.findLast((message) => message.type === "game.update");
      if (update?.type !== "game.update") throw new Error("No update yet");
      const pending = update.view.pending;
      if (pending && "id" in pending && !answered.has(pending.id)) {
        answered.add(pending.id);
        socket.send(
          JSON.stringify({
            type: "game.decide",
            game: update.game,
            decision: pending.id,
            option: pending.options[0].id,
          }),
        );
      }
      expect(answered.size).toBeGreaterThan(0);
      expect(update.seq).toBeGreaterThan(answered.size);
    },
    { timeout: 4_000, interval: 10 },
  );
  socket.close();

  const files = readdirSync(directory);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[0-9a-f-]{36}\.jsonl$/);
  const text = readFileSync(join(directory, files[0]), "utf8");
  const lines = text.trimEnd().split("\n");
  expect(lines.length).toBeGreaterThan(1);
  expect(text).not.toContain("Zebedee");
  expect(text).not.toContain("Quux");
  expect(text).not.toContain(welcome.token);
  expect(Object.keys(JSON.parse(lines[0]) as object).sort()).toEqual([
    "build",
    "config",
    "created",
    "protocol",
    "seed",
  ]);
  for (const line of lines.slice(1))
    expect(Object.keys(JSON.parse(line) as object).sort()).toEqual([
      "by",
      "decision",
      "option",
      "seat",
    ]);
});
