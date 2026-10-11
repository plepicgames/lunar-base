// The action registry: one handler per action key (T004). A text frame
// resolves each action through an `action` frame, which this module steps.

import { actionKey, type ActionDef, type ActionKey } from "../catalogue.ts";
import { ask, type Answer } from "../decisions.ts";
import { withDefence } from "../influences/defence.ts";
import { isTextFrame, pop, push, type FrameHandler, type Step } from "../loop.ts";
import type { Frame, GameState, Seat } from "../state.ts";
import { build } from "./build.ts";
import { actionsLabel } from "./label.ts";
import { draft } from "./draft.ts";
import { draw } from "./draw.ts";
import { discard, discardHand } from "./discard.ts";
import {
  flipAllToTerranOutpost,
  flipChoice,
  flipEachPlayer,
  flipNeighboursOfTarget,
  flipOwn,
} from "./flip.ts";
import { exchangeStation, neighboursExchangeStations } from "./exchange.ts";
import { opponentResells } from "./opponent-resells.ts";
import { eachOpponentDiscards, targetDiscards } from "./other-discards.ts";
import {
  lookAtOpponentHand,
  thatOpponentDiscards,
  thatOpponentDiscardsAllAgents,
} from "./look-hand.ts";
import { resell, resellPerSupplyInfluence } from "./resell.ts";
import { stealCredits } from "./steal-credits.ts";
import { stealModule } from "./steal-module.ts";

/** One action that `seat` performs. A repeated action has one frame per repetition. */
export interface ActionFrame extends Frame {
  readonly action: ActionDef;
  readonly seat: Seat;
}

/**
 * Performs one step of an action frame, as a `FrameHandler` does. The frame
 * is on top of the stack; the handler pops it when the action is done.
 */
export type ActionHandler = (state: GameState, frame: ActionFrame, answer: Answer | null) => Step;

export type ActionHandlers = Readonly<Partial<Record<ActionKey, ActionHandler>>>;

/** R8.2 / D3: every printed option is legal, even when its actions do nothing. */
const chooseOne: ActionHandler = (state, frame, answer) => {
  const { action, seat } = frame;
  if (action.op !== "choose_one") throw new Error("Expected choose_one");
  if (answer === null) {
    // The card whose text holds the choice, so a client can show it. Absent
    // when no card holds the text.
    const index = state.stack.findIndex(({ id }) => id === frame.id);
    const names = state.stack
      .slice(0, index)
      .filter(isTextFrame)
      .map((below) => below.card ?? below.source);
    const named = names.findLast((name) => typeof name === "string");
    const card: Record<string, string> = typeof named === "string" ? { card: named } : {};
    return {
      state: ask(state, {
        seat,
        kind: "choose_one",
        options: action.options.map((actions, position) => ({
          id: String(position),
          label: actionsLabel(actions),
          ...card,
        })),
      }),
    };
  }
  return {
    state: push(pop(state), "box", {
      seat,
      actions: action.options[Number(answer.option.id)],
      position: 0,
      repeated: 0,
      deferred: [],
    }),
  };
};

/** R7.11: count the hand now, after all preceding actions. */
const gainCreditPerHandCard: ActionHandler = (state, { seat }) => {
  const delta = state.hands[seat].length;
  if (delta === 0) return { state: pop(state) };
  const credits = state.credits[seat] + delta;
  return {
    state: pop({
      ...state,
      credits: state.credits.map((old, index) => (index === seat ? credits : old)),
    }),
    events: [{ type: "credits_changed", seat, delta, credits }],
  };
};

/** R7.12 / R8.5: all balances change together, with one event for the action. */
const eachPlayerLosesCredits: ActionHandler = (state, { action }) => {
  if (action.op !== "each_player_loses_credits")
    throw new Error("Expected each_player_loses_credits");
  const losses = state.credits.map((old, seat) => {
    const credits = Math.max(0, old - action.n);
    return { seat, delta: credits - old, credits };
  });
  return {
    state: pop({ ...state, credits: losses.map(({ credits }) => credits) }),
    events: [{ type: "credits_lost", losses }],
  };
};

/** R9.6 is derived from the Bases at Shuttle arrival, never installed as state. */
const shuttleRedOrbsPay: ActionHandler = (state) => ({ state: pop(state) });

/** The game's handlers. Each action task adds its keys here. */
export const actionHandlers: ActionHandlers = {
  draft,
  draw,
  discard,
  discard_hand: discardHand,
  build,
  resell,
  resell_per_supply_influence: resellPerSupplyInfluence,
  shuttle_red_orbs_pay: shuttleRedOrbsPay,
  exchange_station: exchangeStation,
  neighbours_exchange_stations: neighboursExchangeStations,
  that_opponent_discards_all_agents: thatOpponentDiscardsAllAgents,
  opponent_resells: opponentResells,
  target_discards: targetDiscards,
  each_opponent_discards: eachOpponentDiscards,
  steal_credits: stealCredits,
  steal_module: stealModule,
  look_at_opponent_hand: lookAtOpponentHand,
  that_opponent_discards: thatOpponentDiscards,
  choose_one: chooseOne,
  gain_credit_per_hand_card: gainCreditPerHandCard,
  each_player_loses_credits: eachPlayerLosesCredits,
  "flip:own": flipOwn,
  "flip:each_player": flipEachPlayer,
  "flip:all_to_terran_outpost": flipAllToTerranOutpost,
  "flip:any_one": flipChoice,
  "flip:any_two": flipChoice,
  "flip:any_number": flipChoice,
  "flip:neighbours_of_target": flipNeighboursOfTarget,
};

export const ACTION_FRAME = "action";

/** Ops whose `n` is a number of repetitions that the text counts (R7.2). */
const REPEATED: ReadonlySet<ActionDef["op"]> = new Set([
  "draft",
  "draw",
  "discard",
  "build",
  "resell",
]);

/**
 * How many times a text resolves the action, one frame at a time (R7.2). On
 * every other op `n` is an amount taken in one step (R8.5), or a count that
 * follows one choice of a player, and its handler reads it.
 */
export function repetitions(action: ActionDef): number {
  return REPEATED.has(action.op) && "n" in action ? action.n : 1;
}

/** The handler of an action's key. An action without one is an engine bug. */
export function handlerOf(handlers: ActionHandlers, action: ActionDef): ActionHandler {
  const key = actionKey(action);
  const handler = Object.hasOwn(handlers, key) ? handlers[key] : undefined;
  if (handler === undefined) throw new Error(`No handler for action ${key}`);
  return handler;
}

/** Puts one action, or one repetition of it, on top of the stack for `seat`. */
export function pushAction(
  state: GameState,
  action: ActionDef,
  seat: Seat,
  continuation = false,
): GameState {
  // Repetitions are steps of one printed action, not new defence chances.
  return push(state, ACTION_FRAME, {
    action,
    seat,
    ...(continuation ? { defenceContinuation: true } : {}),
  });
}

/** The frame handler of the `action` kind: it steps the handler of the action's key. */
export function actionFrame(handlers: ActionHandlers): FrameHandler {
  return (state, frame, answer) => {
    const action = frame as ActionFrame;
    return withDefence(state, action, answer, handlerOf(handlers, action.action));
  };
}
