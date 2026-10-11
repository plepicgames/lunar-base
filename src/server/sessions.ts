// Sessions: a token stands for one player across sockets (architecture,
// Reconnect). The first message of a connection must be `hello`. Every
// connection is pinged, so a dead one is noticed and closed.

import { randomBytes } from "node:crypto";
import {
  parseClientMessage,
  validName,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from "../protocol/messages.ts";
import type { Connection } from "./transport.ts";
import { IDLE_SESSION_TTL_MS, MAX_MESSAGE_BYTES, PING_INTERVAL_MS } from "./limits.ts";

/** Close code for a socket replaced by a newer one with the same token. */
export const REPLACED_CODE = 4001;

/** Time between two pings of a socket, and the time it has to answer one. */
export { PING_INTERVAL_MS };

export interface Session {
  readonly token: string;
  readonly name: string;
  /** The live socket, or null while the player is disconnected. */
  connection: Connection | null;
  /** Original disconnect time, including time spent waiting in the lobby. */
  disconnectedAt: number | null;
  send(message: ServerMessage): void;
}

export interface SessionsOptions {
  /** Whether the server has the Jev credential; reported in `welcome`. */
  readonly jev: boolean;
  /** Defaults to `PING_INTERVAL_MS`; a test over a real socket shortens it. */
  readonly pingIntervalMs?: number;
  /** Every message of a bound session except `hello`, already validated. */
  readonly onMessage?: (session: Session, message: ClientMessage) => void;
  /** The session's socket dropped and no newer socket replaced it. */
  readonly onDisconnect?: (session: Session) => void;
  /** Called after a session is bound to a connection, new or resumed. */
  readonly onBound?: (session: Session) => void;
  /** A running game retains its disconnected human sessions. */
  readonly isRunning?: (session: Session) => boolean;
  readonly onDrop?: (session: Session) => void;
}

export interface Sessions {
  /** Takes over a new connection: waits for its `hello`. */
  accept(connection: Connection): void;
  get(token: string): Session | undefined;
  /** Forgets a session and frees its name. */
  drop(token: string): void;
  /** Recheck an absent session when its game ends. */
  refresh(session: Session): void;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function createSessions(options: SessionsOptions): Sessions {
  const byToken = new Map<string, Session>();
  const byName = new Map<string, Session>();
  const expiryTimers = new Map<Session, ReturnType<typeof setTimeout>>();

  function clearExpiry(session: Session): void {
    clearTimeout(expiryTimers.get(session));
    expiryTimers.delete(session);
  }

  function scheduleExpiry(session: Session): void {
    clearExpiry(session);
    if (session.connection || session.disconnectedAt === null || options.isRunning?.(session))
      return;
    const remaining = Math.max(0, IDLE_SESSION_TTL_MS - (Date.now() - session.disconnectedAt));
    const timer = setTimeout(() => {
      expiryTimers.delete(session);
      if (session.connection || options.isRunning?.(session)) return;
      drop(session.token);
    }, remaining);
    timer.unref();
    expiryTimers.set(session, timer);
  }

  function drop(token: string): void {
    const session = byToken.get(token);
    if (session === undefined) return;
    clearExpiry(session);
    byToken.delete(token);
    byName.delete(nameKey(session.name));
    options.onDrop?.(session);
  }

  function fail(connection: Connection, code: ErrorCode, message: string): void {
    const error: ServerMessage = { type: "error", code, message };
    connection.send(JSON.stringify(error));
  }

  function bind(session: Session, connection: Connection): void {
    const previous = session.connection;
    session.connection = connection;
    session.disconnectedAt = null;
    clearExpiry(session);
    previous?.close(REPLACED_CODE, "Replaced by a newer connection.");
    session.send({
      type: "welcome",
      protocol: 1,
      token: session.token,
      name: session.name,
      jev: options.jev,
    });
    options.onBound?.(session);
  }

  function create(name: string): Session {
    const token = randomBytes(16).toString("hex");
    const session: Session = {
      token,
      name,
      connection: null,
      disconnectedAt: null,
      send(message) {
        this.connection?.send(JSON.stringify(message));
      },
    };
    byToken.set(token, session);
    byName.set(nameKey(name), session);
    return session;
  }

  function accept(connection: Connection): void {
    let bound: Session | null = null;

    // A socket that has not answered the last ping by the next one is dead.
    // Dropping it runs the close handler below like any other drop.
    let answered = true;
    connection.onPong(() => {
      answered = true;
    });
    const heartbeat = setInterval(() => {
      if (!answered) {
        connection.terminate();
        return;
      }
      answered = false;
      connection.ping();
    }, options.pingIntervalMs ?? PING_INTERVAL_MS);
    // The timer alone must not keep the process alive.
    heartbeat.unref();

    connection.onMessage((text) => {
      const parsed = parseClientMessage(text, MAX_MESSAGE_BYTES);
      if (!parsed.ok) {
        connection.send(JSON.stringify(parsed.error));
        return;
      }
      const { message } = parsed;
      if (bound !== null) {
        // A replaced socket can still deliver frames until its close
        // handshake ends; the new socket owns the session.
        if (bound.connection !== connection) return;
        if (message.type === "hello") fail(connection, "bad_message", "Already said hello.");
        else options.onMessage?.(bound, message);
        return;
      }
      if (message.type !== "hello") {
        fail(connection, "bad_message", "The first message must be hello.");
        return;
      }
      const known = message.token === undefined ? undefined : byToken.get(message.token);
      if (known !== undefined) {
        bound = known;
        bind(known, connection);
        return;
      }
      if (message.name === undefined || !validName(message.name)) {
        fail(
          connection,
          "name_invalid",
          "A name has 1 to 20 characters and no control characters.",
        );
        return;
      }
      if (byName.has(nameKey(message.name))) {
        fail(connection, "name_taken", "Another player uses that name.");
        return;
      }
      bound = create(message.name.trim());
      bind(bound, connection);
    });

    connection.onClose(() => {
      clearInterval(heartbeat);
      // A replaced socket closes after the new one is bound; it leaves the
      // session alone.
      if (bound?.connection !== connection) return;
      bound.connection = null;
      bound.disconnectedAt = Date.now();
      options.onDisconnect?.(bound);
      scheduleExpiry(bound);
    });
  }

  return {
    accept,
    get: (token) => byToken.get(token),
    drop,
    refresh: scheduleExpiry,
  };
}
