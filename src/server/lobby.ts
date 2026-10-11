// Open games and their seats. The room owns a game after onStart fires.
import { randomUUID } from "node:crypto";
import type { ClientMessage, LobbyGame, ServerMessage } from "../protocol/messages.ts";
import type { Session } from "./sessions.ts";
import { MAX_GAMES } from "./limits.ts";

export interface LobbySeat {
  readonly kind: "human" | "bot";
  readonly name: string;
  readonly session?: Session;
}

export interface LobbyGameRoom {
  readonly id: string;
  readonly creator: Session;
  readonly creatorSeat: number | null;
  readonly seats: readonly (LobbySeat | null)[];
  readonly options: LobbyGame["options"];
}

interface OpenGame {
  readonly id: string;
  readonly creator: Session;
  readonly creatorSeat: number | null;
  readonly seats: (LobbySeat | null)[];
  readonly options: LobbyGame["options"];
  started: boolean;
}

export interface LobbyOptions {
  readonly jev?: boolean;
  readonly onStart: (game: LobbyGameRoom) => void;
}

export interface Lobby {
  /** A finished room returns one participant to the lobby. */
  release(session: Session): void;
  /** Forget an expired disconnected session, including any open seat. */
  onDrop(session: Session): void;
  /** Pass these to createSessions. */
  onBound(session: Session): void;
  onMessage(session: Session, message: ClientMessage): void;
}

export function createLobby(options: LobbyOptions): Lobby {
  const sessions = new Set<Session>();
  const games = new Map<string, OpenGame>();
  const membership = new Map<Session, OpenGame>();

  function fail(
    session: Session,
    code: "bad_message" | "not_in_lobby" | "game_not_found" | "game_full",
    message: string,
  ): void {
    session.send({ type: "error", code, message });
  }

  function openGames(): LobbyGame[] {
    return [...games.values()]
      .filter((game) => !game.started)
      .map((game) => ({
        id: game.id,
        creator: game.creator.name,
        seats: game.seats.length,
        bots: game.seats.filter((seat) => seat?.kind === "bot").length,
        humans: game.seats
          .filter((seat): seat is LobbySeat => seat?.kind === "human")
          .map((seat) => seat.name),
        humansWanted: game.seats.filter((seat) => seat?.kind !== "bot").length,
        options: game.options,
      }));
  }

  function sendState(session: Session): void {
    const message: ServerMessage = { type: "lobby.state", games: openGames() };
    session.send(message);
  }

  function broadcast(): void {
    for (const session of sessions) {
      if (!membership.get(session)?.started) sendState(session);
    }
  }

  function start(game: OpenGame): void {
    game.started = true;
    options.onStart({
      id: game.id,
      creator: game.creator,
      creatorSeat: game.creatorSeat,
      seats: [...game.seats],
      options: { ...game.options },
    });
    broadcast();
  }

  function create(
    session: Session,
    message: Extract<ClientMessage, { type: "lobby.create" }>,
  ): void {
    if (membership.has(session)) {
      fail(session, "not_in_lobby", "Leave your game first.");
      return;
    }
    if (message.botBrain === "jev" && !options.jev) {
      fail(session, "bad_message", "That game option is not available yet.");
      return;
    }
    if (games.size >= MAX_GAMES) {
      fail(session, "bad_message", "The server is at its game limit.");
      return;
    }
    const id = randomUUID();
    const allBots = message.bots === message.seats;
    const seats: (LobbySeat | null)[] = Array.from({ length: message.seats }, () => null);
    if (!allBots) seats[0] = { kind: "human", name: session.name, session };
    for (let i = allBots ? 0 : 1; i < message.bots + (allBots ? 0 : 1); i++) {
      seats[i] = { kind: "bot", name: `Bot ${String(i + 1)}` };
    }
    const game: OpenGame = {
      id,
      creator: session,
      creatorSeat: allBots ? null : 0,
      seats,
      options: {
        influences: message.influences,
        kickstarter: message.kickstarter,
        botBrain: message.botBrain,
      },
      started: false,
    };
    games.set(id, game);
    membership.set(session, game);
    if (seats.every((seat) => seat !== null)) start(game);
    else broadcast();
  }

  function join(session: Session, id: string): void {
    if (membership.has(session)) {
      fail(session, "not_in_lobby", "Leave your game first.");
      return;
    }
    const game = games.get(id);
    if (!game) {
      fail(session, "game_not_found", "No such game.");
      return;
    }
    const free = game.seats.findIndex((seat) => seat === null);
    if (free < 0 || game.started) {
      fail(session, "game_full", "The game has no free human seat.");
      return;
    }
    game.seats[free] = { kind: "human", name: session.name, session };
    membership.set(session, game);
    if (game.seats.every((seat) => seat !== null)) start(game);
    else broadcast();
  }

  function leave(session: Session): void {
    const game = membership.get(session);
    if (!game) {
      fail(session, "not_in_lobby", "You are not in a game.");
      return;
    }
    if (game.started) return; // Running-game leave belongs to the room (T024).
    if (game.creator === session) {
      games.delete(game.id);
      for (const seat of game.seats) if (seat?.session) membership.delete(seat.session);
      membership.delete(session);
    } else {
      const index = game.seats.findIndex((seat) => seat?.session === session);
      if (index >= 0) game.seats[index] = null;
      membership.delete(session);
    }
    broadcast();
  }

  return {
    onDrop(session) {
      sessions.delete(session);
      const game = membership.get(session);
      if (game && !game.started) leave(session);
    },
    release(session) {
      const game = membership.get(session);
      if (!game?.started) return;
      membership.delete(session);
      if (![...membership.values()].includes(game)) games.delete(game.id);
      sendState(session);
    },
    onBound(session) {
      sessions.add(session);
      if (!membership.get(session)?.started) sendState(session);
    },
    onMessage(session, message) {
      switch (message.type) {
        case "lobby.create":
          create(session, message);
          break;
        case "lobby.join":
          join(session, message.game);
          break;
        case "game.leave":
          leave(session);
          break;
        case "game.decide":
        case "hello":
          break;
      }
    },
  };
}
