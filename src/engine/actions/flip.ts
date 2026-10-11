// Flip (R7.8): the Stations an action names turn to their other side. A Flip
// is mandatory; D9 chooses a target and D10 chooses a set of Stations.

import { visibleSide, type BaseStation, type CardOf } from "../base.ts";
import { cardById } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { pop, push, type Step } from "../loop.ts";
import type { DecisionOption, GameState, Seat } from "../state.ts";
import type { ActionHandler } from "./index.ts";

/** The first Flip makes the named side public for the rest of the game (R2.4). */
function turned(station: BaseStation): BaseStation {
  return {
    card: station.card,
    side: station.side === "named" ? "terran_outpost" : "named",
    revealed: true,
  };
}

/**
 * R7.8 / R8.5: turns the Stations of `seats` at once, as one step with one
 * event that lists them in seat order. A Station keeps its place and its
 * joints: only `side` changes, and what the Base counts is derived from the
 * visible side (R5.7, R5.14, R5.15, R9.2). No seat leaves the state as it is.
 */
export function flipStations(state: GameState, seats: readonly Seat[]): Step {
  const flipping = new Set(seats);
  if (flipping.size === 0) return { state };
  const cardOf: CardOf = (instance) => cardById(state.cards[instance]);
  const bases = state.bases.map((base, seat) =>
    flipping.has(seat) ? { ...base, station: turned(base.station) } : base,
  );
  const flips = bases.flatMap(({ station }, seat) => {
    if (!flipping.has(seat)) return [];
    const side = visibleSide(station, cardOf);
    return [{ seat, card: { instance: station.card, cardId: side.id } }];
  });
  let next: GameState = { ...state, bases };
  // R12.4: interrupt the remaining text with the Station holder's on-flip
  // text. Its source makes it a Station effect even inside an Agent's text.
  for (const { seat, card } of flips.toReversed()) {
    const actions = cardById(card.cardId).on_flip_to;
    if (!actions?.length) continue;
    next = push(next, "box", {
      seat,
      source: card.instance,
      actions,
      position: 0,
      repeated: 0,
      deferred: [],
    });
  }
  return { state: next, events: [{ type: "station_flipped", flips }] };
}

/** `own`: the Station of the seat that performs the action. */
export const flipOwn: ActionHandler = (state, { seat }) => flipStations(pop(state), [seat]);

/** `each_player`: every Station, the acting player's included (R2.2). */
export const flipEachPlayer: ActionHandler = (state) =>
  flipStations(
    pop(state),
    state.bases.map((_, seat) => seat),
  );

/** Terran Crackdown: already-visible Outposts stay as they are (R10.7). */
export const flipAllToTerranOutpost: ActionHandler = (state) =>
  flipStations(
    pop(state),
    state.bases.flatMap(({ station }, seat) => (station.side === "named" ? [seat] : [])),
  );

interface FlipOption extends DecisionOption {
  readonly seats: readonly Seat[];
}

/** Seat labels are public even while a Station's named side is secret (R2.4). */
function stationLabel(seat: Seat): string {
  return `Player ${String(seat + 1)}'s Station`;
}

/** D10: bitmask order gives each subset a stable id, including the empty set. */
export const flipChoice: ActionHandler = (state, { action, seat }, answer) => {
  if (answer !== null) return flipStations(pop(state), answer.option.seats as readonly Seat[]);
  if (action.op !== "flip") throw new Error("Expected flip");
  const seats = state.bases.map((_, index) => index);
  const options: FlipOption[] = [];
  for (let mask = 0; mask < 2 ** seats.length; mask++) {
    const chosen = seats.filter((index) => (mask & (1 << index)) !== 0);
    if (action.who === "any_one" && chosen.length !== 1) continue;
    if (action.who === "any_two" && chosen.length !== 2) continue;
    options.push({
      id: String(mask),
      label:
        chosen.length === 0 ? "Flip no Stations" : `Flip ${chosen.map(stationLabel).join(", ")}`,
      seats: chosen,
    });
  }
  return { state: ask(state, { seat, kind: "flip", options }) };
};

/** D9 / R2.1: choose any target; the two-player neighbour is turned only once. */
export const flipNeighboursOfTarget: ActionHandler = (state, { seat }, answer) => {
  if (answer !== null) return flipStations(pop(state), answer.option.seats as readonly Seat[]);
  const count = state.bases.length;
  const options: FlipOption[] = state.bases.map((_, target) => {
    const seats = [...new Set([(target + count - 1) % count, (target + 1) % count])].sort(
      (a, b) => a - b,
    );
    return {
      id: String(target),
      target,
      seats,
      label: `Target Player ${String(target + 1)}: Flip ${seats.map(stationLabel).join(", ")}`,
    };
  });
  return { state: ask(state, { seat, kind: "target", options }) };
};
