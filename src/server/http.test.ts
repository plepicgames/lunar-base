import { afterEach, expect, test, vi } from "vitest";
import { createConnection } from "node:net";
import WebSocket from "ws";
import { startServer, type RunningServer } from "./http.ts";

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

function connect(
  port: number,
  origin?: string,
  options: WebSocket.ClientOptions = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      ...options,
      ...(origin ? { origin } : {}),
    });
    socket.once("open", () => {
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

function decode(data: WebSocket.RawData): unknown {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(data))
      : data;
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

function receive(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once("message", (data) => {
      resolve(decode(data));
    });
  });
}

function until(
  socket: WebSocket,
  type: string,
  accept: (message: Record<string, unknown>) => boolean = () => true,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const listener = (data: WebSocket.RawData) => {
      const message = decode(data) as Record<string, unknown>;
      if (message.type !== type || !accept(message)) return;
      socket.off("message", listener);
      resolve(message);
    };
    socket.on("message", listener);
  });
}

test("a real socket receives welcome and lobby state", async () => {
  running = await startServer({ port: 0, host: "127.0.0.1", botDelayMs: 0 });
  const socket = await connect(running.port, `http://127.0.0.1:${String(running.port)}`);
  const welcome = receive(socket);
  const lobby = new Promise<unknown>((resolve) => {
    socket.on("message", (data) => {
      const message = decode(data);
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "lobby.state"
      )
        resolve(message);
    });
  });
  socket.send(JSON.stringify({ type: "hello", protocol: 1, name: "Alice" }));
  expect(await welcome).toMatchObject({ type: "welcome", name: "Alice" });
  expect(await lobby).toMatchObject({ type: "lobby.state", games: [] });
  socket.close();
});

test("an upgrade with a foreign Origin is refused", async () => {
  running = await startServer({ port: 0, host: "127.0.0.1" });
  await expect(connect(running.port, "http://elsewhere.example")).rejects.toThrow("403");
});

test("resetting a refused upgrade leaves the server available", async () => {
  running = await startServer({ port: 0, host: "127.0.0.1" });
  const port = running.port;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(port, "127.0.0.1");
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.write(
          `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\nOrigin: http://evil.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
          () => {
            socket.resetAndDestroy();
            resolve();
          },
        );
      });
    });
  }
  const socket = await connect(running.port, `http://127.0.0.1:${String(running.port)}`);
  const welcome = until(socket, "welcome");
  socket.send(JSON.stringify({ type: "hello", protocol: 1, name: "Alice" }));
  expect(await welcome).toMatchObject({ type: "welcome", name: "Alice" });
  socket.close();
});

test("a fixed seed deals the same seat-zero hand in successive games", async () => {
  running = await startServer({ port: 0, seed: "abc", botDelayMs: 100_000 });
  const hands: unknown[] = [];
  for (const name of ["Alice", "Bob"]) {
    const socket = await connect(running.port, `http://127.0.0.1:${String(running.port)}`);
    const lobby = until(socket, "lobby.state");
    socket.send(JSON.stringify({ type: "hello", protocol: 1, name }));
    await lobby;
    const update = until(socket, "game.update");
    socket.send(
      JSON.stringify({
        type: "lobby.create",
        seats: 2,
        bots: 1,
        influences: false,
        kickstarter: false,
      }),
    );
    const message = await update;
    hands.push((message.view as { hand: unknown }).hand);
    socket.close();
  }
  expect(hands[1]).toEqual(hands[0]);
});

test("with no credential the built-in maker decides every non-human decision of a whole game", async () => {
  const logs: string[] = [];
  running = await startServer({
    port: 0,
    seed: "builtin-only",
    botDelayMs: 0,
    log: (line) => logs.push(line),
  });
  const socket = await connect(running.port, `http://127.0.0.1:${String(running.port)}`);
  const lobby = until(socket, "lobby.state");
  socket.send(JSON.stringify({ type: "hello", protocol: 1, name: "Watcher" }));
  await lobby;
  const finished = until(
    socket,
    "game.update",
    (message) => (message.view as { result: unknown }).result !== null,
  );
  socket.send(
    JSON.stringify({
      type: "lobby.create",
      seats: 3,
      bots: 3,
      influences: false,
      kickstarter: false,
    }),
  );
  const last = await finished;
  // One update opens the game; every later one follows one applied decision.
  expect(logs).toHaveLength((last.seq as number) - 1);
  expect(logs.length).toBeGreaterThan(20);
  const line = new RegExp(`^game=${String(last.game)} seat=[012] decision=\\S+ by=builtin$`);
  for (const entry of logs) expect(entry).toMatch(line);
  socket.close();
});

/** The `connected` field of every seat of a `game.update`, in seat order. */
function connected(update: Record<string, unknown>): boolean[] {
  return (update.view as { players: { connected: boolean }[] }).players.map(
    (player) => player.connected,
  );
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once("close", resolve);
  });
}

