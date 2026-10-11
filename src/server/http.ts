import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { DecisionMaker } from "../bots/maker.ts";
import { builtinMaker } from "../bots/builtin/index.ts";
import { withFallback } from "../bots/fallback.ts";
import { startGame } from "../engine/index.ts";
import { RESTART_CLOSE_CODE, type ServerMessage } from "../protocol/messages.ts";
import { basePrefix, normalizeBasePath } from "./base-path.ts";
import { createLobby } from "./lobby.ts";
import {
  createGameLog,
  DEFAULT_LOG_DIRECTORY,
  refuseLinkedLogDirectory,
  startGameLogSweep,
  type GameLogSettings,
} from "./gamelog.ts";
import {
  createVisitorLimits,
  DEFAULT_LIMITS,
  originAllowed,
  visitorAddress,
  type LimitSettings,
} from "./limits.ts";
import { createRoom, type Room } from "./room.ts";
import { createSessions, type Session } from "./sessions.ts";
import { staticHandler } from "./static.ts";
import { wsConnection, type Connection } from "./transport.ts";

export interface ServerOptions {
  readonly port?: number;
  readonly host?: string;
  /** The URL path the game is served under. Default `/`. */
  readonly basePath?: string;
  /** The client build to serve. Default `dist/client` of the repository. */
  readonly clientDir?: string;
  readonly seed?: string;
  readonly botDelayMs?: number;
  readonly takeoverDelayMs?: number;
  readonly jev?: DecisionMaker;
  readonly pingIntervalMs?: number;
  readonly log?: (line: string) => void;
  /**
   * Where this server writes its game logs, how long it keeps them and the
   * build it names in them. Old logs are deleted only when `days` is given.
   */
  readonly logs?: Partial<GameLogSettings>;
  /** What this server allows a visitor. A value left out is its default. */
  readonly limits?: Partial<LimitSettings>;
  /** The clock of the per-address limits. A test passes its own. */
  readonly now?: () => number;
}

/** How long a shutdown waits for its sockets before it drops them. */
export const SHUTDOWN_DEADLINE_MS = 10_000;

export interface ShutdownOptions {
  /** What asked for the shutdown; named in the first log line. */
  readonly signal?: string;
  /** Runs `run` after `ms` and returns its cancel. Default `setTimeout`; a test passes its own. */
  readonly schedule?: (run: () => void, ms: number) => () => void;
}

export interface ShutdownResult {
  /** True when a socket was still open after `SHUTDOWN_DEADLINE_MS` and was dropped. */
  readonly deadlineHit: boolean;
}

export interface RunningServer {
  readonly port: number;
  /** The TCP connections this server holds open, for the tests of what a refusal leaves behind. */
  connections(): Promise<number>;
  /** Drops every socket at once, for tests. */
  close(): Promise<void>;
  /**
   * Tells every client the server restarts, closes the sockets with 1012 and
   * stops listening. Never rejects. A second call returns the first one's promise.
   */
  shutdown(options?: ShutdownOptions): Promise<ShutdownResult>;
}

const RESTART: ServerMessage = { type: "server.restart" };

/** The probe answer. It says nothing about the build, the players or the games. */
function answerHealth(request: IncomingMessage, response: ServerResponse, stopping: boolean): void {
  const headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { ...headers, Allow: "GET, HEAD" }).end("Method not allowed.\n");
    return;
  }
  // Node sends no body for HEAD.
  response.writeHead(stopping ? 503 : 200, headers).end(stopping ? "shutting down\n" : "ok\n");
}

/** How long a refused upgrade may take to flush its answer before the socket is dropped. */
const REFUSAL_CLOSE_MS = 2_000;

/**
 * Answers an upgrade with an HTTP status and closes the socket from this
 * side. Ending it alone would only half-close it: a peer that never closes
 * its own side would keep the connection open, outside the connection count
 * and the heartbeat. Every refusal goes through here.
 */
