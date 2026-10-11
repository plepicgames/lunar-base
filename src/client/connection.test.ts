import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createGame, viewFor, type Seat } from "../engine/index.ts";
import type { GameView, ServerMessage } from "../protocol/messages.ts";
import { assetUrl, socketUrl, tokenKey } from "./base.ts";
import { createConnection, TOKEN_KEY } from "./connection.ts";
import { FakeWebSocket } from "./testing/fake-socket.ts";

const token = "0123456789abcdef0123456789abcdef";
const engineState = createGame({ seats: 2, influences: false, kickstarter: false }, "client-test");

function gameView(seat: Seat): GameView {
  const view = viewFor(engineState, seat);
  return {
    ...view,
    players: view.players.map((player) => ({
      ...player,
      name: `Player ${String(player.seat)}`,
      kind: "human",
      connected: true,
    })),
  };
}

function update(seq: number, game = "g1"): ServerMessage {
  return { type: "game.update", game, seq, view: gameView(0), events: [] };
}

const welcome: ServerMessage = {
  type: "welcome",
  protocol: 1,
  token,
  name: "Ann",
  jev: false,
};

let restore: () => void;
beforeEach(() => {
  restore = FakeWebSocket.install();
});
afterEach(() => {
  restore();
  window.sessionStorage.clear();
});

function opened() {
  const connection = createConnection();
  connection.open();
  FakeWebSocket.current.open();
  return connection;
}

