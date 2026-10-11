import { flipStations } from "../actions/flip.ts";
import { discardCard } from "../actions/discard.ts";
import type { ActionFrame, ActionHandler } from "../actions/index.ts";
import { cardById, type ActionDef } from "../catalogue.ts";
import { ask, type Answer } from "../decisions.ts";
import { isTextFrame, pop, update, type Step } from "../loop.ts";
import type { Frame, GameState, Seat } from "../state.ts";
import { supplyEffects } from "./supply.ts";

/** Choices already made by the acting player, before any effect is applied. */
export interface ActionChoices {
  readonly target?: Seat;
  readonly card?: string;
  readonly seat?: Seat;
  readonly seats?: readonly Seat[];
}

/** R10.10: affected seats after the acting player has made the action choices. */
export function affectedBy(
  action: ActionDef,
  choices: ActionChoices,
  state: GameState,
): readonly Seat[] {
  const { target } = choices;
  const seat = choices.seat ?? state.turn.seat;
  if (action.op === "flip") {
    switch (action.who) {
      case "own":
        return [seat];
      case "each_player":
        return state.bases.map((_, index) => index);
      case "all_to_terran_outpost":
        return state.bases.flatMap(({ station }, index) =>
          station.side === "named" ? [index] : [],
        );
      case "any_one":
      case "any_two":
      case "any_number":
      case "neighbours_of_target":
        return choices.seats ?? [];
    }
  }
  if (action.op === "discard" || action.op === "discard_hand") {
    return state.hands[seat].length > 0 && (action.op === "discard_hand" || action.n > 0)
      ? [seat]
      : [];
  }
  if (action.op === "each_opponent_discards") {
    return state.hands.flatMap((hand, index) =>
      index !== seat && hand.length > 0 && action.n > 0 ? [index] : [],
    );
  }
  if (target === undefined) return [];
  switch (action.op) {
    case "steal_credits":
      return supplyEffects(state).some(
        ({ effect }) => "rule" in effect && effect.rule === "forbid_steal_credits",
      )
        ? []
        : [target];
    case "steal_module":
      if (
        supplyEffects(state).some(
          ({ effect }) => "rule" in effect && effect.rule === "forbid_steal_modules",
        )
      )
        return [];
      return state.bases[target].modules.some(
        ({ card }) => card === choices.card && cardById(state.cards[card]).kind === action.kind,
      )
        ? [target]
        : [];
    case "opponent_resells":
      return action.n > 0 &&
        state.supply.some((instance) => {
          const { type } = cardById(state.cards[instance]);
          return type === "module" || type === "agent";
        })
        ? [target]
        : [];
    case "target_discards":
    case "that_opponent_discards":
      return action.n > 0 && state.hands[target].length > 0 ? [target] : [];
    case "look_at_opponent_hand":
      return [target];
    case "build":
    case "choose_one":
    case "draft":
    case "draw":
    case "each_player_loses_credits":
    case "exchange_station":
    case "gain_credit_per_hand_card":
    case "neighbours_exchange_stations":
    case "resell_per_supply_influence":
    case "resell":
    case "shuttle_red_orbs_pay":
    case "that_opponent_discards_all_agents":
      return [];
  }
}

/** Choice boxes inherit their text's source; an interrupt or Module text does not. */
function owningAgent(state: GameState): Frame | undefined {
  for (const frame of state.stack.toReversed()) {
    if (frame.defenceCovered === true) return undefined;
    if (frame.kind === "agent") return frame;
    if (
      isTextFrame(frame) &&
      (typeof frame.card === "string" || typeof frame.source === "string")
    ) {
      return undefined;
    }
  }
  return undefined;
}

type WaitingAction = ActionFrame & {
  readonly defenceAnswer?: Answer;
  readonly defenceSeats?: readonly Seat[];
  readonly defenceAsked?: readonly Seat[];
};

