import { achievementsOf, colonistsOf, type CardOf } from "./base.ts";
import { cardById } from "./catalogue.ts";
import { supplyEffects } from "./influences/supply.ts";
import type { AfterStep, Step } from "./loop.ts";
import type { GameResult, GameState, Seat } from "./state.ts";

export interface VictoryThresholds {
  readonly credits: number;
  readonly colonists: number;
  readonly achievements: number;
}

/** R11.1 / R12.7: derive the targets from the Supply at each check. */
export function thresholds(state: GameState): VictoryThresholds {
  let colonists = 10;
  let achievements = 5;
  for (const { effect } of supplyEffects(state)) {
    if ("rule" in effect && effect.rule === "draft_influence_extra_cost") {
      colonists = Math.max(colonists, effect.colonists_to_win ?? colonists);
      achievements = Math.max(achievements, effect.achievements_to_win ?? achievements);
    }
  }
  return { credits: 20, colonists, achievements };
}

/** R11.1: Influences the active player must hold in the end-of-turn check for condition 4. */
export const INFLUENCES_TO_WIN = 4;

/** R11.3: conditions 1–3 for every seat, and condition 4 for the revealing seat only. */
function score(state: GameState, revealer: Seat | null): Step {
  const limits = thresholds(state);
  const cardOf: CardOf = (instance) => cardById(state.cards[instance]);
  const scores = state.bases.map(
    (base, seat) =>
      Number(state.credits[seat] >= limits.credits) +
      Number(colonistsOf(base, cardOf) >= limits.colonists) +
      Number(achievementsOf(base, cardOf).size >= limits.achievements) +
      Number(seat === revealer),
  );
  const highest = Math.max(...scores);
  if (highest === 0) return { state };
  const winners = scores.flatMap((points, seat) => (points === highest ? [seat] : []));
  const result: GameResult = { reason: "victory", winners, scores };
  return {
    state: { ...state, result, stack: [], pending: null },
    events: [{ type: "game_ended", ...result }],
  };
}

/** R11.2 / R11.6: count conditions 1–3 for every seat at this moment; never condition 4. */
export function checkVictory(state: GameState): Step {
  return state.result === null ? score(state, null) : { state };
}

/**
 * R11.4: Shuttle Credits are already paid to everyone. The active player's 4
 * or more Influences are revealed in hand order and meet condition 4 in the
 * same count as everyone's conditions 1–3. The reveal moves no card.
 */
export function checkEndOfTurn(state: GameState): Step {
  if (state.result !== null) return { state };
  const seat = state.turn.seat;
  const cards = state.hands[seat]
    .filter((instance) => cardById(state.cards[instance]).type === "influence")
    .map((instance) => ({ instance, cardId: state.cards[instance] }));
  if (cards.length < INFLUENCES_TO_WIN) return score(state, null);
  const ended = score(state, seat);
  return {
    state: ended.state,
    events: [{ type: "influences_revealed", seat, cards }, ...(ended.events ?? [])],
  };
}

/** Use as Registry.afterStep: one check after the entire Shuttle payment, before the deal. */
export const victoryAfterStep: AfterStep = (state, frame) =>
  frame.kind === "shuttle_step" ? checkEndOfTurn(state) : checkVictory(state);
