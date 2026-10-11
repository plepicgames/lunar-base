// R7.16: a player other than the one who chooses Discards. The discarding
// player chooses each card (D5, Q13), one card at a time (R7.2).

import { ask } from "../decisions.ts";
import { pop, push, update } from "../loop.ts";
import type { GameState, Seat } from "../state.ts";
import type { ActionFrame, ActionHandler } from "./index.ts";

/** A text in which `seat` Discards `n` times; an empty hand skips what is left (R7.5). */
function pushDiscards(state: GameState, seat: Seat, n: number): GameState {
  return push(state, "box", {
    seat,
    defenceCovered: true,
    actions: [{ op: "discard", n }],
    position: 0,
    repeated: 0,
    deferred: [],
  });
}

/** D9 / R2.2: choose once among all players, the acting player included (Q14). */
export const targetDiscards: ActionHandler = (state, { action, seat }, answer) => {
  if (action.op !== "target_discards") throw new Error("Expected target_discards");
  if (answer === null) {
    return {
      state: ask(state, {
        seat,
        kind: "target",
        // Choose even when the target's hand is empty: no option is hidden by a hand's size.
        options: state.hands.map((_, target) => ({
          id: String(target),
          label: `Player ${String(target + 1)} Discards`,
          target,
        })),
      }),
    };
  }
  return { state: pushDiscards(pop(state), answer.option.target as Seat, action.n) };
};

/** The `action` frame of Each opponent Discards. `served` opponents have had their turn. */
type EachOpponentFrame = ActionFrame & { readonly served?: number };

/**
 * R8.6: the opponents of the acting seat Discard in turn, clockwise from the
 * active player. The frame stays while one of them Discards and then pushes
 * the next, so each hand is read only when its player's Discards begin.
 */
export const eachOpponentDiscards: ActionHandler = (state, frame) => {
  const { action, seat } = frame;
  if (action.op !== "each_opponent_discards") throw new Error("Expected each_opponent_discards");
  const seats = state.hands.length;
  const served = (frame as EachOpponentFrame).served ?? 0;
  const opponents = Array.from(
    { length: seats },
    (_, offset): Seat => (state.turn.seat + 1 + offset) % seats,
  ).filter(
    (opponent) =>
      opponent !== seat && !((frame.defenceExcluded ?? []) as readonly Seat[]).includes(opponent),
  );
  const next = opponents.at(served);
  if (next === undefined) return { state: pop(state) };
  return { state: pushDiscards(update(state, { ...frame, served: served + 1 }), next, action.n) };
};