describe("connection", () => {
  test("connects to /ws on the page's host and starts with no session", () => {
    const connection = createConnection();
    connection.open();
    expect(FakeWebSocket.current.url).toBe(`ws://${window.location.host}/ws`);
    expect(connection.getState().status).toBe("connecting");
    FakeWebSocket.current.open();
    expect(connection.getState().status).toBe("open");
    expect(connection.getState().session).toBeNull();
    expect(FakeWebSocket.current.sent).toEqual([]);
  });

  test("hello with a name starts a session, and welcome keeps the token in sessionStorage", () => {
    const connection = opened();
    expect(connection.send({ type: "hello", protocol: 1, name: "Ann" })).toBe(true);
    expect(FakeWebSocket.current.messages).toEqual([{ type: "hello", protocol: 1, name: "Ann" }]);
    FakeWebSocket.current.receive(welcome);
    expect(connection.getState().session).toEqual({ token, name: "Ann", jev: false });
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBe(token);
  });

  test("a stored token is sent as hello on open, and welcome resumes", () => {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    const connection = opened();
    expect(FakeWebSocket.current.messages).toEqual([{ type: "hello", protocol: 1, token }]);
    expect(connection.getState().status).toBe("resuming");
    FakeWebSocket.current.receive(welcome);
    expect(connection.getState().status).toBe("open");
    expect(connection.getState().session?.name).toBe("Ann");
  });

  test("a token the server does not know is forgotten without an error", () => {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    const connection = opened();
    FakeWebSocket.current.receive({
      type: "error",
      code: "name_invalid",
      message: "Choose a name.",
    });
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(connection.getState().status).toBe("open");
    expect(connection.getState().error).toBeNull();
  });

  test("lobby.state and game.update fill the lobby and game state", () => {
    const connection = opened();
    FakeWebSocket.current.receive(welcome);
    FakeWebSocket.current.receive({ type: "lobby.state", games: [] });
    expect(connection.getState().lobby).toEqual([]);
    FakeWebSocket.current.receive(update(1));
    expect(connection.getState().game?.seq).toBe(1);
    expect(connection.getState().game?.game).toBe("g1");
    FakeWebSocket.current.receive({ type: "lobby.state", games: [] });
    expect(connection.getState().game).toBeNull();
  });

  test("a game.update with a lower seq does not change the state", () => {
    const connection = opened();
    FakeWebSocket.current.receive(welcome);
    FakeWebSocket.current.receive(update(5));
    const before = connection.getState();
    FakeWebSocket.current.receive(update(4));
    expect(connection.getState()).toBe(before);
    FakeWebSocket.current.receive(update(6));
    expect(connection.getState().game?.seq).toBe(6);
  });

  test("keeps seat-projected events across updates beside the sentence log", () => {
    const connection = opened();
    FakeWebSocket.current.receive(welcome);
    const first = { type: "turn_started" as const, seat: 0, turn: 1, text: "Ann started turn 1." };
    const second = {
      type: "hand_seen" as const,
      looker: 0,
      opponent: 1,
      cards: [{ instance: "c1", cardId: "mod-depot" }],
      text: "Ann looked at Bea's hand: Depot.",
    };
    FakeWebSocket.current.receive({ ...update(1), events: [first] });
    FakeWebSocket.current.receive({ ...update(2), events: [second] });
    expect(connection.getState().game?.history).toEqual([first, second]);
    expect(connection.getState().game?.log).toEqual([first.text, second.text]);
  });

  test("a resumed full history replaces the retained history instead of duplicating it", () => {
    vi.useFakeTimers();
    try {
      window.sessionStorage.setItem(TOKEN_KEY, token);
      const connection = opened();
      FakeWebSocket.current.receive(welcome);
      const first = { type: "turn_started" as const, seat: 0, turn: 1, text: "Turn 1 starts." };
      const second = { type: "turn_started" as const, seat: 1, turn: 2, text: "Turn 2 starts." };
      FakeWebSocket.current.receive({ ...update(1), events: [first] });
      FakeWebSocket.current.receive({ ...update(2), events: [second] });
      FakeWebSocket.current.drop();
      vi.advanceTimersByTime(250);
      FakeWebSocket.current.open();
      FakeWebSocket.current.receive(welcome);
      FakeWebSocket.current.receive({ ...update(3), events: [first, second] });
      expect(connection.getState().game?.history).toEqual([first, second]);
      expect(connection.getState().game?.log).toEqual([first.text, second.text]);
      connection.close();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a game.update of another game is taken whatever its seq", () => {
    const connection = opened();
    FakeWebSocket.current.receive(welcome);
    FakeWebSocket.current.receive(update(5, "g1"));
    FakeWebSocket.current.receive(update(1, "g2"));
    expect(connection.getState().game).toMatchObject({ game: "g2", seq: 1 });
  });

  test.each([
    ["text that is not JSON", "{not json"],
    ["an unknown type", { type: "chat", text: "hi" }],
    ["a field of the full state", { ...update(2), view: { ...gameView(0), rng: {} } }],
    ["a bad error code", { type: "error", code: "oops", message: "x" }],
    ["a welcome with a bad token", { ...welcome, token: "short" }],
  ])("drops a server message with %s and does not change the state", (_name, frame) => {
    const connection = opened();
    FakeWebSocket.current.receive(welcome);
    FakeWebSocket.current.receive(update(3));
    const before = connection.getState();
    let notified = 0;
    connection.subscribe(() => (notified += 1));
    FakeWebSocket.current.receive(frame);
    expect(connection.getState()).toBe(before);
    expect(notified).toBe(0);
  });

  test("an error is kept until the next send", () => {
    const connection = opened();
    FakeWebSocket.current.receive({ type: "error", code: "name_taken", message: "Taken." });
    expect(connection.getState().error).toEqual({
      type: "error",
      code: "name_taken",
      message: "Taken.",
    });
    connection.send({ type: "hello", protocol: 1, name: "Bea" });
    expect(connection.getState().error).toBeNull();
  });

  test("send before the socket is open sends nothing", () => {
    const connection = createConnection();
    connection.open();
    expect(connection.send({ type: "hello", protocol: 1, name: "Ann" })).toBe(false);
    expect(FakeWebSocket.current.sent).toEqual([]);
  });

  test("a closed socket shows as closed and send refuses", () => {
    const connection = opened();
    FakeWebSocket.current.drop();
    expect(connection.getState().status).toBe("closed");
    expect(connection.send({ type: "game.leave" })).toBe(false);
  });

  test("close detaches the socket and open starts a fresh one", () => {
    const connection = opened();
    const first = FakeWebSocket.current;
    connection.close();
    expect(first.closeCode).toBe(1000);
    connection.open();
    expect(FakeWebSocket.instances).toHaveLength(2);
    first.receive(welcome);
    expect(connection.getState().session).toBeNull();
  });
});

describe("base", () => {
  test.each([
    ["http://localhost:4780/", "ws://localhost:4780/ws"],
    ["http://localhost:4780/?plain=1#top", "ws://localhost:4780/ws"],
    ["http://localhost:4780/index.html", "ws://localhost:4780/ws"],
    ["https://example.com/", "wss://example.com/ws"],
    ["http://example.com/play/lunar-base/", "ws://example.com/play/lunar-base/ws"],
    ["https://example.com/play/lunar-base/", "wss://example.com/play/lunar-base/ws"],
    ["https://example.com/play/lunar-base/?plain=1", "wss://example.com/play/lunar-base/ws"],
    ["https://example.com/play/lunar-base/index.html", "wss://example.com/play/lunar-base/ws"],
  ])("a page at %s opens its socket at %s", (page, socket) => {
    expect(socketUrl(page)).toBe(socket);
  });

  test.each([
    ["http://localhost:4780/", "/cards/w240/mod-depot.webp"],
    ["https://example.com/?plain=1", "/cards/w240/mod-depot.webp"],
    ["http://example.com/play/lunar-base/", "/play/lunar-base/cards/w240/mod-depot.webp"],
    ["https://example.com/play/lunar-base/", "/play/lunar-base/cards/w240/mod-depot.webp"],
    [
      "https://example.com/play/lunar-base/index.html",
      "/play/lunar-base/cards/w240/mod-depot.webp",
    ],
  ])("a page at %s loads a card image from %s", (page, image) => {
    expect(assetUrl("cards/w240/mod-depot.webp", page)).toBe(image);
  });

  test("the token key is the plain one at the root and names the base elsewhere", () => {
    expect(tokenKey("http://localhost:4780/")).toBe(TOKEN_KEY);
    expect(tokenKey("https://example.com/?plain=1")).toBe(TOKEN_KEY);
    expect(tokenKey("https://example.com/play/lunar-base/")).toBe(`${TOKEN_KEY}:/play/lunar-base/`);
  });
});
