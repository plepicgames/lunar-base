import { ask } from "../decisions.ts";
import { pop, type Step } from "../loop.ts";
import type { GameState, Seat } from "../state.ts";
import type { ActionHandler } from "./index.ts";

/** R12.3: move each card with its visible side and reveal history intact. */
export function exchangeStations(state: GameState, first: Seat, second: Seat): Step {
  if (first === second) return { state };
  const bases = state.bases.map((base, seat) => {
    if (seat === first) return { ...base, station: state.bases[second].station };
    if (seat === second) return { ...base, station: state.bases[first].station };
    return base;
  });
  // Stations share half-orbs and the origin placement; Modules and joints
  // stay. All Base counts are derived from the new visible sides.
  return {
    state: { ...state, bases },
    events: [{ type: "stations_exchanged", seats: [first, second] }],
  };
}

/** D14: Kafka's holder chooses any other Station; a sole option auto-resolves. */
export const exchangeStation: ActionHandler = (state, { seat }, answer) => {
  if (answer !== null) return exchangeStations(pop(state), seat, answer.option.target as Seat);
  return {
    state: ask(state, {
      seat,
      kind: "exchange_station",
      options: state.bases.flatMap((_, target) =>
        target === seat
          ? []
          : [
              {
                id: String(target),
                target,
                label: `Exchange with Player ${String(target + 1)}'s Station`,
              },
            ],
      ),
    }),
  };
};

/** R12.4: the drafter's two neighbours exchange; with two seats they are one player. */
export const neighboursExchangeStations: ActionHandler = (state, { seat }) => {
  const seats = state.bases.length;
  return exchangeStations(pop(state), (seat + seats - 1) % seats, (seat + 1) % seats);
};
