// The messages of the two Messages tables (architecture, Protocol). Server
// and client share these schemas and the types inferred from them.

import { z } from "zod";
import type { GameResult, PlayerView, ViewEvent, ViewPlayer } from "../engine/index.ts";

export const PROTOCOL_VERSION = 1;

export const ERROR_CODES = [
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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** `victory` and `step_limit` come from the engine, the other two from the room. */
export const RESULT_REASONS = ["victory", "step_limit", "turn_limit", "engine_error"] as const;
export type ResultReason = (typeof RESULT_REASONS)[number];

/** What the server knows about a seat and the engine does not. */
export interface SeatInfo {
  readonly name: string;
  readonly kind: "human" | "bot";
  readonly connected: boolean;
}

export type GameViewResult = Omit<GameResult, "reason"> & { readonly reason: ResultReason };

/** The engine's view of one seat, each player with its seat fields. */
export type GameView = Omit<PlayerView, "players" | "result"> & {
  readonly players: readonly (ViewPlayer & SeatInfo)[];
  readonly result: GameViewResult | null;
};

const id = z.string().min(1);
const count = z.int().min(0);
const seat = z.int().min(0).max(5);
const seats = z.int().min(2).max(6);
/** 16 random bytes as hex (architecture, Reconnect). */
const token = z.string().regex(/^[0-9a-f]{32}$/);
const botBrain = z.enum(["builtin", "jev"]);
export type BotBrain = z.infer<typeof botBrain>;

const hello = z.strictObject({
  type: z.literal("hello"),
  protocol: z.literal(PROTOCOL_VERSION),
  token: token.optional(),
  // The server answers a bad name with name_invalid, so any text parses.
  name: z.string().optional(),
});

const lobbyCreate = z
  .strictObject({
    type: z.literal("lobby.create"),
    seats,
    bots: count,
    influences: z.boolean(),
    kickstarter: z.boolean(),
    botBrain: botBrain.default("builtin"),
  })
  .refine((message) => message.bots <= message.seats, {
    path: ["bots"],
    message: "bots cannot exceed seats",
  });

const lobbyJoin = z.strictObject({ type: z.literal("lobby.join"), game: id });
const gameLeave = z.strictObject({ type: z.literal("game.leave") });
const gameDecide = z.strictObject({
  type: z.literal("game.decide"),
  game: id,
  decision: id,
  option: id,
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  hello,
  lobbyCreate,
  lobbyJoin,
  gameLeave,
  gameDecide,
]);
/** A message as the server handles it: defaults are filled in. */
export type ClientMessage = z.infer<typeof clientMessageSchema>;
/** A message as a client may send it: `botBrain` can be left out. */
export type ClientMessageInput = z.input<typeof clientMessageSchema>;

const card = z.strictObject({ instance: z.string(), cardId: z.string() });
const cards = z.array(card);

const player = z.strictObject({
  seat,
  credits: z.int(),
  colonists: z.int(),
  achievements: z.array(z.string()),
  handSize: count,
  base: z.strictObject({
    station: z.strictObject({
      ...card.shape,
      side: z.enum(["terran_outpost", "named"]),
      named: z.string().nullable(),
      revealed: z.boolean(),
    }),
    modules: z.array(
      z.strictObject({ ...card.shape, x: z.int(), y: z.int(), q: z.literal([0, 1, 2, 3]) }),
    ),
    orbs: z.strictObject({ red: count, blue: count, yellow: count, wild: count }),
  }),
  name: z.string(),
  kind: z.enum(["human", "bot"]),
  connected: z.boolean(),
});

const result = z
  .strictObject({
    reason: z.enum(RESULT_REASONS),
    winners: z.array(seat),
    scores: z.array(z.int()),
  })
  .refine((value) => value.reason === "victory" || value.winners.length === 0, {
    path: ["winners"],
    message: "only victory has winners",
  });

// Option data keeps the engine's decision format: any JSON beside id and label.
const option = z.object({ id: z.string(), label: z.string() }).catchall(z.json());
const pending = z.union([
  z.strictObject({ id: z.string(), seat, kind: z.string(), options: z.array(option) }),
  z.strictObject({ seat, kind: z.string() }),
]);

// Strict at every level: a field of the full state does not parse as a view.
// The annotation fails the Types step when the engine's PlayerView gains a
// field this schema does not have.
const view: z.ZodType<GameView> = z.strictObject({
  you: seat.nullable(),
  players: z.array(player),
  hand: cards,
  supply: cards,
  deck: count,
  deckTop: card.nullable(),
  discardCount: count,
  discard: cards,
  play: cards,
  turn: z.strictObject({
    number: z.int(),
    seat,
    step: z.enum(["agent", "main_action", "shuttle"]),
  }),
  targets: z.strictObject({ credits: z.int(), colonists: z.int(), achievements: z.int() }),
  config: z.strictObject({
    seats,
    influences: z.boolean(),
    kickstarter: z.boolean(),
    startingSeat: seat.optional(),
  }),
  influencesInGame: z.array(z.string()),
  result: result.nullable(),
  pending: pending.nullable(),
});

// An event is checked for its type and its sentence only. Its other fields
// are the engine's: `eventFor` is their one source and its table their
// contract, and later milestones add event types.
const eventShape = z.object({ type: z.string(), text: z.string() }).catchall(z.json());
const event = z.custom<ViewEvent>((value) => eventShape.safeParse(value).success);

const welcome = z.strictObject({
  type: z.literal("welcome"),
  protocol: z.literal(PROTOCOL_VERSION),
  token,
  name: z.string(),
  jev: z.boolean(),
});

const lobbyGame = z.strictObject({
  id,
  /** Name of the session that created the game. */
  creator: z.string(),
  seats,
  bots: count,
  /** Names of the humans who joined, in seat order. */
  humans: z.array(z.string()),
  humansWanted: count,
  options: z.strictObject({ influences: z.boolean(), kickstarter: z.boolean(), botBrain }),
});
export type LobbyGame = z.infer<typeof lobbyGame>;

const lobbyState = z.strictObject({
  type: z.literal("lobby.state"),
  games: z.array(lobbyGame).readonly(),
});

const gameUpdate = z.strictObject({
  type: z.literal("game.update"),
  game: id,
  seq: count,
  view,
  events: z.array(event).readonly(),
});

const error = z.strictObject({
  type: z.literal("error"),
  code: z.enum(ERROR_CODES),
  message: z.string(),
});
export type ErrorMessage = z.infer<typeof error>;

/**
 * The last message of a socket: the server is stopping and its games end with
 * it. The socket then closes with `RESTART_CLOSE_CODE`.
 */
const serverRestart = z.strictObject({ type: z.literal("server.restart") });

/** WebSocket close code 1012, "service restart". */
export const RESTART_CLOSE_CODE = 1012;

export const serverMessageSchema = z.discriminatedUnion("type", [
  welcome,
  lobbyState,
  gameUpdate,
  error,
  serverRestart,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export type ParsedClientMessage =
  | { readonly ok: true; readonly message: ClientMessage }
  /** The `error` message to send back; nothing changed. */
  | { readonly ok: false; readonly error: ErrorMessage };

function refused(code: ErrorCode, message: string): ParsedClientMessage {
  return { ok: false, error: { type: "error", code, message } };
}

/** Size as UTF-8, the encoding of a WebSocket text frame. */
function tooLarge(text: string, maxMessageBytes: number): boolean {
  // Every UTF-16 unit is at least one byte.
  if (text.length > maxMessageBytes) return true;
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes > maxMessageBytes;
}

function helloProtocol(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("type" in value) || value.type !== "hello") return null;
  return "protocol" in value && typeof value.protocol === "number" ? value.protocol : null;
}

/**
 * Checks one incoming text frame: its size first, then JSON, then the
 * schema of its type. A `hello` of another protocol version is refused with
 * `unsupported_protocol` whatever else it holds; every other refusal is
 * `bad_message`.
 */
export function parseClientMessage(raw: string, maxMessageBytes: number): ParsedClientMessage {
  if (tooLarge(raw, maxMessageBytes))
    return refused("bad_message", "The message is larger than 16 KiB.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return refused("bad_message", "The message is not JSON.");
  }
  const protocol = helloProtocol(value);
  if (protocol !== null && protocol !== PROTOCOL_VERSION) {
    return refused(
      "unsupported_protocol",
      `This server speaks protocol ${String(PROTOCOL_VERSION)}.`,
    );
  }
  const parsed = clientMessageSchema.safeParse(value);
  if (parsed.success) return { ok: true, message: parsed.data };
  const [issue] = parsed.error.issues;
  const where = issue.path.length === 0 ? "" : ` at ${issue.path.join(".")}`;
  return refused("bad_message", `The message is not valid: ${issue.message}${where}.`);
}

const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * The lobby's name rule: 1 to 20 characters after trimming and no control
 * character anywhere, so a tab or a line break at an end is refused too.
 */
export function validName(name: string): boolean {
  // Code points: the same count on the server and in every browser.
  const length = Array.from(name.trim()).length;
  return length >= 1 && length <= 20 && !CONTROL_CHARACTER.test(name);
}
