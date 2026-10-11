import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import WebSocket from "ws";
import { SHUTDOWN_DEADLINE_MS, startServer, type RunningServer } from "./http.ts";
import { shutdownOnSignals } from "./main.ts";

let running: RunningServer | undefined;
let directory: string;
let lines: string[];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lunar-shutdown-"));
  lines = [];
});
afterEach(async () => {
  await running?.close();
  running = undefined;
  rmSync(directory, { recursive: true, force: true });
});

async function start(
  basePath = "/",
  log: (line: string) => void = (line) => lines.push(line),
): Promise<RunningServer> {
  running = await startServer({
    port: 0,
    host: "127.0.0.1",
    basePath,
    // No client build: the health path must not need one.
    clientDir: join(directory, "no-client-build"),
    botDelayMs: 600_000,
    log,
    logs: { directory: join(directory, "games") },
  });
  return running;
}

async function request(port: number, path: string, method = "GET"): Promise<Response> {
  return await fetch(`http://127.0.0.1:${String(port)}${path}`, { method, redirect: "manual" });
}

interface Client {
  readonly socket: WebSocket;
  readonly messages: Record<string, unknown>[];
  /** The close code and reason, once the socket has closed. */
  readonly closed: Promise<{ code: number; reason: string }>;
}

function connect(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      origin: `http://127.0.0.1:${String(port)}`,
    });
    const messages: Record<string, unknown>[] = [];
    socket.on("message", (data: Buffer) => {
      messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    const closed = new Promise<{ code: number; reason: string }>((done) => {
      socket.once("close", (code, reason) => {
        done({ code, reason: reason.toString() });
      });
    });
    socket.once("open", () => {
      resolve({ socket, messages, closed });
    });
    socket.once("error", reject);
  });
}

/** A WebSocket peer that completes the handshake and then never answers a close. */
function hang(port: number): Promise<{ socket: Socket; received: () => string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(port, "127.0.0.1");
    let received = "";
    socket.once("error", reject);
    socket.on("data", (data) => {
      const first = received === "";
      received += data.toString("latin1");
      if (first) resolve({ socket, received: () => received });
    });
    socket.once("connect", () => {
      socket.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\n` +
          `Origin: http://127.0.0.1:${String(port)}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
    });
  });
}

