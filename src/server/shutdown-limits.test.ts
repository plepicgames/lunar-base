import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import WebSocket from "ws";
import { startServer, type RunningServer } from "./http.ts";
import { createVisitorLimits, type VisitorLimits } from "./limits.ts";

// The real limits, with the calls recorded: the test reads the counters of
// the server it started, which the server does not show.
vi.mock("./limits.ts", { spy: true });

let running: RunningServer | undefined;
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lunar-shutdown-limits-"));
});
afterEach(async () => {
  await running?.close();
  running = undefined;
  rmSync(directory, { recursive: true, force: true });
});

async function start(): Promise<{ server: RunningServer; visitors: VisitorLimits }> {
  vi.mocked(createVisitorLimits).mockClear();
  running = await startServer({
    port: 0,
    host: "127.0.0.1",
    clientDir: join(directory, "no-client-build"),
    log: () => {},
    logs: { directory: join(directory, "games") },
  });
  const visitors = vi.mocked(createVisitorLimits).mock.results[0].value as VisitorLimits;
  return { server: running, visitors };
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      origin: `http://127.0.0.1:${String(port)}`,
    });
    socket.once("open", () => {
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

test("a shutdown gives back every connection place and stops the limits timer", async () => {
  const { server, visitors } = await start();
  const stop = vi.spyOn(visitors, "stop");
  await connect(server.port);
  await connect(server.port);
  // Both sockets are one address: one entry, two TCP connections.
  expect(visitors.size().connections).toBe(1);
  expect(await server.connections()).toBe(2);

  expect(await server.shutdown()).toEqual({ deadlineHit: false });
  expect(stop).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => {
    expect(visitors.size().connections).toBe(0);
  });
});

test("the deadline gives back the place of a socket that never closes, and a refused upgrade takes none", async () => {
  const { server, visitors } = await start();
  const { port } = server;
  // A peer that completes the handshake and then answers nothing.
  const hung = createConnection(port, "127.0.0.1");
  await new Promise<void>((resolve) => {
    hung.once("data", () => {
      resolve();
    });
    hung.write(
      `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\n` +
        `Origin: http://127.0.0.1:${String(port)}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
        "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
  });
  expect(visitors.size().connections).toBe(1);
  const asked = vi.spyOn(visitors, "connect");

  let deadline = (): void => undefined;
  const stopping = server.shutdown({
    schedule(run) {
      deadline = run;
      return () => undefined;
    },
  });
  // Refused with 503 before the cap is asked: the count stays at the one hung socket.
  await expect(connect(port)).rejects.toThrow("503");
  expect(asked).not.toHaveBeenCalled();
  expect(visitors.size().connections).toBe(1);

  deadline();
  expect(await stopping).toEqual({ deadlineHit: true });
  await vi.waitFor(() => {
    expect(visitors.size().connections).toBe(0);
  });
});
