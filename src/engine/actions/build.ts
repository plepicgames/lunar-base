// Build (R7.7), the one optional action (R7.1). Its decision D6 is the single
// place where the placement rules and the price of a card meet.

import { orbsOf, type BaseModule, type CardOf, type OrbColour } from "../base.ts";
import { cardById } from "../catalogue.ts";
import { ask, type Answer } from "../decisions.ts";
import type { GameEvent } from "../events.ts";
import type { Quarter } from "../geometry.ts";
import { pushImmediate } from "../influences/immediate.ts";
import { supplyEffects } from "../influences/supply.ts";
import { isTextFrame, pop, push, update, type Step, type TextFrame } from "../loop.ts";
import { legalPlacements } from "../placement.ts";
import { canPay, priceOf } from "../price.ts";
import type { CardInstanceId, DecisionOption, Frame, GameState, Seat } from "../state.ts";
import type { ActionFrame, ActionHandler } from "./index.ts";

/** The frame of a built Module's "On playing this card" text: a text frame (R9.5). */
export const ON_PLAY_FRAME = "on_play";

/** One Module of the hand at one legal placement that the seat can pay for. */
export interface BuildOption extends DecisionOption, BaseModule {
  /** Credits the Build costs (R6.3). */
  readonly price: number;
  /** The Orbs the placement forms, in the slot order of the Module (R5.5). */
  readonly orbs: readonly OrbColour[];
}

/** A Build that was paid for and waits for its Module to be placed. */
interface PaidBuild extends BaseModule {
  readonly price: number;
}

/**
 * The `action` frame of a Build. It holds `paid` once the price was paid, and
 * `built`, the Module, once it lies in the Base and its text waits for D7.
 */
type BuildFrame = ActionFrame & { readonly paid?: PaidBuild; readonly built?: CardInstanceId };

/** The decision D7 (rules 13). */
export const DEFER_DECISION = "defer";

const SKIP: DecisionOption = { id: "skip", label: "Do not Build" };
const NOW = "now";
const LATER = "later";

/** How a card lies after q clockwise quarter turns (R5.3). */
const TURNS: Readonly<Record<Quarter, string>> = {
  0: "upright",
  1: "turned right",
  2: "upside down",
  3: "turned left",
};

/**
 * Every Build open to `seat`: each Module in hand, at each legal placement
 * (R7.7), if the seat can pay its price (R6.4). The order is hand position,
 * then y, x and q, so the option ids are stable for a state.
 */
export function buildOptions(state: GameState, seat: Seat): BuildOption[] {
  const base = state.bases[seat];
  const cardOf: CardOf = (instance) => cardById(state.cards[instance]);
  // R6.6: the Orbs of the Base as it is. The Module's own joints are not in it.
  const orbs = orbsOf(base, cardOf);
  return state.hands[seat].flatMap((instance) => {
    const card = cardOf(instance);
    if (card.type !== "module") return [];
    const price = priceOf(card.cost, orbs);
    if (!canPay(price, state.credits[seat])) return [];
    return legalPlacements(base, card, cardOf).map(({ x, y, q, orbs: formed }) => ({
      id: `${instance}:${String(x)},${String(y)},${String(q)}`,
      label: `Build ${card.name} at ${String(x)},${String(y)} ${TURNS[q]}, pay ${String(price)}`,
      card: instance,
      x,
      y,
      q,
      price,
      orbs: formed,
    }));
  });
}

/** Puts the "On playing this card" text of a built Module on top of the stack (R9.5). */
export function pushOnPlay(state: GameState, seat: Seat, instance: CardInstanceId): GameState {
  return push(state, ON_PLAY_FRAME, {
    seat,
    card: instance,
    actions: cardById(state.cards[instance]).on_play ?? [],
    position: 0,
    repeated: 0,
    deferred: [],
  });
}

/**
 * The text that holds a Build: the nearest text frame below the Build's
 * action frame (R8.3). It owns the texts the Build defers; it is found again
 * by its id, so frames pushed above it do not move them.
 */
function holderOf(state: GameState, frame: Frame): TextFrame | undefined {
  const index = state.stack.findIndex(({ id }) => id === frame.id);
  return state.stack.slice(0, index).findLast(isTextFrame);
}