test("the health path answers ok without a client build, to GET and HEAD only", async () => {
  const { port } = await start();
  const health = await request(port, "/healthz");
  expect(health.status).toBe(200);
  expect(health.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(health.headers.get("cache-control")).toBe("no-store");
  expect(await health.text()).toBe("ok\n");

  const head = await request(port, "/healthz", "HEAD");
  expect(head.status).toBe(200);
  expect(head.headers.get("cache-control")).toBe("no-store");
  expect(await head.text()).toBe("");

  for (const method of ["POST", "PUT", "DELETE"]) {
    const refused = await request(port, "/healthz", method);
    expect(refused.status, method).toBe(405);
    expect(refused.headers.get("allow")).toBe("GET, HEAD");
  }
  // The static handler still has no build to serve.
  expect((await request(port, "/")).status).toBe(404);
});

test("under a base path the health path lives below the base and nowhere else", async () => {
  const { port } = await start("/play/lunar-base");
  const health = await request(port, "/play/lunar-base/healthz");
  expect(health.status).toBe(200);
  expect(await health.text()).toBe("ok\n");
  for (const outside of ["/healthz", "/play/healthz", "/play/lunar-base/healthz/"]) {
    expect((await request(port, outside)).status, outside).toBe(404);
  }
});

test("shutdown tells every socket the server restarts, closes it with 1012 and stops listening", async () => {
  const server = await start();
  const { port } = server;
  const player = await connect(port);
  player.socket.send(JSON.stringify({ type: "hello", protocol: 1, name: "Ann" }));
  await vi.waitFor(() => {
    expect(player.messages.some((message) => message.type === "lobby.state")).toBe(true);
  });
  player.socket.send(
    JSON.stringify({
      type: "lobby.create",
      seats: 2,
      bots: 1,
      influences: false,
      kickstarter: false,
    }),
  );
  await vi.waitFor(() => {
    expect(player.messages.some((message) => message.type === "game.update")).toBe(true);
  });
  // A socket that has not said hello is told as well.
  const silent = await connect(port);

  const first = server.shutdown({ signal: "SIGTERM" });
  // A second call starts nothing: it is the same shutdown.
  expect(server.shutdown({ signal: "SIGINT" })).toBe(first);
  expect(await first).toEqual({ deadlineHit: false });

  for (const client of [player, silent]) {
    expect(await client.closed).toEqual({ code: 1012, reason: "Server restarting" });
    expect(client.messages.at(-1)).toEqual({ type: "server.restart" });
  }
  expect(lines.filter((line) => line.startsWith("shutdown"))).toEqual([
    "shutdown begin signal=SIGTERM connections=2 games=1",
    "shutdown end",
  ]);
  await expect(request(port, "/healthz")).rejects.toThrow();
  await expect(connect(port)).rejects.toThrow();
});

test("during shutdown health is 503 and upgrades are refused; the deadline drops a socket that never closes", async () => {
  const server = await start();
  const { port } = server;
  const hung = await hang(port);
  expect(hung.received()).toContain("101 Switching Protocols");
  const ended = new Promise<void>((resolve) => hung.socket.once("close", resolve));

  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  let settled = false;
  const stopping = server.shutdown({
    signal: "SIGTERM",
    schedule(run, ms) {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  void stopping.then(() => {
    settled = true;
  });

  const health = await request(port, "/healthz");
  expect(health.status).toBe(503);
  expect(health.headers.get("cache-control")).toBe("no-store");
  expect(await health.text()).toBe("shutting down\n");
  expect((await request(port, "/healthz", "POST")).status).toBe(405);
  await expect(connect(port)).rejects.toThrow("503");

  // The peer got the message and the close frame, and answers neither.
  await vi.waitFor(() => {
    expect(hung.received()).toContain('{"type":"server.restart"}');
  });
  expect(hung.received()).toContain("Server restarting");
  expect(settled).toBe(false);
  expect(timers.map((timer) => timer.ms)).toEqual([SHUTDOWN_DEADLINE_MS]);
  expect(SHUTDOWN_DEADLINE_MS).toBe(10_000);

  timers[0].run();
  expect(await stopping).toEqual({ deadlineHit: true });
  await ended;
  expect(lines.filter((line) => line.startsWith("shutdown"))).toEqual([
    "shutdown begin signal=SIGTERM connections=1 games=0",
    "shutdown deadline hit ms=10000 sockets=1",
    "shutdown end",
  ]);
  await expect(request(port, "/healthz")).rejects.toThrow();
});

test("a connection that never sent a request does not hold the shutdown", async () => {
  const server = await start();
  const idle = createConnection(server.port, "127.0.0.1");
  await new Promise((resolve) => idle.once("connect", resolve));
  const ended = new Promise<void>((resolve) => idle.once("close", resolve));
  // A kept-alive connection that has had its answer is closed too.
  expect((await request(server.port, "/healthz")).status).toBe(200);
  // The deadline never fires here: only a clean close resolves the promise.
  expect(await server.shutdown({ schedule: () => () => undefined })).toEqual({
    deadlineHit: false,
  });
  await ended;
  expect(lines.at(-2)).toBe("shutdown begin signal=none connections=0 games=0");
});

const CREATE = JSON.stringify({
  type: "lobby.create",
  seats: 2,
  bots: 1,
  influences: false,
  kickstarter: false,
});

test("a message sent after shutdown began starts no game: no room, no log file", async () => {
  const server = await start();
  const players = [await connect(server.port), await connect(server.port)];
  for (const [index, player] of players.entries()) {
    player.socket.send(
      JSON.stringify({ type: "hello", protocol: 1, name: `Player ${String(index)}` }),
    );
  }
  await vi.waitFor(() => {
    for (const player of players) {
      expect(player.messages.some((message) => message.type === "lobby.state")).toBe(true);
    }
  });
  // The second player answers the restart message itself, so its frame
  // reaches the server inside the close handshake.
  players[1].socket.on("message", (data: Buffer) => {
    if (data.toString().includes("server.restart")) players[1].socket.send(CREATE);
  });

  const stopping = server.shutdown({ signal: "SIGTERM" });
  // The first one's frame arrives between the call and the close.
  players[0].socket.send(CREATE);
  expect(await stopping).toEqual({ deadlineHit: false });

  for (const player of players) {
    expect((await player.closed).code).toBe(1012);
    expect(player.messages.at(-1)).toEqual({ type: "server.restart" });
    expect(player.messages.some((message) => message.type === "game.update")).toBe(false);
  }
  const games = join(directory, "games");
  expect(existsSync(games) ? readdirSync(games) : []).toEqual([]);
  expect(lines.filter((line) => line.startsWith("game="))).toEqual([]);
});

test("pipelined requests under way when the listener closes all get their whole response", async () => {
  const clientDir = join(directory, "client");
  mkdirSync(clientDir);
  const size = 8 * 1024 * 1024;
  writeFileSync(join(clientDir, "big.bin"), Buffer.alloc(size, 0x61));
  running = await startServer({
    port: 0,
    host: "127.0.0.1",
    clientDir,
    log: (line) => lines.push(line),
    logs: { directory: join(directory, "games") },
  });
  const server = running;
  const socket = createConnection(server.port, "127.0.0.1");
  await new Promise((resolve) => socket.once("connect", resolve));
  let received = 0;
  let head = "";
  const ended = new Promise<void>((resolve) => socket.once("close", resolve));
  const first = new Promise<void>((resolve) => {
    socket.on("data", (data) => {
      if (head.length < 4096) head += data.toString("latin1");
      received += data.length;
      resolve();
    });
  });
  const get = `GET /big.bin HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`;
  socket.write(get + get);
  // Both requests are parsed; the client stops reading, so neither response can finish.
  await first;
  socket.pause();

  const stopping = server.shutdown({ schedule: () => () => undefined });
  await new Promise((resolve) => setTimeout(resolve, 50));
  socket.resume();
  expect(await stopping).toEqual({ deadlineHit: false });
  await ended;

  const headers = /^HTTP\/1\.1 200 OK\r\n[^]*?\r\n\r\n/.exec(head)?.[0] ?? "";
  expect(headers).toContain(`Content-Length: ${String(size)}`);
  // Two whole responses: the same headers twice, apart from a Date a second later.
  expect(received).toBeGreaterThanOrEqual(2 * size + 2 * headers.length - 2);
  expect(received).toBeLessThanOrEqual(2 * size + 2 * headers.length + 2);
});

test("a logger or a scheduler that throws does not stop the shutdown", async () => {
  const server = await start("/", () => {
    throw new Error("logger");
  });
  const client = await connect(server.port);
  expect(
    await server.shutdown({
      schedule() {
        throw new Error("scheduler");
      },
    }),
  ).toEqual({ deadlineHit: false });
  expect((await client.closed).code).toBe(1012);
});

function signals() {
  const listeners = new Map<string, () => void>();
  const exits: number[] = [];
  let finish: (value: { deadlineHit: boolean }) => void = () => {};
  const shutdown = vi.fn(
    () =>
      new Promise<{ deadlineHit: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  shutdownOnSignals(
    { port: 0, connections: () => Promise.resolve(0), close: () => Promise.resolve(), shutdown },
    {
      on: (signal, listener) => listeners.set(signal, listener),
      exit: (code) => exits.push(code),
    },
  );
  return {
    listeners,
    exits,
    shutdown,
    finish: () => {
      finish({ deadlineHit: false });
    },
  };
}

test.each(["SIGTERM", "SIGINT"])(
  "%s shuts the server down and then exits with 0",
  async (signal) => {
    const { listeners, exits, shutdown, finish } = signals();
    listeners.get(signal)?.();
    expect(shutdown).toHaveBeenCalledWith({ signal });
    expect(exits).toEqual([]);
    finish();
    await vi.waitFor(() => {
      expect(exits).toEqual([0]);
    });
  },
);

test("a second signal during shutdown exits at once", () => {
  const { listeners, exits, shutdown } = signals();
  listeners.get("SIGTERM")?.();
  listeners.get("SIGINT")?.();
  expect(shutdown).toHaveBeenCalledTimes(1);
  expect(exits).toEqual([1]);
});
