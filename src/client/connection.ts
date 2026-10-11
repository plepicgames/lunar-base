// The client's one WebSocket (architecture, Protocol and Reconnect). It
// validates every server message with the protocol schemas and keeps the
// session, the lobby and the game; it holds no rules.

import { useEffect, useState, useSyncExternalStore } from "react";
import { socketUrl, tokenKey } from "./base.ts";
import {
  PROTOCOL_VERSION,
  RESTART_CLOSE_CODE,
  serverMessageSchema,
  type ClientMessageInput,
  type ErrorMessage,
  type LobbyGame,
  type ServerMessage,
} from "../protocol/messages.ts";

/**
 * Where the tab keeps its session token when the game is served at the root;
 * `tokenKey` adds the base path elsewhere. Each tab is its own player.
 */
export const TOKEN_KEY = "lunar-base.token";

type Message<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>;

export interface Session {
  readonly token: string;
  readonly name: string;
  /** Whether the server can use Jev for non-human players. */
  readonly jev: boolean;
}

export interface GameState {
  readonly game: string;
  readonly seq: number;
  readonly view: Message<"game.update">["view"];
  /** The events of the latest update only. */
  readonly events: Message<"game.update">["events"];
  /** Seat-projected event history, with private fields only for this seat. */
  readonly history?: Message<"game.update">["events"];
  /** One sentence per event of this game since the client joined it, oldest first. */
  readonly log: readonly string[];
}

export interface ConnectionState {
  /**
   * `connecting`: no socket yet; `resuming`: socket open and a stored token
   * sent, no answer yet; `open`: socket open; `closed`: the socket ended.
   */
  readonly status: "idle" | "connecting" | "resuming" | "open" | "closed";
  /** Set by `welcome`. The Name screen shows until then. */
  readonly session: Session | null;
  /** Open games. Set when the session is in the lobby, null in a game. */
  readonly lobby: readonly LobbyGame[] | null;
  readonly game: GameState | null;
  /** The latest refusal. The next `send` clears it. */
  readonly error: ErrorMessage | null;
  /**
   * `restarted`: the server said it restarts, so the session and its game are
   * gone. Nothing retries; `reset` starts again.
   */
  readonly interruption: "none" | "reconnecting" | "other-tab" | "restarted";
  readonly lostGame: boolean;
}

export interface Connection {
  readonly getState: () => ConnectionState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Opens the socket. Does nothing while one is open. */
  readonly open: () => void;
  /** Closes the socket and ignores what it still says. */
  readonly close: () => void;
  /** Forgets the session and its game and opens a new socket: the Name screen. */
  readonly reset: () => void;
  /** Sends one message. Returns false, sending nothing, unless the socket is open. */
  readonly send: (message: ClientMessageInput) => boolean;
}

const INITIAL: ConnectionState = {
  status: "idle",
  session: null,
  lobby: null,
  game: null,
  error: null,
  interruption: "none",
  lostGame: false,
};

function readToken(): string | null {
  try {
    return window.sessionStorage.getItem(tokenKey());
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) window.sessionStorage.removeItem(tokenKey());
    else window.sessionStorage.setItem(tokenKey(), token);
  } catch {
    // Storage can be blocked. The session then lasts until the socket drops.
  }
}

