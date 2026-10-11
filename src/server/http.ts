import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
import { createRoom, type Room } from "./room.ts";
import { createSessions, type Session } from "./sessions.ts";
import { staticHandler } from "./static.ts";
import { wsConnection } from "./transport.ts";

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
}

export interface RunningServer {
  readonly port: number;
  close(): Promise<void>;
}

/** Start the one-process HTTP and WebSocket game server. */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const basePath = normalizeBasePath(options.basePath ?? "/");
  const socketPath = `${basePrefix(basePath)}/ws`;
  const logDirectory = options.logs?.directory ?? DEFAULT_LOG_DIRECTORY;
  refuseLinkedLogDirectory(logDirectory);
  /** The games of this server whose room still exists. Its sweep spares their logs. */
  const openLogs = new Set<string>();
  const rooms = new Map<string, Room>();
  const roomFor = (session: Session) => [...rooms.values()].find((room) => room.has(session));
  const lobby = createLobby({
    jev: options.jev !== undefined,
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
  sockets.on("connection", (socket) => {
    sessions.accept(wsConnection(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    let validOrigin = false;
    try {
      validOrigin =
        new URL(request.headers.origin ?? "").host.toLowerCase() ===
        request.headers.host?.toLowerCase();
    } catch {
      // Missing or malformed Origin is refused like a foreign host.
    }
    if (request.url?.split("?", 1)[0] !== socketPath || !validOrigin) {
      socket.once("error", () => socket.destroy());
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      sockets.emit("connection", webSocket, request);
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
    throw error;
  }
  const days = options.logs?.days;
  const sweep =
    days === undefined
      ? undefined
      : startGameLogSweep({ directory: logDirectory, days, open: openLogs, log: options.log });
  return {
    port: (server.address() as AddressInfo).port,
    async close() {
      sweep?.stop();
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