test("a disconnected watcher of a running all-bot game expires after 30 minutes", async () => {
  running = await startServer({ port: 0, botDelayMs: 60 * 60_000 });
  const origin = `http://127.0.0.1:${String(running.port)}`;
  const watcher = await connect(running.port, origin);
  const lobby = until(watcher, "lobby.state");
  watcher.send(JSON.stringify({ type: "hello", protocol: 1, name: "Watcher" }));
  await lobby;
  const started = until(watcher, "game.update");
  watcher.send(
    JSON.stringify({
      type: "lobby.create",
      seats: 2,
      bots: 2,
      influences: false,
      kickstarter: false,
    }),
  );
  expect(await started).toMatchObject({ view: { you: null, result: null } });

  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  try {
    const gone = closed(watcher);
    watcher.terminate();
    await gone;
    for (let attempt = 0; attempt < 100 && vi.getTimerCount() === 0; attempt++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    vi.advanceTimersByTime(30 * 60_000);

    const replacement = await connect(running.port, origin);
    const welcome = receive(replacement);
    const state = until(replacement, "lobby.state");
    replacement.send(JSON.stringify({ type: "hello", protocol: 1, name: "Watcher" }));
    expect(await welcome).toMatchObject({ type: "welcome", name: "Watcher" });
    expect(await state).toMatchObject({ games: [] });
    replacement.close();
  } finally {
    vi.useRealTimers();
  }
});

test("a real socket resumes its seat with the token, and a second one replaces it with 4001", async () => {
  running = await startServer({ port: 0, botDelayMs: 0 });
  const origin = `http://127.0.0.1:${String(running.port)}`;
  const hello = (extra: object) => JSON.stringify({ type: "hello", protocol: 1, ...extra });

  const alice = await connect(running.port, origin);
  let welcome = until(alice, "welcome");
  let lobby = until(alice, "lobby.state");
  alice.send(hello({ name: "Alice" }));
  const { token } = await welcome;
  await lobby;
  alice.send(
    JSON.stringify({
      type: "lobby.create",
      seats: 2,
      bots: 0,
      influences: false,
      kickstarter: false,
    }),
  );
  const bob = await connect(running.port, origin);
  lobby = until(bob, "lobby.state", (message) => (message.games as unknown[]).length === 1);
  bob.send(hello({ name: "Bob" }));
  const game = ((await lobby).games as { id: string }[])[0].id;
  const started = until(bob, "game.update");
  bob.send(JSON.stringify({ type: "lobby.join", game }));
  expect(connected(await started)).toEqual([true, true]);

  // The socket drops: the seat stays and shows as not connected.
  let seen = until(bob, "game.update", (message) => !connected(message)[0]);
  alice.terminate();
  expect(connected(await seen)).toEqual([false, true]);

  // hello with the token: welcome, then the seat's view and history.
  const back = await connect(running.port, origin);
  const received: Record<string, unknown>[] = [];
  back.on("message", (data) => received.push(decode(data) as Record<string, unknown>));
  const resumed = until(back, "game.update");
  seen = until(bob, "game.update", (message) => connected(message)[0]);
  back.send(hello({ token }));
  const update = await resumed;
  expect(received.map((message) => message.type)).toEqual(["welcome", "game.update"]);
  expect(received[0]).toMatchObject({ token, name: "Alice" });
  expect(update).toMatchObject({ game, view: { you: 0 } });
  expect(connected(update)).toEqual([true, true]);
  expect((update.events as { type: string }[]).map((event) => event.type)).toEqual([
    "game_started",
    "turn_started",
  ]);
  expect(connected(await seen)).toEqual([true, true]);

  // The same token on another socket wins.
  const replaced = closed(back);
  const second = await connect(running.port, origin);
  welcome = until(second, "welcome");
  const again = until(second, "game.update");
  second.send(hello({ token }));
  expect(await welcome).toMatchObject({ token, name: "Alice" });
  expect(await replaced).toBe(4001);
  expect(await again).toMatchObject({ game, view: { you: 0 } });
  second.close();
  bob.close();
});

test("a real socket that answers no ping is dropped; one that answers stays", async () => {
  running = await startServer({ port: 0, pingIntervalMs: 20 });
  const origin = `http://127.0.0.1:${String(running.port)}`;
  const healthy = await connect(running.port, origin);
  let pings = 0;
  const pinged = new Promise<void>((resolve) => {
    healthy.on("ping", () => {
      if (++pings === 4) resolve();
    });
  });
  const dead = await connect(running.port, origin, { autoPong: false });
  expect(await closed(dead)).toBe(1006);
  await pinged;
  expect(healthy.readyState).toBe(WebSocket.OPEN);
  healthy.close();
});

test("a malformed frame drops that socket and leaves the server available", async () => {
  running = await startServer({ port: 0 });
  const port = running.port;
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(port, "127.0.0.1");
    socket.once("error", reject);
    socket.once("close", () => {
      resolve();
    });
    socket.once("data", () => {
      // A client frame must be masked; this text frame is not. The server
      // answers with a close frame, and the peer hangs up.
      socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
      socket.once("data", () => socket.end());
    });
    socket.write(
      `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\nOrigin: http://127.0.0.1:${String(port)}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
    );
  });
  const socket = await connect(port, `http://127.0.0.1:${String(port)}`);
  const welcome = until(socket, "welcome");
  socket.send(JSON.stringify({ type: "hello", protocol: 1, name: "Alice" }));
  expect(await welcome).toMatchObject({ type: "welcome", name: "Alice" });
  socket.close();
});
