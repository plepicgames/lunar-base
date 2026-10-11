import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { DecisionMaker } from "../bots/maker.ts";
import { builtinMaker } from "../bots/builtin/index.ts";
import { withFallback } from "../bots/fallback.ts";
import { startGame } from "../engine/index.ts";
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

export interface RunningServer {
  readonly port: number;
  /** The TCP connections this server holds open, for the tests of what a refusal leaves behind. */
  connections(): Promise<number>;
  close(): Promise<void>;
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
  const server = createServer(staticHandler(basePath, options.clientDir));
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
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
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      sockets.close();
    },
  };
}