function refuseUpgrade(socket: Duplex, status: string): void {
  const drop = () => socket.destroy();
  // The answer cannot be flushed, for example because the peer reads nothing.
  const timer = setTimeout(drop, REFUSAL_CLOSE_MS);
  timer.unref();
  socket.once("close", () => {
    clearTimeout(timer);
  });
  // A client reset while the refusal is sent must not stop the server.
  socket.once("error", drop);
  socket.once("finish", drop);
  socket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

/** Start the one-process HTTP and WebSocket game server. */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const basePath = normalizeBasePath(options.basePath ?? "/");
  const socketPath = `${basePrefix(basePath)}/ws`;
  const healthPath = `${basePrefix(basePath)}/healthz`;
  const log = options.log ?? console.log;
  /** Set when shutdown begins: health answers 503 and upgrades are refused. */
  let stopping: Promise<ShutdownResult> | undefined;
  const logDirectory = options.logs?.directory ?? DEFAULT_LOG_DIRECTORY;
  refuseLinkedLogDirectory(logDirectory);
  /** The games of this server whose room still exists. Its sweep spares their logs. */
  const openLogs = new Set<string>();
  const limits: LimitSettings = { ...DEFAULT_LIMITS, ...options.limits };
  /** This server's counters per visitor address, and the address of each open socket. */
  const visitors = createVisitorLimits({ settings: limits, now: options.now, log: options.log });
  const addresses = new WeakMap<Connection, string>();
  const rooms = new Map<string, Room>();
  const roomFor = (session: Session) => [...rooms.values()].find((room) => room.has(session));
  const lobby = createLobby({
    jev: options.jev !== undefined,
    maxGames: limits.maxGames,
    // A socket with no recorded address is refused, not let past the cap.
    mayCreate: (session) =>
      visitors.newGame(session.connection ? addresses.get(session.connection) : undefined),
    onStart(game) {
      const seed = options.seed ?? randomBytes(16).toString("hex");
      const config = {
        seats: game.seats.length,
        influences: game.options.influences,
        kickstarter: game.options.kickstarter,
      };
      const started = startGame(config, seed);
      const gameLog = createGameLog(game.id, config, seed, {
        log: options.log,
        directory: logDirectory,
        build: options.logs?.build,
        open: openLogs,
      });
      const room = createRoom(game, {
        state: started.state,
        events: started.events,
        gameLog,
        makeBuiltinMaker: (seat) => builtinMaker(seed, seat),
        makeMaker(seat) {
          const builtin = builtinMaker(seed, seat);
          return withFallback(
            game.options.botBrain === "jev" ? (options.jev ?? builtin) : builtin,
            builtin,
          );
        },
        botDelayMs: options.botDelayMs,
        takeoverDelayMs: options.takeoverDelayMs,
        onLeave: (session) => {
          lobby.release(session);
        },
        onEmpty: () => {
          rooms.delete(game.id);
        },
        onFinished: (session) => {
          sessions.refresh(session);
        },
        log: options.log,
      });
      rooms.set(game.id, room);
    },
  });
  const sessions = createSessions({
    jev: options.jev !== undefined,
    pingIntervalMs: options.pingIntervalMs,
    isRunning: (session) => {
      const room = roomFor(session);
      return room?.isRunning() === true && room.isSeated(session);
    },
    onDrop(session) {
      roomFor(session)?.onMessage(session, { type: "game.leave" });
      lobby.onDrop(session);
    },
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
  const serveStatic = staticHandler(basePath, options.clientDir);
  let listenerClosed: Promise<void> | undefined;
  /** The connections with a response under way. A shutdown lets these finish. */
  const answering = new Set<Socket>();
  const server = createServer((request, response) => {
    const { socket } = request;
    answering.add(socket);
    response.once("close", () => {
      answering.delete(socket);
      if (listenerClosed !== undefined) socket.destroy();
    });
    if (request.url?.split("?", 1)[0] === healthPath) {
      answerHealth(request, response, stopping !== undefined);
      return;
    }
    serveStatic(request, response);
  });
  // Every TCP connection, upgraded or not, so the shutdown deadline can drop them all.
  const connections = new Set<Socket>();
  server.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    // In this order: shutting down, then the path and the origin, then the cap.
    if (stopping !== undefined) {
      refuseUpgrade(socket, "503 Service Unavailable");
      return;
    }
    if (
      request.url?.split("?", 1)[0] !== socketPath ||
      !originAllowed(limits.allowedOrigins, request.headers.origin, request.headers.host)
    ) {
      refuseUpgrade(socket, "403 Forbidden");
      return;
    }
    // A socket that is already gone would never report its close.
    if (socket.destroyed) return;
    const address = visitorAddress(
      limits.trustProxy,
      request.headers,
      request.socket.remoteAddress,
    );
    if (!visitors.connect(address)) {
      refuseUpgrade(socket, "429 Too Many Requests");
      return;
    }
    // The place is held by the TCP socket, so every end gives it back: a
    // close, an error, a failed handshake and a ping timeout.
    socket.once("close", () => {
      visitors.disconnect(address);
    });
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      const connection = wsConnection(webSocket);
      addresses.set(connection, address);
      sessions.accept(connection);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 4780, options.host ?? "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    sockets.close();
    visitors.stop();
    throw error;
  }
  const days = options.logs?.days;
  const sweep =
    days === undefined
      ? undefined
      : startGameLogSweep({ directory: logDirectory, days, open: openLogs, log: options.log });
  /** Stop listening; settles when every connection has ended. */
  const closeListener = (): Promise<void> =>
    (listenerClosed ??= new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }));

  async function shutdown(request: ShutdownOptions): Promise<ShutdownResult> {
    const clients = [...sockets.clients];
    log(
      `shutdown begin signal=${request.signal ?? "none"} connections=${String(clients.length)} games=${String(rooms.size)}`,
    );
    sweep?.stop();
    visitors.stop();
    const drained = Promise.all(
      clients.map(
        (socket) =>
          new Promise<void>((resolve) => {
            socket.once("close", () => {
              resolve();
            });
          }),
      ),
    );
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(RESTART));
      socket.close(RESTART_CLOSE_CODE, "Server restarting");
    }
    // The games end here: no timer or bot answer outlives them, and each
    // log leaves the open set.
    for (const room of rooms.values()) room.stop();
    rooms.clear();
    // The listener stays up until the sockets are gone, so a probe gets 503
    // and a new upgrade is refused. It closes with the last socket. A
    // connection with no response under way is dropped then: Node keeps one
    // that never sent a request open, and it would hold the exit.
    const closed = drained
      .then(() => {
        const done = closeListener();
        for (const socket of connections) if (!answering.has(socket)) socket.destroy();
        return done;
      })
      .then(
        () => false,
        () => false,
      );
    let cancel = (): void => undefined;
    const deadline = new Promise<boolean>((resolve) => {
      const schedule =
        request.schedule ??
        ((run, ms) => {
          const timer = setTimeout(run, ms);
          return () => {
            clearTimeout(timer);
          };
        });
      cancel = schedule(() => {
        resolve(true);
      }, SHUTDOWN_DEADLINE_MS);
    });
    const deadlineHit = await Promise.race([closed, deadline]);
    cancel();
    if (deadlineHit) {
      log(
        `shutdown deadline hit ms=${String(SHUTDOWN_DEADLINE_MS)} sockets=${String(sockets.clients.size)}`,
      );
      for (const socket of connections) socket.destroy();
      void closeListener().catch(() => undefined);
    }
    sockets.close();
    log("shutdown end");
    return { deadlineHit };
  }

  return {
    port: (server.address() as AddressInfo).port,
    connections: () =>
      new Promise<number>((resolve, reject) => {
        server.getConnections((error, count) => {
          if (error) reject(error);
          else resolve(count);
        });
      }),
    async close() {
      sweep?.stop();
      visitors.stop();
      for (const socket of sockets.clients) socket.terminate();
      await closeListener();
      sockets.close();
    },
    shutdown: (request = {}) => (stopping ??= shutdown(request)),
  };
}
