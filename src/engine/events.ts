import { cardById } from "./catalogue.ts";
import type { Placement } from "./geometry.ts";
import type { CardInstanceId, GameResult, Seat } from "./state.ts";

/** An instance is exposed only alongside the identity visible when emitted. */
export interface EventCard {
  readonly instance: CardInstanceId;
  readonly cardId: string;
}

type CardAudience = "all" | "seat";
/** Omitted for the base-game audience; overrides are frozen at emission. */
type AudienceCard = SeatCard & { readonly cardAudience?: CardAudience };

type SeatCard = { readonly seat: Seat; readonly card: EventCard };

interface EventFields {
  game_started: { seats: number; startingSeat: Seat };
  turn_started: { seat: Seat; turn: number };
  box_chosen: SeatCard & { box: number };
  card_drafted: SeatCard;
  card_drawn: AudienceCard;
  card_discarded: AudienceCard;
  card_resold: SeatCard & { credits: number };
  module_built: SeatCard & Placement & { cost: number };
  credits_changed: { seat: Seat; delta: number; credits: number };
  credits_lost: {
    losses: readonly { readonly seat: Seat; readonly delta: number; readonly credits: number }[];
  };
  hand_seen: { looker: Seat; opponent: Seat; cards: readonly EventCard[] };
  action_blocked: SeatCard & { action: "steal_credits" | "steal_module" };
  credits_stolen: { thief: Seat; victim: Seat; amount: number };
  module_stolen: { thief: Seat; victim: Seat; card: EventCard };
  stations_exchanged: { seats: readonly [Seat, Seat] };
  station_flipped: { flips: readonly SeatCard[] };
  deck_reshuffled: { count: number };
  shuttles_arrived: {
    seat: Seat;
    turn: number;
    gains: readonly { readonly seat: Seat; readonly delta: number; readonly credits: number }[];
  };
  supply_dealt: { cards: readonly EventCard[] };
  text_deferred: SeatCard;
  agent_played: SeatCard & { cost: number };
  agent_discarded: SeatCard;
  influences_revealed: { seat: Seat; cards: readonly EventCard[] };
  game_ended: GameResult;
}

type EventType = keyof EventFields;
type EventOf<K extends EventType> = Readonly<{ type: K } & EventFields[K]>;
export type GameEvent = { [K in EventType]: EventOf<K> }[EventType];

type AudienceTable = {
  readonly [K in EventType]: {
    /** Only Draw and Discard can change their card's audience at emission. */
    readonly defaultCardAudience?: K extends "card_drawn" | "card_discarded" ? CardAudience : never;
    /** null hides the whole event from everyone except its private seat. */
    readonly public: readonly (keyof EventFields[K])[] | null;
    /** Name of the field containing the seat that receives extra fields. */
    readonly privateSeat:
      | {
          [F in keyof EventFields[K]]: EventFields[K][F] extends Seat ? F : never;
        }[keyof EventFields[K]]
      | null;
    readonly private: readonly (keyof EventFields[K])[];
  };
};

/** The only field allow-list. Adding a GameEvent requires a row here. */
export const EVENT_AUDIENCE = {
  game_started: { public: ["seats", "startingSeat"], privateSeat: null, private: [] },
  turn_started: { public: ["seat", "turn"], privateSeat: null, private: [] },
  box_chosen: { public: ["seat", "card", "box"], privateSeat: null, private: [] },
  card_drafted: { public: ["seat", "card"], privateSeat: null, private: [] },
  card_drawn: {
    public: ["seat"],
    privateSeat: "seat",
    private: ["card"],
    defaultCardAudience: "seat",
  },
  card_discarded: {
    public: ["seat"],
    privateSeat: "seat",
    private: ["card"],
    defaultCardAudience: "all",
  },
  card_resold: { public: ["seat", "card", "credits"], privateSeat: null, private: [] },
  module_built: { public: ["seat", "card", "x", "y", "q", "cost"], privateSeat: null, private: [] },
  credits_changed: { public: ["seat", "delta", "credits"], privateSeat: null, private: [] },
  credits_lost: { public: ["losses"], privateSeat: null, private: [] },
  hand_seen: { public: ["looker", "opponent"], privateSeat: "looker", private: ["cards"] },
  action_blocked: { public: ["seat", "action", "card"], privateSeat: null, private: [] },
  credits_stolen: { public: ["thief", "victim", "amount"], privateSeat: null, private: [] },
  module_stolen: { public: ["thief", "victim", "card"], privateSeat: null, private: [] },
  stations_exchanged: { public: ["seats"], privateSeat: null, private: [] },
  station_flipped: { public: ["flips"], privateSeat: null, private: [] },
  deck_reshuffled: { public: ["count"], privateSeat: null, private: [] },
  shuttles_arrived: { public: ["seat", "turn", "gains"], privateSeat: null, private: [] },
  supply_dealt: { public: ["cards"], privateSeat: null, private: [] },
  text_deferred: { public: ["seat", "card"], privateSeat: null, private: [] },
  agent_played: { public: ["seat", "card", "cost"], privateSeat: null, private: [] },
  agent_discarded: { public: ["seat", "card"], privateSeat: null, private: [] },
  influences_revealed: { public: ["seat", "cards"], privateSeat: null, private: [] },
  game_ended: { public: ["reason", "winners", "scores"], privateSeat: null, private: [] },
} as const satisfies AudienceTable;

type Row<K extends EventType> = (typeof EVENT_AUDIENCE)[K];
type Fields<
  K extends EventType,
  A extends "public" | "private",
