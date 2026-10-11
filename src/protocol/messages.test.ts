import { describe, expect, test, vi } from "vitest";
import { createGame, eventFor, viewFor, type Seat, type ViewEvent } from "../engine/index.ts";
import {
  clientMessageSchema,
  ERROR_CODES,
  parseClientMessage,
  PROTOCOL_VERSION,
  serverMessageSchema,
  validName,
  type ClientMessage,
  type ClientMessageInput,
  type GameView,
  type ServerMessage,
} from "./messages.ts";

const MAX_MESSAGE_BYTES = 16 * 1024;

type Json = Record<string, unknown>;

/** One valid example, the field to drop from it and a field with a wrong type. */
interface Case {
  readonly valid: Json;
  readonly missing: string;
  readonly wrong: Json;
}

const token = "0123456789abcdef0123456789abcdef";
const state = createGame({ seats: 2, influences: false, kickstarter: false }, "protocol-test");
const decider = state.pending?.seat ?? 0;

/** What the room sends: the engine's view plus the server's seat fields. */
function gameView(seat: Seat | null): GameView {
  const view = viewFor(state, seat);
  return {
    ...view,
    players: view.players.map((player) => ({
      ...player,
      name: player.seat === 0 ? "Ann" : "Bot 1",
      kind: player.seat === 0 ? "human" : "bot",
      connected: true,
    })),
  };
}

function started(seat: Seat | null): ViewEvent {
  const event = eventFor({ type: "turn_started", seat: 0, turn: 1 }, seat);
  if (event === null) throw new Error("turn_started has a public form");
  return event;
}

// The message of the Create form (T028): a client may leave botBrain out.
const create = {
  type: "lobby.create",
  seats: 3,
  bots: 1,
  influences: false,
  kickstarter: false,
} satisfies ClientMessageInput;
const openGame = {
  id: "g1",
  creator: "Ann",
  seats: 3,
  bots: 1,
  humans: ["Ann"],
  humansWanted: 2,
  options: { influences: false, kickstarter: false, botBrain: "builtin" },
};
const update: ServerMessage = {
  type: "game.update",
  game: "g1",
  seq: 4,
  view: gameView(decider),
  events: [started(decider)],
};

const clientCases: Record<ClientMessage["type"], Case> = {
  hello: {
    valid: { type: "hello", protocol: 1, token, name: "Ann" },
    missing: "protocol",
    wrong: { name: 7 },
  },
  "lobby.create": {
    valid: { ...create, botBrain: "builtin" },
    missing: "kickstarter",
    wrong: { influences: "no" },
  },
  "lobby.join": { valid: { type: "lobby.join", game: "g1" }, missing: "game", wrong: { game: 1 } },
  // game.leave has no field but its type.
  "game.leave": { valid: { type: "game.leave" }, missing: "type", wrong: { type: 7 } },
  "game.decide": {
    valid: { type: "game.decide", game: "g1", decision: "d3", option: "c12:0" },
    missing: "option",
    wrong: { decision: 3 },
  },
};

const serverCases: Record<ServerMessage["type"], Case> = {
  welcome: {
    valid: { type: "welcome", protocol: 1, token, name: "Ann", jev: false },
    missing: "jev",
    wrong: { jev: "off" },
  },
  "lobby.state": {
    valid: { type: "lobby.state", games: [openGame] },
    missing: "games",
    wrong: { games: [{ ...openGame, seats: "3" }] },
  },
  "game.update": { valid: update, missing: "view", wrong: { seq: "4" } },
  error: {
    valid: { type: "error", code: "game_full", message: "The game has no free seat." },
    missing: "message",
    wrong: { code: 404 },
  },
  // server.restart has no field but its type.
  "server.restart": { valid: { type: "server.restart" }, missing: "type", wrong: { type: 7 } },
};

