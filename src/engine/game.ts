// The game the interface publishes (architecture, Interface): the loop bound
// to the frames of a turn, the action handlers and the victory check.

import { actionHandlers } from "./actions/index.ts";
import { immediate } from "./influences/immediate.ts";
import {
  applyChoice as applyWith,
  run,
  type ChoiceResult,
  type Registry,
  type Resolved,
} from "./loop.ts";
import { dealGame } from "./setup.ts";
import type { Choice, GameConfig, GameState } from "./state.ts";
import { pushTurn, turnHandlers } from "./turn.ts";
import { victoryAfterStep } from "./victory.ts";

/** Every frame kind of the game and the check that follows each step. */
export const gameRegistry: Registry = {
  handlers: { ...turnHandlers(actionHandlers), immediate },
  afterStep: victoryAfterStep,
};

/**
 * Deals the game (rules 3), starts the first turn and runs to the first
 * decision. The events are the opening of the game: `game_started`, then
 * what the run emitted. Throws for a config the setup rejects.
 */
export function startGame(
  config: GameConfig,
  seed: string,
  registry: Registry = gameRegistry,
): Resolved {
  const dealt = dealGame(config, seed);
  const { seats } = dealt.config;
  const opened = run(pushTurn(dealt), registry);
  return {
    state: opened.state,
    events: [{ type: "game_started", seats, startingSeat: dealt.turn.seat }, ...opened.events],
  };
}

/** The state of a new game at its first decision. */
export function createGame(config: GameConfig, seed: string): GameState {
  return startGame(config, seed).state;
}

/** Applies a choice to the pending decision and runs on, or says why it is rejected. */
export function applyChoice(state: GameState, choice: Choice): ChoiceResult {
  return applyWith(state, choice, gameRegistry);
}