> = Row<K>[A] extends readonly (infer F)[] ? Extract<F, keyof EventOf<K>> : never;
type PublicEvent<K extends EventType> = Row<K>["public"] extends null
  ? never
  : | Pick<EventOf<K>, "type" | Fields<K, "public">>
    | (Row<K> extends { defaultCardAudience: CardAudience }
        ? Pick<EventOf<K>, "type" | Fields<K, "public"> | Fields<K, "private">>
        : never);
type PrivateEvent<K extends EventType> = Row<K>["privateSeat"] extends null
  ? never
  : Pick<EventOf<K>, "type" | Fields<K, "public"> | Fields<K, "private">>;
type EventData = { [K in EventType]: PublicEvent<K> | PrivateEvent<K> }[EventType];
export type ViewEvent = EventData & { readonly text: string };

function player(seat: Seat): string {
  return `Player ${String(seat + 1)}`;
}

function cardName(card: EventCard): string {
  return cardById(card.cardId).name;
}

/** Receives only projected fields, never the authoritative event. */
function eventText(event: EventData): string {
  switch (event.type) {
    case "game_started":
      return `The game started with ${String(event.seats)} players, with ${player(event.startingSeat)} going first.`;
    case "turn_started":
      return `${player(event.seat)} started turn ${String(event.turn)}.`;
    case "box_chosen":
      return `${player(event.seat)} chose box ${String(event.box + 1)} on ${cardName(event.card)}.`;
    case "card_drafted":
      return `${player(event.seat)} drafted ${cardName(event.card)}.`;
    case "card_drawn":
      return "card" in event
        ? `${player(event.seat)} drew ${cardName(event.card)}.`
        : `${player(event.seat)} drew a card.`;
    case "card_discarded":
      return "card" in event
        ? `${player(event.seat)} discarded ${cardName(event.card)}.`
        : `${player(event.seat)} discarded a card.`;
    case "card_resold":
      return `${player(event.seat)} resold ${cardName(event.card)} for ${String(event.credits)} Credits.`;
    case "module_built":
      return `${player(event.seat)} built ${cardName(event.card)} for ${String(event.cost)} Credits.`;
    case "credits_changed":
      return `${player(event.seat)} ${event.delta < 0 ? "lost" : "gained"} ${String(Math.abs(event.delta))} Credits and now has ${String(event.credits)}.`;
    case "credits_lost":
      return event.losses
        .map(
          ({ seat, delta, credits }) =>
            `${player(seat)} lost ${String(Math.abs(delta))} Credits and now has ${String(credits)}.`,
        )
        .join(" ");
    case "hand_seen":
      return "cards" in event
        ? `${player(event.looker)} looked at ${player(event.opponent)}'s hand: ${event.cards.length === 0 ? "empty" : event.cards.map(cardName).join(", ")}.`
        : `${player(event.looker)} looked at ${player(event.opponent)}'s hand.`;
    case "action_blocked":
      return `${player(event.seat)}'s ${event.action === "steal_module" ? "Steal Module" : "Steal Credits"} action did nothing because ${cardName(event.card)} is in the Supply.`;
    case "credits_stolen":
      return `${player(event.thief)} stole ${String(event.amount)} Credits from ${player(event.victim)}.`;
    case "module_stolen":
      return `${player(event.thief)} stole ${cardName(event.card)} from ${player(event.victim)}.`;
    case "stations_exchanged":
      return `${player(event.seats[0])} and ${player(event.seats[1])} exchanged Stations.`;
    case "station_flipped":
      return event.flips
        .map(({ seat, card }) => `${player(seat)}'s Station flipped to ${cardName(card)}.`)
        .join(" ");
    case "deck_reshuffled":
      return `The Deck was reshuffled with ${String(event.count)} cards.`;
    case "shuttles_arrived":
      return `Shuttles arrived during ${player(event.seat)}'s turn ${String(event.turn)}.`;
    case "supply_dealt":
      return `${String(event.cards.length)} cards were dealt to the Supply.`;
    case "text_deferred":
      return `${player(event.seat)} deferred the text of ${cardName(event.card)}.`;
    case "agent_played":
      return `${player(event.seat)} played ${cardName(event.card)} for ${String(event.cost)} Credits.`;
    case "agent_discarded":
      return `${player(event.seat)}'s ${cardName(event.card)} went to the Discard pile.`;
    case "influences_revealed":
      return `${player(event.seat)} revealed ${String(event.cards.length)} Influences: ${event.cards.map(cardName).join(", ")}.`;
    case "game_ended":
      return event.reason === "step_limit"
        ? "The game ended at the turn step limit with no winner."
        : `The game ended with ${event.winners.map(player).join(" and ")} winning.`;
  }
}

/** Events are JSON; copy their projected data so histories own their snapshots. */
function copyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
  }
  return value;
}

/** Public audience is null; the private seat also receives the public fields. */
export function eventFor(event: GameEvent, seat: Seat | null): ViewEvent | null {
  const row: {
    defaultCardAudience?: CardAudience;
    public: readonly string[] | null;
    privateSeat: string | null;
    private: readonly string[];
  } = EVENT_AUDIENCE[event.type];
  const source = event as unknown as Readonly<Record<string, unknown>>;
  const owns = seat !== null && row.privateSeat !== null && source[row.privateSeat] === seat;
  if (row.public === null && !owns) return null;
  const sharesCard =
    row.defaultCardAudience !== undefined &&
    (source["cardAudience"] ?? row.defaultCardAudience) === "all";
  const fields = [...(row.public ?? []), ...(owns || sharesCard ? row.private : [])];
  // The exhaustive table connects these runtime keys to the derived union.
  const projected = Object.fromEntries([
    ["type", event.type],
    ...fields.map((field) => [field, copyValue(source[field])]),
  ]) as EventData;
  return { ...projected, text: eventText(projected) };
}
