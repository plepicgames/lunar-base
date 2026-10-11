import { describe, expect, test } from "vitest";
import { createGame, viewFor } from "../engine/index.ts";
import { serverMessageSchema, type ServerMessage } from "../protocol/messages.ts";
import { createLobby, type LobbyGameRoom, type LobbyOptions } from "./lobby.ts";
import { createSessions } from "./sessions.ts";
import { memoryConnection } from "./transport.ts";

function setup(limits: Pick<LobbyOptions, "maxGames" | "mayCreate"> = {}) {
  const started: LobbyGameRoom[] = [];
  const lobby = createLobby({ ...limits, onStart: (game) => started.push(game) });
  const sessions = createSessions({
    jev: false,
    onBound: (session) => {
      lobby.onBound(session);
    },
    onMessage: (session, message) => {
      lobby.onMessage(session, message);
    },
  });
  function client(name: string, token?: string) {
    const [connection, server] = memoryConnection();
    const received: ServerMessage[] = [];
    connection.onMessage((text) => received.push(serverMessageSchema.parse(JSON.parse(text))));
    sessions.accept(server);
    connection.send(JSON.stringify({ type: "hello", protocol: 1, name, token }));
    return {
      connection,
      received,
      send: (message: unknown) => {
        connection.send(JSON.stringify(message));
      },
      last: () => received.at(-1),
      states: () => received.filter((message) => message.type === "lobby.state"),
    };
  }
  return { client, started };
}

const create = (seats: number, bots: number, extra: object = {}) => ({
  type: "lobby.create",
  seats,
  bots,
  influences: false,
  kickstarter: false,
  ...extra,
});

