import { achievementsOf, colonistsOf, orbsOf, visibleSide, type StationSide } from "./base.ts";
import { cardById } from "./catalogue.ts";
import type { EventCard } from "./events.ts";
import type { Placement } from "./geometry.ts";
import { supplyEffects } from "./influences/supply.ts";
import type { OrbCounts } from "./price.ts";
import type {
  GameConfig,
  GameResult,
  GameState,
  JsonValue,
  PendingDecision,
  Seat,
  Turn,
} from "./state.ts";
import { thresholds, type VictoryThresholds } from "./victory.ts";

/** The card identity uses the same instance/cardId pair as visible events. */
export type ViewCard = EventCard;

export interface ViewStation extends ViewCard {
  readonly side: StationSide;
  /** Catalogue id of the named side; null until this audience may know it. */
  readonly named: string | null;
  readonly revealed: boolean;
}

export interface ViewBase {
  readonly station: ViewStation;
  readonly modules: readonly (ViewCard & Placement)[];
  readonly orbs: OrbCounts;
}

export interface ViewPlayer {
  readonly seat: Seat;
  readonly credits: number;
  readonly colonists: number;
  readonly achievements: readonly string[];
  readonly handSize: number;
  readonly base: ViewBase;
}

export type ViewPending = PendingDecision | Pick<PendingDecision, "seat" | "kind">;

/** Complete per-seat snapshot; null is the public audience. */
export interface PlayerView {
  readonly you: Seat | null;
  readonly players: readonly ViewPlayer[];
  readonly hand: readonly ViewCard[];
  readonly supply: readonly ViewCard[];
  readonly deck: number;
  /** R12.11: only Transparency reveals the top card; null also covers an empty Deck. */
  readonly deckTop: ViewCard | null;
  readonly discardCount: number;
  /** R12.12: empty while Transparency closes the pile, regardless of its count. */
  readonly discard: readonly ViewCard[];
  readonly play: readonly ViewCard[];
  readonly turn: Omit<Turn, "work">;
  readonly targets: VictoryThresholds;
  readonly config: GameConfig;
  readonly influencesInGame: readonly string[];
  readonly result: GameResult | null;
  readonly pending: ViewPending | null;
}

function copyJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item: JsonValue) => copyJson(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJson(item)]));
  }
  return value;
}

/** R2.3/R2.4: select public fields explicitly, then add only this seat's private fields. */
export function viewFor(state: GameState, seat: Seat | null): PlayerView {
  const cardOf = (instance: string) => cardById(state.cards[instance]);
  const cardView = (instance: string): ViewCard => ({ instance, cardId: state.cards[instance] });
  const pending = state.pending;
  const transparency = supplyEffects(state).some(
    ({ effect }) => "rule" in effect && effect.rule === "deck_face_up_discard_face_down",
  );
  const top = state.deck.at(0);
  return {
    you: seat,
    players: state.bases.map((base, owner) => ({
      seat: owner,
      credits: state.credits[owner],
      colonists: colonistsOf(base, cardOf),
      achievements: [...achievementsOf(base, cardOf)],
      handSize: state.hands[owner].length,
      base: {
        station: {
          instance: base.station.card,
          cardId: visibleSide(base.station, cardOf).id,
          side: base.station.side,
          named: owner === seat || base.station.revealed ? state.cards[base.station.card] : null,
          revealed: base.station.revealed,
        },
        modules: base.modules.map(({ card, x, y, q }) => ({ ...cardView(card), x, y, q })),
        orbs: orbsOf(base, cardOf),
      },
    })),
    hand: seat === null ? [] : state.hands[seat].map(cardView),
    supply: state.supply.map(cardView),
    deck: state.deck.length,
    deckTop: transparency && top !== undefined ? cardView(top) : null,
    discardCount: state.discard.length,
    discard: transparency ? [] : state.discard.map(cardView),
    play: state.play.map(cardView),
    turn: {
      number: state.turn.number,
      seat: state.turn.seat,
      step: state.turn.step,
    },
    targets: thresholds(state),
    config: {
      seats: state.config.seats,
      influences: state.config.influences,
      kickstarter: state.config.kickstarter,
      ...(state.config.startingSeat === undefined
        ? {}
        : { startingSeat: state.config.startingSeat }),
    },
    influencesInGame: [...state.influencesInGame],
    result:
      state.result === null
        ? null
        : {
            reason: state.result.reason,
            winners: [...state.result.winners],
            scores: [...state.result.scores],
          },
    pending:
      pending === null
        ? null
        : pending.seat === seat
          ? {
              id: pending.id,
              seat: pending.seat,
              kind: pending.kind,
              options: pending.options.map((option) => ({
                ...Object.fromEntries(
                  Object.entries(option).map(([key, value]) => [key, copyJson(value)]),
                ),
                id: option.id,
                label: option.label,
              })),
            }
          : { seat: pending.seat, kind: pending.kind },
  };
}