/**
 * R7.7 (c–e): the Module leaves the hand for the Base. With a text and
 * actions left in the text that holds the Build, the frame stays to ask D7.
 * Otherwise the Module's text, if it has one, takes the action's place on the
 * stack and is resolved at once (R8.3).
 */
function place(state: GameState, frame: ActionFrame, { price, ...module }: PaidBuild): Step {
  const { seat } = frame;
  const { card: instance, x, y, q } = module;
  const card = cardById(state.cards[instance]);
  const placed: GameState = {
    ...state,
    hands: state.hands.map((hand, index) =>
      index === seat ? hand.filter((held) => held !== instance) : hand,
    ),
    bases: state.bases.map((base, index) =>
      index === seat ? { ...base, modules: [...base.modules, module] } : base,
    ),
  };
  const events: GameEvent[] = [
    { type: "module_built", seat, card: { instance, cardId: card.id }, x, y, q, cost: price },
  ];
  // R8.3: the builder has a choice only while that text has actions left.
  const holder = holderOf(placed, frame);
  const choice = holder !== undefined && holder.position < holder.actions.length;
  const next =
    (card.on_play ?? []).length === 0
      ? pop(placed)
      : choice
        ? update(placed, { ...frame, built: instance })
        : pushOnPlay(pop(placed), seat, instance);
  // R10.8: interrupts sit above both the on-play text and any D7 decision.
  const effects = supplyEffects(placed).flatMap(({ card: source, effect }) =>
    "when" in effect && effect.when === "any_player_builds" && effect.kinds.includes(card.kind)
      ? [{ card: source.instance, seat, actions: effect.then }]
      : [],
  );
  return {
    state: pushImmediate(next, effects),
    events,
  };
}

/**
 * R8.3 / D7: the builder resolves the text of the built Module now, or after
 * the text that holds the Build. "Later" puts it last in that text's
 * `deferred` list (R8.10); the Build's own frame never keeps it.
 */
function resolveText(
  state: GameState,
  frame: ActionFrame,
  instance: CardInstanceId,
  answer: Answer | null,
): Step {
  const { seat } = frame;
  const card = cardById(state.cards[instance]);
  if (answer === null) {
    const text = `Resolve the text of ${card.name}`;
    const options: DecisionOption[] = [
      { id: NOW, label: `${text} now`, card: instance },
      { id: LATER, label: `${text} after the current card`, card: instance },
    ];
    return { state: ask(state, { seat, kind: DEFER_DECISION, options }) };
  }
  if (answer.option.id !== LATER) return { state: pushOnPlay(pop(state), seat, instance) };
  const holder = holderOf(state, frame);
  if (holder === undefined) throw new Error(`No text holds the Build ${frame.id}`);
  return {
    state: pop(update(state, { ...holder, deferred: [...holder.deferred, instance] })),
    events: [{ type: "text_deferred", seat, card: { instance, cardId: card.id } }],
  };
}

/**
 * R7.7 / D6: one Build. The answer pays the price as one step (R8.5); the
 * next step places the Module; D7 follows when the builder has a choice.
 */
export const build: ActionHandler = (state, frame, answer) => {
  const { seat, paid, built } = frame as BuildFrame;
  if (built !== undefined) return resolveText(state, frame, built, answer);
  if (paid !== undefined) return place(state, frame, paid);
  if (answer === null) {
    return {
      state: ask(state, { seat, kind: "build", options: [SKIP, ...buildOptions(state, seat)] }),
    };
  }
  if (answer.option.id === SKIP.id) return { state: pop(state) };
  // The state has not changed since the decision was asked, so this is the
  // price from the Base as it is when the cost is paid (R6.6).
  const chosen = buildOptions(state, seat).find(({ id }) => id === answer.option.id);
  if (chosen === undefined) throw new Error(`No Build option ${answer.option.id}`);
  const { card, x, y, q, price } = chosen;
  const credits = state.credits[seat] - price;
  const paying = update(state, { ...frame, paid: { card, x, y, q, price } });
  return {
    state: {
      ...paying,
      credits: paying.credits.map((old, index) => (index === seat ? credits : old)),
    },
    events: price > 0 ? [{ type: "credits_changed", seat, delta: -price, credits }] : [],
  };
};