/** Keep the Look target even if defence prevents the hand from being shown (Q34). */
function rememberOpponent(
  state: GameState,
  agent: Frame,
  action: ActionDef,
  target: Seat,
): GameState {
  return action.op === "look_at_opponent_hand"
    ? update(state, { ...agent, opponent: target })
    : state;
}

/** D12 interrupts after the attacker's choice and before the action's first effect. */
export function withDefence(
  state: GameState,
  frame: ActionFrame,
  answer: Answer | null,
  handler: ActionHandler,
): Step {
  const agent = owningAgent(state);
  if (!agent) return handler(state, frame, answer);
  const waiting = frame as WaitingAction;
  // A multi-step handler has already completed this action's defence window.
  if (frame.defenceResolved === true) return handler(state, frame, answer);
  if (answer?.decision.kind === "defence") {
    if (answer.option.id === "decline") return withDefence(state, frame, null, handler);
    const target = answer.decision.seat;
    const defenders = (agent.defenders ?? []) as readonly Seat[];
    const protectedState = update(state, { ...agent, defenders: [...defenders, target] });
    // Keep the waiting action: other affected players still get their chance
    // after this Influence's complete immediate text.
    return discardCard(protectedState, target, answer.option.id);
  }
  if (waiting.defenceSeats === undefined) {
    const target =
      frame.action.op === "that_opponent_discards" ? agent.opponent : answer?.option.target;
    const affected = affectedBy(
      frame.action,
      {
        seat: frame.seat,
        ...(typeof target === "number" ? { target } : {}),
        ...(typeof answer?.option.card === "string" ? { card: answer.option.card } : {}),
        ...(Array.isArray(answer?.option.seats)
          ? { seats: answer.option.seats as readonly Seat[] }
          : {}),
      },
      state,
    );
    // Actions with a target or Station-set choice reach here again after it.
    if (affected.length === 0) return handler(state, frame, answer);
    const remembered =
      typeof target === "number" ? rememberOpponent(state, agent, frame.action, target) : state;
    const prepared = {
      ...frame,
      defenceSeats: affected,
      defenceAsked: [],
      ...(answer === null
        ? {}
        : { defenceAnswer: { decision: { ...answer.decision }, option: answer.option } }),
    };
    // Preparing the window is not a game step: with nobody defending, the
    // action must still resolve in the same step as it did without Influences.
    return withDefence(update(remembered, prepared), prepared, null, handler);
  }
  const defenders = (agent.defenders ?? []) as readonly Seat[];
  const asked = waiting.defenceAsked ?? [];
  const order = Array.from(
    { length: state.hands.length },
    (_, offset) => (state.turn.seat + offset) % state.hands.length,
  );
  for (const target of order) {
    if (
      frame.defenceContinuation === true ||
      !waiting.defenceSeats.includes(target) ||
      asked.includes(target) ||
      defenders.includes(target)
    )
      continue;
    const influences = state.hands[target].filter(
      (instance) => cardById(state.cards[instance]).type === "influence",
    );
    if (influences.length === 0) continue;
    return {
      state: ask(update(state, { ...frame, defenceAsked: [...asked, target] }), {
        seat: target,
        kind: "defence",
        options: [
          { id: "decline", label: "Do not defend", action: frame.action, actor: frame.seat },
          ...influences.map((card) => ({
            id: card,
            card,
            action: frame.action,
            actor: frame.seat,
            label: `Discard ${cardById(state.cards[card]).name} to defend`,
          })),
        ],
      }),
    };
  }
  const remaining = waiting.defenceSeats.filter((seat) => !defenders.includes(seat));
  if (frame.action.op === "flip") return flipStations(pop(state), remaining);
  if (remaining.length === 0) return { state: pop(state) };
  const resolved = { ...frame, defenceResolved: true, defenceExcluded: defenders };
  return handler(update(state, resolved), resolved, waiting.defenceAnswer ?? null);
}
