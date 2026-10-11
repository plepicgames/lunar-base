import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
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

const LIMIT_SETTINGS = [
  "LUNAR_ALLOWED_ORIGINS",
  "LUNAR_TRUST_PROXY",
  "LUNAR_MAX_GAMES",
  "LUNAR_MAX_CONNECTIONS_PER_ADDRESS",
  "LUNAR_MAX_NEW_GAMES_PER_HOUR",
] as const;

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
  for (const name of LIMIT_SETTINGS) vi.stubEnv(name, undefined);
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

test("startup names the default limits", async () => {
  running = await main();
  expect(output).toContain(
    "Limits: origins same host, proxy trust off, 20 games, 8 connections per address, 10 new games per address per hour",
  );
});

test("startup reads the limits and the server uses them", async () => {
  vi.stubEnv("LUNAR_ALLOWED_ORIGINS", "https://example.org,https://www.example.org");
  vi.stubEnv("LUNAR_TRUST_PROXY", "true");
  vi.stubEnv("LUNAR_MAX_GAMES", "5");
  vi.stubEnv("LUNAR_MAX_CONNECTIONS_PER_ADDRESS", "1");
  vi.stubEnv("LUNAR_MAX_NEW_GAMES_PER_HOUR", "3");
  running = await main();
  expect(output).toContain(
    "Limits: origins 2 allowed, proxy trust on, 5 games, 1 connection per address, 3 new games per address per hour",
  );
  const open = (origin: string, address: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${String(running?.port)}/ws`, {
        origin,
        headers: { "CF-Connecting-IP": address },
      });
      socket.once("open", () => {
        resolve(socket);
      });
      socket.once("error", reject);
    });
  const first = await open("https://example.org", "192.0.2.1");
  const second = await open("https://www.example.org", "192.0.2.2");
  await expect(open("https://example.org", "192.0.2.1")).rejects.toThrow("429");
  await expect(open(`http://127.0.0.1:${String(running.port)}`, "192.0.2.3")).rejects.toThrow(
    "403",
  );
  expect(output.filter((line) => line.startsWith("limit"))).toEqual([
    expect.stringMatching(/^limit refused=connections address=[0-9a-f]{16}$/),
  ]);
  expect(output.join("\n")).not.toContain("192.0.2");
  first.close();
  second.close();
});

test.each(LIMIT_SETTINGS)("a bad %s stops startup before anything listens", async (name) => {
  vi.stubEnv(name, "no");
  const start = vi.spyOn(http, "startServer");
  await expect(main()).rejects.toThrow(name);
  expect(start).not.toHaveBeenCalled();
});

test("a log directory that is a symbolic link stops startup", async () => {
  const link = `${directory}-link`;
  symlinkSync(directory, link);
  vi.stubEnv("LUNAR_LOG_DIR", link);
  try {
    await expect(main()).rejects.toThrow(
      `The game log directory must not be a symbolic link: ${link}`,
    );
    expect(output.join("\n")).not.toContain("is running");
  } finally {
    rmSync(link, { force: true });
  }
});

/** Start an all-bot game that stays open, and return the ID the server gave it. */
async function openGame(port: number): Promise<string> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
    origin: `http://127.0.0.1:${String(port)}`,
  });
  const messages: ServerMessage[] = [];
  socket.on("message", (data: Buffer) => {
    messages.push(serverMessageSchema.parse(JSON.parse(data.toString())));
  });
  await new Promise<void>((resolve) => socket.once("open", resolve));
  socket.send(JSON.stringify({ type: "hello", protocol: 1, name: "Watcher" }));
  await vi.waitFor(() => {
    expect(messages.some((message) => message.type === "lobby.state")).toBe(true);
  });
  socket.send(
    JSON.stringify({
      type: "lobby.create",
      seats: 2,
      bots: 2,
      influences: false,
      kickstarter: false,
    }),
  );
  const update = await vi.waitFor(() => {
    const found = messages.find((message) => message.type === "game.update");
    if (found?.type !== "game.update") throw new Error("No update yet");
    return found;
  });
  socket.close();
  return update.game;
}

test("two servers in one process each write and sweep only their own directory", async () => {
  const old = "00000000-0000-4000-8000-000000000003.jsonl";
  const then = Date.now() / 1000 - 3 * 24 * 60 * 60;
  const directories = ["one", "two"].map((name) => {
    const own = join(directory, name);
    mkdirSync(own);
    writeFileSync(join(own, old), "{}\n");
    utimesSync(join(own, old), then, then);
    return own;
  });
  // One day for the first server and thirty for the second: only the first deletes.
  const servers = [
    await http.startServer({
      port: 0,
      botDelayMs: 600_000,
      log: () => {},
      logs: { directory: directories[0], days: 1, build: "one" },
    }),
    await http.startServer({
      port: 0,
      botDelayMs: 600_000,
      log: () => {},
      logs: { directory: directories[1], days: 30, build: "two" },
    }),
  ];
  try {
    const games = [await openGame(servers[0].port), await openGame(servers[1].port)];
    expect(readdirSync(directories[0])).toEqual([`${games[0]}.jsonl`]);
    expect(readdirSync(directories[1]).sort()).toEqual([old, `${games[1]}.jsonl`].sort());
    const build = (index: number) =>
      (
        JSON.parse(
          readFileSync(join(directories[index], `${games[index]}.jsonl`), "utf8").split("\n")[0],
        ) as { build: string }
      ).build;
    expect([build(0), build(1)]).toEqual(["one", "two"]);
  } finally {
    for (const server of servers) await server.close();
  }
});

test("a server given no days deletes nothing", async () => {
  const old = join(directory, "00000000-0000-4000-8000-000000000004.jsonl");
  writeFileSync(old, "{}\n");
  utimesSync(old, 0, 0);
  running = await http.startServer({ port: 0, logs: { directory } });
  expect(existsSync(old)).toBe(true);
});

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
  // Settings are read once at startup: a later change moves nothing.
  vi.stubEnv("LUNAR_LOG_DIR", join(directory, "later"));
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