function without(value: Json, key: string): Json {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

describe.each([
  ["client", clientMessageSchema, clientCases],
  ["server", serverMessageSchema, serverCases],
] as const)("%s messages", (_side, schema, cases) => {
  const rows = Object.entries(cases);

  test.each(rows)("%s parses its valid example unchanged", (_type, { valid }) => {
    expect(schema.parse(valid)).toEqual(valid);
  });

  test.each(rows)("%s is rejected with a missing field", (_type, { valid, missing }) => {
    expect(valid).toHaveProperty(missing);
    expect(schema.safeParse(without(valid, missing)).success).toBe(false);
  });

  test.each(rows)("%s is rejected with a field of the wrong type", (_type, { valid, wrong }) => {
    expect(schema.safeParse({ ...valid, ...wrong }).success).toBe(false);
  });

  test.each(rows)("%s is rejected with a field no table names", (_type, { valid }) => {
    expect(schema.safeParse({ ...valid, seed: "s" }).success).toBe(false);
  });
});

test("the protocol version is 1 and there are the ten error codes", () => {
  expect(PROTOCOL_VERSION).toBe(1);
  expect([...ERROR_CODES].sort()).toEqual(
    [
      "bad_message",
      "unsupported_protocol",
      "name_invalid",
      "name_taken",
      "not_in_lobby",
      "game_not_found",
      "game_full",
      "not_your_decision",
      "stale_decision",
      "bad_option",
    ].sort(),
  );
  for (const code of ERROR_CODES) {
    expect(serverMessageSchema.safeParse({ type: "error", code, message: "No." }).success).toBe(
      true,
    );
  }
});

describe("hello", () => {
  test("parses with neither token nor name: the server decides which it needs", () => {
    expect(clientMessageSchema.parse({ type: "hello", protocol: 1 })).toEqual({
      type: "hello",
      protocol: 1,
    });
  });

  test("is rejected with protocol 2", () => {
    expect(clientMessageSchema.safeParse({ type: "hello", protocol: 2, name: "Ann" }).success).toBe(
      false,
    );
  });

  test("is rejected with a token that is not 32 hex digits", () => {
    expect(
      clientMessageSchema.safeParse({ type: "hello", protocol: 1, token: "abc" }).success,
    ).toBe(false);
  });
});

describe("lobby.create", () => {
  test("parses the message of the Create form and gets botBrain builtin", () => {
    expect(
      clientMessageSchema.parse({
        type: "lobby.create",
        seats: 3,
        bots: 1,
        influences: false,
        kickstarter: false,
      }),
    ).toEqual({
      type: "lobby.create",
      seats: 3,
      bots: 1,
      influences: false,
      kickstarter: false,
      botBrain: "builtin",
    });
  });

  test("parses botBrain jev and rejects any other value", () => {
    expect(clientMessageSchema.parse({ ...create, botBrain: "jev" })).toEqual({
      ...create,
      botBrain: "jev",
    });
    for (const botBrain of ["random", "", null, 1]) {
      expect(clientMessageSchema.safeParse({ ...create, botBrain }).success).toBe(false);
    }
  });

  test.each([2, 6])("parses %d seats", (seats) => {
    expect(clientMessageSchema.safeParse({ ...create, seats }).success).toBe(true);
  });

  test.each([1, 7, 2.5])("is rejected with %d seats", (seats) => {
    expect(clientMessageSchema.safeParse({ ...create, seats, bots: 0 }).success).toBe(false);
  });

  test("parses a game of only non-human players (Q39)", () => {
    expect(clientMessageSchema.safeParse({ ...create, seats: 3, bots: 3 }).success).toBe(true);
  });

  test.each([4, -1, 0.5])("is rejected with 3 seats and %d bots", (bots) => {
    expect(clientMessageSchema.safeParse({ ...create, seats: 3, bots }).success).toBe(false);
  });
});

describe("game.update view", () => {
  test("rejects the internal engine step counter in a client turn", () => {
    const view = gameView(decider);
    expect(
      serverMessageSchema.safeParse({
        ...update,
        view: { ...view, turn: { ...view.turn, work: 12 } },
      }).success,
    ).toBe(false);
  });

  const withView = (view: unknown) => serverMessageSchema.safeParse({ ...update, view });

  test.each([0, 1, null])("parses the engine's view for seat %s unchanged", (seat) => {
    const view = gameView(seat);
    const parsed = serverMessageSchema.parse({ ...update, view, events: [started(seat)] });
    expect(parsed).toEqual({ ...update, view, events: [started(seat)] });
  });

  test("preserves a public Deck top and a closed Discard count on the wire", () => {
    const view = {
      ...gameView(0),
      deckTop: { instance: "c999", cardId: "mod-rover-1" },
      discard: [],
      discardCount: 3,
    };
    expect(serverMessageSchema.parse({ ...update, view })).toEqual({ ...update, view });
    expect(withView({ ...view, deckTop: { instance: "c999" } }).success).toBe(false);
    expect(withView({ ...view, discardCount: -1 }).success).toBe(false);
  });

  test("is rejected when a seat lacks its name, its kind or connected", () => {
    const view = gameView(0);
    for (const field of ["name", "kind", "connected"]) {
      const players = view.players.map((player) => without({ ...player }, field));
      expect(withView({ ...view, players }).success).toBe(false);
    }
  });

  test("is rejected when a seat is neither human nor bot", () => {
    const view = gameView(0);
    const players = view.players.map((player) => ({ ...player, kind: "robot" }));
    expect(withView({ ...view, players }).success).toBe(false);
  });

  test("is rejected with a field of the full state", () => {
    expect(withView({ ...gameView(0), rng: state.rng }).success).toBe(false);
    expect(withView({ ...gameView(0), cards: state.cards }).success).toBe(false);
  });

  test.each(["victory", "step_limit", "turn_limit", "engine_error"])(
    "parses a result with reason %s",
    (reason) => {
      const winners = reason === "victory" ? [1] : [];
      const result = { reason, winners, scores: [0, 2] };
      expect(withView({ ...gameView(0), result }).success).toBe(true);
    },
  );

  test("is rejected with a result reason the protocol does not name", () => {
    const result = { reason: "timeout", winners: [], scores: [0, 0] };
    expect(withView({ ...gameView(0), result }).success).toBe(false);
  });

  test.each(["step_limit", "turn_limit", "engine_error"])(
    "is rejected with winners for reason %s: only victory has winners",
    (reason) => {
      const result = { reason, winners: [0], scores: [1, 0] };
      expect(withView({ ...gameView(0), result }).success).toBe(false);
    },
  );

  test("is rejected with an event that has no text", () => {
    const events = [{ type: "turn_started", seat: 0, turn: 1 }];
    expect(serverMessageSchema.safeParse({ ...update, events }).success).toBe(false);
  });
});

describe("parseClientMessage", () => {
  const helloOfBytes = (bytes: number, letter = "a") => {
    const empty = JSON.stringify({ type: "hello", protocol: 1, name: "" });
    return JSON.stringify({
      type: "hello",
      protocol: 1,
      name: letter.repeat(bytes - empty.length),
    });
  };

  test("returns the parsed message with its defaults", () => {
    expect(parseClientMessage(JSON.stringify(create), MAX_MESSAGE_BYTES)).toEqual({
      ok: true,
      message: { ...create, botBrain: "builtin" },
    });
  });

  test.each([
    ["text that is not JSON", "{type:"],
    ["JSON that is not an object", "[1]"],
    ["null", "null"],
    ["an unknown type", JSON.stringify({ type: "game.cheat" })],
    ["a message a schema rejects", JSON.stringify({ ...create, seats: 7 })],
    ["a hello without a protocol", JSON.stringify({ type: "hello", name: "Ann" })],
  ])("refuses %s with bad_message", (_what, raw) => {
    const result = parseClientMessage(raw, MAX_MESSAGE_BYTES);
    expect(result).toMatchObject({ ok: false, error: { type: "error", code: "bad_message" } });
    if (!result.ok) expect(serverMessageSchema.safeParse(result.error).success).toBe(true);
  });

  test("refuses a hello with protocol 2 with unsupported_protocol", () => {
    const raw = JSON.stringify({ type: "hello", protocol: 2, name: "Ann", extra: true });
    expect(parseClientMessage(raw, MAX_MESSAGE_BYTES)).toMatchObject({
      ok: false,
      error: { type: "error", code: "unsupported_protocol" },
    });
  });

  test("refuses a 17 KiB message before JSON parsing", () => {
    const raw = helloOfBytes(17 * 1024);
    expect(clientMessageSchema.safeParse(JSON.parse(raw)).success).toBe(true);
    const parse = vi.spyOn(JSON, "parse");
    try {
      const result = parseClientMessage(raw, MAX_MESSAGE_BYTES);
      expect(parse).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false, error: { code: "bad_message" } });
    } finally {
      parse.mockRestore();
    }
  });

  test("accepts exactly 16 KiB and refuses one byte more", () => {
    expect(MAX_MESSAGE_BYTES).toBe(16 * 1024);
    expect(parseClientMessage(helloOfBytes(MAX_MESSAGE_BYTES), MAX_MESSAGE_BYTES).ok).toBe(true);
    expect(parseClientMessage(helloOfBytes(MAX_MESSAGE_BYTES + 1), MAX_MESSAGE_BYTES).ok).toBe(
      false,
    );
  });

  test("measures the limit in UTF-8 bytes, not in characters", () => {
    // 9,000 two-byte letters: under the limit as characters, over it as bytes.
    const raw = JSON.stringify({ type: "hello", protocol: 1, name: "é".repeat(9000) });
    expect(raw.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(raw, MAX_MESSAGE_BYTES).ok).toBe(false);
    // 4,000 four-byte emoji are 8,000 UTF-16 units and 16,000 bytes: accepted.
    const emoji = JSON.stringify({ type: "hello", protocol: 1, name: "🌙".repeat(4000) });
    expect(Buffer.byteLength(emoji)).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(emoji, MAX_MESSAGE_BYTES).ok).toBe(true);
  });
});

describe("validName", () => {
  test.each([
    ["one character", "A"],
    ["20 characters", "a".repeat(20)],
    ["20 characters inside spaces", `  ${"a".repeat(20)}  `],
    ["a space inside", "Ann Lee"],
    ["letters beyond ASCII", "Õie Šmidt"],
    ["20 characters beyond the basic plane", "🌙".repeat(20)],
  ])("accepts %s", (_what, name) => {
    expect(validName(name)).toBe(true);
  });

  test.each([
    ["an empty name", ""],
    ["only spaces", "   "],
    ["21 characters", "a".repeat(21)],
    ["a control character", "An\u0007n"],
    ["a line break at the end", "Ann\n"],
    ["a C1 control character", "An\u0085n"],
    ["a delete character", "An\u007fn"],
  ])("refuses %s", (_what, name) => {
    expect(validName(name)).toBe(false);
  });
});
