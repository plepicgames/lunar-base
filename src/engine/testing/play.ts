// Test support: play a whole game, one offered option at a time. Engine
// tests use it; engine code does not.

import type { GameEvent } from "../events.ts";
import { gameRegistry, startGame } from "../game.ts";
import { applyChoice, type Registry } from "../loop.ts";
import { nextInt, seedToState } from "../rng.ts";
import type { Choice, GameConfig, GameState, PendingDecision } from "../state.ts";

/** Turns a test game may take: the server's limit for a game (Q40). */
export const TURN_CAP = 300;

/** Picks one option of a pending decision and returns its id. */
export type Picker = (pending: PendingDecision, state: GameState) => string;

/** A game as it was played. */
export interface Played {
  /** The state at each stop: after the opening, then after each choice. */
  readonly states: readonly GameState[];
  /** The events that led to each stop, by the index of `states`. */
  readonly events: readonly (readonly GameEvent[])[];
  /** The choices made, in order. With the config and the seed they are the whole game. */
  readonly choices: readonly Choice[];
  /** The last state. */
  readonly state: GameState;
  /** The largest `turn.work` any turn reached, steps between decisions included. */
  readonly largestWork: number;
}

/**
 * A picker that takes every option with the same chance. Its stream comes
 * from its own seed, so it never touches the game's stream.
 */
export function seededPicker(seed: string): Picker {
  let rng = seedToState(seed);
  return (pending) => {
    const picked = nextInt(rng, pending.options.length);
    rng = picked.state;
    return pending.options[picked.value].id;
  };
}

function playWith(
  config: GameConfig,
  seed: string,
  next: (state: GameState, made: number) => Choice | null,
): Played {
  let largestWork = 0;
  // The loop counts a step before this hook runs, so it sees every count.
  const watched: Registry = {
    handlers: gameRegistry.handlers,
    afterStep: (state, frame) => {
      largestWork = Math.max(largestWork, state.turn.work);
      return gameRegistry.afterStep(state, frame);
    },
  };
  const opened = startGame(config, seed, watched);
  let state = opened.state;
  const states = [state];
  const events = [opened.events];
  const choices: Choice[] = [];
  for (let choice = next(state, 0); choice !== null; choice = next(state, choices.length)) {
    const result = applyChoice(state, choice, watched);
    if (!result.ok) {
      throw new Error(`Choice ${String(choices.length + 1)} was rejected: ${result.error.message}`);
    }
    state = result.state;
    choices.push(choice);
    states.push(state);
    events.push(result.events);
  }
  return { states, events, choices, state, largestWork };
}

/**
 * Plays a new game with `pick` until it has a result or a turn after
 * `maxTurns` begins: it then stops at that turn's first decision.
 */
export function play(
  config: GameConfig,
  seed: string,
  pick: Picker,
  maxTurns: number = TURN_CAP,
): Played {
  return playWith(config, seed, (state) => {
    const pending = state.pending;
    if (pending === null || state.turn.number > maxTurns) return null;
    return { seat: pending.seat, decision: pending.id, option: pick(pending, state) };
  });
}

/** Plays the game that `(config, seed, choices)` describes. Throws on a rejected choice. */
export function replay(config: GameConfig, seed: string, choices: readonly Choice[]): Played {
  return playWith(config, seed, (_state, made) => choices.at(made) ?? null);
}