/** A message as the server sent it, or null when it is not one. */
function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = serverMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createConnection(): Connection {
  let state = INITIAL;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  let fullHistoryOnNextUpdate = false;
  const listeners = new Set<() => void>();

  function set(next: ConnectionState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function apply(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        if (
          state.status === "resuming" &&
          state.session !== null &&
          message.token !== state.session.token
        ) {
          writeToken(null);
          set({ ...INITIAL, status: "open", lostGame: true });
          return;
        }
        writeToken(message.token);
        set({
          ...state,
          status: "open",
          session: { token: message.token, name: message.name, jev: message.jev },
          error: null,
        });
        return;
      case "lobby.state":
        retryCount = 0;
        fullHistoryOnNextUpdate = false;
        set({ ...state, lobby: message.games, game: null, interruption: "none" });
        return;
      case "game.update": {
        // seq grows with every update of a game; an older one is stale.
        const current = state.game;
        if (current?.game === message.game && message.seq < current.seq) return;
        retryCount = 0;
        const prior = fullHistoryOnNextUpdate ? null : current;
        fullHistoryOnNextUpdate = false;
        set({
          ...state,
          interruption: "none",
          lobby: null,
          game: {
            game: message.game,
            seq: message.seq,
            view: message.view,
            events: message.events,
            history: [
              ...(prior?.game === message.game ? (prior.history ?? []) : []),
              ...message.events,
            ],
            log: [
              ...(prior?.game === message.game ? prior.log : []),
              ...message.events.map((event) => event.text),
            ],
          },
        });
        return;
      }
      case "error":
        // A stored token the server no longer knows gets name_invalid for the
        // missing name. That is not the player's mistake: show the Name screen.
        if (state.status === "resuming" && message.code === "name_invalid") {
          writeToken(null);
          set({ ...INITIAL, status: "open", lostGame: true });
          return;
        }
        set({ ...state, error: message });
        if (errorTimer !== null) clearTimeout(errorTimer);
        errorTimer = setTimeout(() => {
          errorTimer = null;
          if (state.error === message) set({ ...state, error: null });
        }, 4000);
        return;
      case "server.restart":
        // With no session nothing is lost: the close that follows is a drop.
        if (state.session === null) return;
        writeToken(null);
        set({ ...state, interruption: "restarted" });
        return;
    }
  }

  function open(): void {
    if (socket !== null) return;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const created = new WebSocket(socketUrl());
    socket = created;
    set(
      state.interruption === "reconnecting"
        ? { ...state, status: "connecting" }
        : { ...INITIAL, status: "connecting" },
    );
    created.onopen = () => {
      if (socket !== created) return;
      const token = readToken();
      if (token === null) {
        const lostGame = state.interruption === "reconnecting" && state.session !== null;
        fullHistoryOnNextUpdate = false;
        set(
          lostGame
            ? { ...INITIAL, status: "open", lostGame: true }
            : {
                ...state,
                status: "open",
                interruption: "none",
              },
        );
        return;
      }
      fullHistoryOnNextUpdate = state.interruption === "reconnecting";
      created.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, token }));
      set({ ...state, status: "resuming" });
    };
    created.onmessage = (event) => {
      if (socket !== created) return;
      const message = parseServerMessage(event.data);
      if (message !== null) apply(message);
    };
    created.onclose = (event) => {
      if (socket !== created) return;
      socket = null;
      if (event.code === 4001) {
        set({ ...state, status: "closed", interruption: "other-tab" });
        return;
      }
      // The restart message, or its close code alone: the server forgot the
      // session, so a retry could only fail. The player starts again by hand.
      if (
        state.session !== null &&
        (state.interruption === "restarted" || event.code === RESTART_CLOSE_CODE)
      ) {
        writeToken(null);
        set({ ...state, status: "closed", interruption: "restarted" });
        return;
      }
      set({ ...state, status: "closed", interruption: "reconnecting" });
      retryTimer = setTimeout(
        () => {
          retryTimer = null;
          retryCount += 1;
          open();
        },
        Math.min(250 * 2 ** retryCount, 5000),
      );
    };
  }

  function close(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (errorTimer !== null) clearTimeout(errorTimer);
    retryTimer = null;
    errorTimer = null;
    fullHistoryOnNextUpdate = false;
    const current = socket;
    socket = null;
    current?.close();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open,
    close,
    reset() {
      close();
      writeToken(null);
      retryCount = 0;
      state = INITIAL;
      open();
    },
    send(message) {
      if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      if (state.error !== null) set({ ...state, error: null });
      return true;
    },
  };
}

export interface ConnectionHandle extends ConnectionState {
  readonly send: Connection["send"];
  readonly reset: Connection["reset"];
}

/** The connection of this component tree: its state and a send function. */
export function useConnection(): ConnectionHandle {
  const [connection] = useState(createConnection);
  useEffect(() => {
    connection.open();
    return () => {
      connection.close();
    };
  }, [connection]);
  const state = useSyncExternalStore(connection.subscribe, connection.getState);
  return { ...state, send: connection.send, reset: connection.reset };
}