describe("lobby", () => {
  test("the 21st game is refused and the lobby still lists 20", () => {
    const { client } = setup();
    const observer = client("Observer");
    for (let index = 0; index < 20; index++) client(`Player ${String(index)}`).send(create(2, 0));
    const full = observer.last();
    if (full?.type !== "lobby.state") throw new Error("Expected lobby state");
    expect(full.games).toHaveLength(20);
    observer.send(create(2, 0));
    expect(observer.last()).toMatchObject({ type: "error" });
    const next = client("Next").last();
    if (next?.type !== "lobby.state") throw new Error("Expected lobby state");
    expect(next.games).toHaveLength(20);
  });

  test("the game cap is the server's setting", () => {
    const { client } = setup({ maxGames: 2 });
    client("Ann").send(create(2, 0));
    client("Bob").send(create(2, 0));
    const cy = client("Cy");
    cy.send(create(2, 0));
    expect(cy.last()).toEqual({
      type: "error",
      code: "bad_message",
      message: "The server is at its game limit.",
    });
    const state = client("Dee").last();
    if (state?.type !== "lobby.state") throw new Error("Expected lobby state");
    expect(state.games).toHaveLength(2);
  });

  test("a creator who may not create gets an error and no game; joining is not asked about", () => {
    const asked: string[] = [];
    const { client, started } = setup({
      mayCreate(session) {
        asked.push(session.name);
        return session.name !== "Bob";
      },
    });
    const ann = client("Ann");
    const bob = client("Bob");
    bob.send(create(2, 0));
    expect(bob.last()).toEqual({
      type: "error",
      code: "bad_message",
      message: "You have started too many games. Try again later.",
    });
    const before = ann.last();
    if (before?.type !== "lobby.state") throw new Error("Expected lobby state");
    expect(before.games).toHaveLength(0);
    ann.send(create(2, 0));
    const open = bob.states().at(-1);
    if (!open?.games[0]) throw new Error("Expected an open game");
    bob.send({ type: "lobby.join", game: open.games[0].id });
    expect(started).toHaveLength(1);
    expect(asked).toEqual(["Bob", "Ann"]);
  });

  test("a create refused for another reason is not counted against the creator", () => {
    const asked: string[] = [];
    const { client } = setup({
      maxGames: 1,
      mayCreate(session) {
        asked.push(session.name);
        return true;
      },
    });
    const ann = client("Ann");
    ann.send(create(2, 0));
    ann.send(create(2, 0));
    client("Bob").send(create(2, 0));
    client("Cy").send(create(2, 1, { botBrain: "jev" }));
    expect(asked).toEqual(["Ann"]);
  });

  test("one human and all remaining seats filled by bots start on creation", () => {
    const { client, started } = setup();
    const ann = client("Ann");
    ann.send(create(2, 1));
    expect(started).toHaveLength(1);
    expect(started[0]?.seats.map((seat) => seat?.kind)).toEqual(["human", "bot"]);
  });

  test("lobby.create with Influences starts a game whose view lists eight Influences", () => {
    const { client, started } = setup();
    const ann = client("Ann");
    ann.send(create(2, 1, { influences: true }));
    expect(started).toHaveLength(1);
    const game = started[0];
    expect(game.options.influences).toBe(true);
    const state = createGame({ seats: 2, ...game.options }, "lobby-influences");
    expect(viewFor(state, 0).influencesInGame).toHaveLength(8);
  });

  test.each([false, true])(
    "lobby.create with Kickstarter and influences=%s starts with eligible cards",
    (influences) => {
      const { client, started } = setup();
      client("Ann").send(create(2, 1, { influences, kickstarter: true }));
      expect(started).toHaveLength(1);
      const game = started[0];
      expect(game.options).toMatchObject({ influences, kickstarter: true });
      const state = createGame({ seats: 2, ...game.options }, "lobby-kickstarter");
      const view = viewFor(state, 0);
      expect(view.influencesInGame).toHaveLength(influences ? 8 : 0);
      const possible = Array.from({ length: 20 }, (_, seed) =>
        createGame({ seats: 2, ...game.options }, String(seed)),
      );
      expect(
        possible.some((candidate) =>
          candidate.bases.some(({ station }) =>
            candidate.cards[station.card].startsWith("ks-stn-"),
          ),
        ),
      ).toBe(true);
    },
  );

  test("creator, bot and joiner take seats in order; last human starts once", () => {
    const { client, started } = setup();
    const ann = client("Ann");
    const bo = client("Bo");
    ann.send(create(3, 1));
    expect(started).toHaveLength(0);
    const state = bo.last();
    expect(state).toMatchObject({
      type: "lobby.state",
      games: [{ creator: "Ann", seats: 3, bots: 1, humans: ["Ann"], humansWanted: 2 }],
    });
    if (state?.type !== "lobby.state") throw new Error("expected state");
    const id = state.games[0]?.id;
    bo.send({ type: "lobby.join", game: id });
    expect(started).toHaveLength(1);
    expect(started[0]?.seats.map((seat) => seat?.name)).toEqual(["Ann", "Bot 2", "Bo"]);
  });

  test("all bot seats start immediately and creator watches", () => {
    const { client, started } = setup();
    const ann = client("Ann");
    ann.send(create(2, 2));
    expect(started).toHaveLength(1);
    expect(started[0]?.seats.every((seat) => seat?.kind === "bot")).toBe(true);
    expect(started[0]?.creatorSeat).toBeNull();
    expect(ann.last()).toEqual({ type: "lobby.state", games: [] });
    ann.send({ type: "lobby.join", game: started[0]?.id });
    expect(ann.last()).toMatchObject({ type: "error", code: "not_in_lobby" });
  });

  test("lobby observer sees an open game appear and disappear", () => {
    const { client } = setup();
    const ann = client("Ann");
    const bo = client("Bo");
    const cy = client("Cy");
    ann.send(create(2, 0));
    expect(cy.last()).toMatchObject({
      type: "lobby.state",
      games: [{ humans: ["Ann"], humansWanted: 2 }],
    });
    const state = cy.last();
    if (state?.type !== "lobby.state") throw new Error("expected state");
    bo.send({ type: "lobby.join", game: state.games[0]?.id });
    expect(cy.last()).toEqual({ type: "lobby.state", games: [] });
  });

  test("reconnecting to a started game does not receive lobby state", () => {
    const { client, started } = setup();
    const ann = client("Ann");
    const bo = client("Bo");
    ann.send(create(2, 0));
    const state = bo.last();
    if (state?.type !== "lobby.state") throw new Error("expected state");
    bo.send({ type: "lobby.join", game: state.games[0]?.id });
    expect(started).toHaveLength(1);
    const welcome = ann.received[0];
    if (welcome.type !== "welcome") throw new Error("expected welcome");

    const resumed = client("Ann", welcome.token);
    expect(resumed.received.map((message) => message.type)).toEqual(["welcome"]);
  });

  test("creator leaving closes an open game and returns joiners to the lobby", () => {
    const { client } = setup();
    const ann = client("Ann");
    const bo = client("Bo");
    ann.send(create(3, 0));
    const state = bo.last();
    if (state?.type !== "lobby.state") throw new Error("expected state");
    const id = state.games[0]?.id;
    bo.send({ type: "lobby.join", game: id });
    ann.send({ type: "game.leave" });
    expect(bo.last()).toEqual({ type: "lobby.state", games: [] });
    bo.send({ type: "lobby.join", game: id });
    expect(bo.last()).toMatchObject({ type: "error", code: "game_not_found" });
  });

  test("a joined human can leave and free the next human seat", () => {
    const { client, started } = setup();
    const ann = client("Ann");
    const bo = client("Bo");
    const cy = client("Cy");
    ann.send(create(3, 0));
    const state = cy.last();
    if (state?.type !== "lobby.state") throw new Error("expected state");
    const id = state.games[0]?.id;
    bo.send({ type: "lobby.join", game: id });
    bo.send({ type: "game.leave" });
    cy.send({ type: "lobby.join", game: id });
    expect(started).toHaveLength(0);
    expect(cy.states().at(-1)).toMatchObject({ games: [{ humans: ["Ann", "Cy"] }] });
  });

  test("joining a game with no human seat returns game_full", () => {
    const { client, started } = setup();
    const ann = client("Ann");
    const bo = client("Bo");
    ann.send(create(2, 2));
    bo.send({ type: "lobby.join", game: started[0]?.id });
    expect(bo.last()).toMatchObject({ type: "error", code: "game_full" });
  });

  test("Create form omits botBrain; Jev is refused without a credential", () => {
    const { client, started } = setup();
    const ann = client("Ann");
    ann.send(create(2, 0, { botBrain: "jev" }));
    expect(ann.last()).toMatchObject({ type: "error", code: "bad_message" });
    ann.send(create(2, 0));
    expect(ann.last()).toMatchObject({
      type: "lobby.state",
      games: [{ options: { botBrain: "builtin" } }],
    });
    expect(started).toHaveLength(0);
  });
});
