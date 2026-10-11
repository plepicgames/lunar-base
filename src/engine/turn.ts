// The turn (rules 4): its three steps, the Agents played in the first, the
// choice of a Main Action box, and the box that resolves its actions one at a
// time (rules 8).

import {
  actionFrame,
  ACTION_FRAME,
  pushAction,
  repetitions,
  type ActionHandlers,
} from "./actions/index.ts";
import { ON_PLAY_FRAME, pushOnPlay } from "./actions/build.ts";
import { actionsLabel } from "./actions/label.ts";
import { orbsOf, visibleSide, type CardOf } from "./base.ts";
import { cardById, type ActionDef, type CardDef } from "./catalogue.ts";
import { ask } from "./decisions.ts";
import {
  isTextFrame,
  pop,
  push,
  update,
  type FrameHandler,
  type Registry,
  type TextFrame,
} from "./loop.ts";
import { canPay, priceOf } from "./price.ts";
import { shuttleDeal, shuttleStep } from "./shuttle.ts";
import type { CardInstanceId, DecisionOption, Frame, GameState, Seat, TurnStep } from "./state.ts";
import { moveCard } from "./zones.ts";

/** R4.2: the steps of a turn, in order. The frame of a step is `<step>_step`. */
const STEPS: readonly TurnStep[] = ["agent", "main_action", "shuttle"];

/** The decision D1 (rules 13). */
export const AGENT_DECISION = "agent";

/** The frame of an Agent while its actions resolve: a text frame (R4.4). */
const AGENT_FRAME = "agent";

/** The decision D2 (rules 13). */
export const MAIN_ACTION_DECISION = "main_action";

/**
 * A Main Action box while it resolves. `position` and `repeated` are moved on
 * before each repetition is pushed, so a box with `position` past its last
 * action has nothing left to resolve (R8.3).
 */
export interface BoxFrame extends TextFrame {
  readonly seat: Seat;
  /** Repetitions of the action at `position` that were pushed so far (R7.2). */
  readonly repeated: number;
}

/** Puts the turn that `state.turn` names on the stack. Its first step starts it. */
export function pushTurn(state: GameState): GameState {
  return push(state, "turn", { begun: 0 });
}

/**
 * One step begins the next step of the turn (R4.2); the first of them starts
 * the turn's step budget. After the Shuttle step, one step ends the turn and
 * puts the turn of the next seat clockwise in its place (R4.10).
 */
const turn: FrameHandler = (state, frame) => {
  const begun = frame.begun as number;
  const { number, seat, work } = state.turn;
  if (begun === STEPS.length) {
    const next: Seat = (seat + 1) % state.config.seats;
    const ended = { ...pop(state), turn: { number: number + 1, seat: next, step: STEPS[0], work } };
    return { state: pushTurn(ended) };
  }
  const step = STEPS[begun];
  const started = begun === 0;
  const stepped = update(state, { ...frame, begun: begun + 1 });
  return {
    state: push(
      { ...stepped, turn: { number, seat, step, work: started ? 0 : work } },
      `${step}_step`,
    ),
    events: started ? [{ type: "turn_started", seat, turn: number }] : [],
  };
};

/** One Agent of the hand that the seat can pay for. */
export interface AgentOption extends DecisionOption {
  readonly card: CardInstanceId;
  /** Credits the Agent costs (R6.3). */
  readonly price: number;
}

/** An Agent that was paid for and waits to be moved to the play area. */
interface PaidAgent {
  readonly card: CardInstanceId;
  readonly price: number;
}

/** The `agent_step` frame. It holds `paid` between the payment and the move. */
type AgentStepFrame = Frame & { readonly paid?: PaidAgent };

/** The frame of an Agent in the play area: `card` is its instance id. */
interface AgentFrame extends BoxFrame {
  readonly card: CardInstanceId;
}

const GO_ON: DecisionOption = { id: "go_on", label: "Go on to the Main Action" };

/**
 * Every Agent in the hand of `seat` that the seat can pay for (R4.4, R6.4),
 * in hand order. The price comes from the Base as it is (R6.6).
 */
export function agentOptions(state: GameState, seat: Seat): AgentOption[] {
  const cardOf: CardOf = (instance) => cardById(state.cards[instance]);
  const orbs = orbsOf(state.bases[seat], cardOf);
  return state.hands[seat].flatMap((instance) => {
    const card = cardOf(instance);
    if (card.type !== "agent") return [];
    const price = priceOf(card.cost, orbs);
    if (!canPay(price, state.credits[seat])) return [];
    const label = `Play ${card.name}, pay ${String(price)}`;
    return [{ id: instance, label, card: instance, price }];
  });
}

/**
 * R4.3 / D1: the active player plays an Agent or goes on. The answer pays the
 * price as one step (R8.5); the next step moves the Agent to the play area
 * and puts its text on the stack (R4.4). The step asks again when that text
 * has left the stack, so an Agent that entered the hand can be played. With
 * no Agent to offer it leaves the stack without asking.
 */
const agentStep: FrameHandler = (state, frame, answer) => {
  const seat = state.turn.seat;
  const { paid, ...waiting } = frame as AgentStepFrame;
  if (paid !== undefined) {
    const { card: instance, price } = paid;
    const card = cardById(state.cards[instance]);
    const played = moveCard(update(state, waiting), instance, { hand: seat }, "play");
    return {
      state: push(played, AGENT_FRAME, {
        seat,
        card: instance,
        actions: card.on_play ?? [],
        position: 0,
        repeated: 0,
        deferred: [],
      }),
      events: [{ type: "agent_played", seat, card: { instance, cardId: card.id }, cost: price }],
    };
  }
  const options = agentOptions(state, seat);
  if (answer === null) {
    if (options.length === 0) return { state: pop(state) };
    return { state: ask(state, { seat, kind: AGENT_DECISION, options: [...options, GO_ON] }) };
  }
  if (answer.option.id === GO_ON.id) return { state: pop(state) };
  // The state has not changed since the decision was asked, so this is the
  // price from the Base as it is when the cost is paid (R6.6).
  const chosen = options.find(({ id }) => id === answer.option.id);
  if (chosen === undefined) throw new Error(`No Agent option ${answer.option.id}`);
  const { card, price } = chosen;
  const credits = state.credits[seat] - price;
  const paying = update(state, { ...frame, paid: { card, price } });
  return {
    state: {
      ...paying,
      credits: paying.credits.map((old, index) => (index === seat ? credits : old)),
    },
    events: price > 0 ? [{ type: "credits_changed", seat, delta: -price, credits }] : [],
  };
};

interface Box {
  readonly instance: CardInstanceId;
  /** The side that is visible: only its boxes exist (R9.2). */
  readonly card: CardDef;
  readonly box: number;
  readonly actions: readonly ActionDef[];
}

/**
 * R4.5: the Main Action boxes of a seat's Base. The Station's visible side
 * comes first, then the Modules in the order they were built; the boxes of
 * one card are in printed order.
 */
function boxesOf(state: GameState, seat: Seat): Box[] {
  const base = state.bases[seat];
  const cardOf: CardOf = (instance) => cardById(state.cards[instance]);
  const cards: (readonly [CardInstanceId, CardDef])[] = [
    [base.station.card, visibleSide(base.station, cardOf)],
    ...base.modules.map((module) => [module.card, cardOf(module.card)] as const),
  ];
  return cards.flatMap(([instance, card]) =>
    (card.main_action ?? []).map((actions, box) => ({ instance, card, box, actions })),
  );
}

function optionId({ instance, box }: Box): string {
  return `${instance}:${String(box)}`;
}

function boxOption(box: Box): DecisionOption {
  return {
    id: optionId(box),
    label: `${box.card.name}: ${actionsLabel(box.actions)}`,
    card: box.instance,
    box: box.box,
  };
}

/**
 * Asks D2 with every box of the active Base, whether or not the box can do
 * anything (R4.6). The answer puts the chosen box in the step's place.
 */
const mainActionStep: FrameHandler = (state, _frame, answer) => {
  const seat = state.turn.seat;
  const boxes = boxesOf(state, seat);
  if (answer === null) {
    return {
      state: ask(state, { seat, kind: MAIN_ACTION_DECISION, options: boxes.map(boxOption) }),
    };
  }
  const chosen = boxes.find((box) => optionId(box) === answer.option.id);
  if (chosen === undefined) throw new Error(`No Main Action box ${answer.option.id}`);
  return {
    state: push(pop(state), "box", {
      seat,
      // The card of this Main Action box; D3 names it.
      source: chosen.instance,
      actions: chosen.actions,
      position: 0,
      repeated: 0,
      deferred: [],
    }),
    events: [
      {
        type: "box_chosen",
        seat,
        card: { instance: chosen.instance, cardId: chosen.card.id },
        box: chosen.box,
      },
    ],
  };
};

/**
 * One step of a box, or of the "On playing this card" text of a built Module:
 * push the next repetition of its next action (R7.2, R8.1). With no action
 * left it pushes the text that was deferred first (R8.10), or leaves the
 * stack when none waits. The action frame throws for a key without a
 * handler, so no action is skipped.
 */
const box: FrameHandler = (state, frame) => {
  if (!isTextFrame(frame)) throw new Error(`Frame ${frame.id} is not a text frame`);
  const { position, repeated, seat } = frame as BoxFrame;
  const action = frame.actions.at(position);
  if (action === undefined) {
    if (frame.deferred.length === 0) return { state: pop(state) };
    const [first, ...waiting] = frame.deferred;
    return { state: pushOnPlay(update(state, { ...frame, deferred: waiting }), seat, first) };
  }
  const last = repeated + 1 >= repetitions(action);
  const moved = update(state, {
    ...frame,
    position: last ? position + 1 : position,
    repeated: last ? 0 : repeated + 1,
  });
  return { state: pushAction(moved, action, seat, repeated > 0) };
};

/**
 * One step of an Agent in the play area. It steps as a box does while it has
 * an action or a deferred text left. Then the Agent moves to the Discard
 * pile (R4.4 c): until that step it is in neither pile (R8.8).
 */
const agent: FrameHandler = (state, frame, answer) => {
  if (!isTextFrame(frame)) throw new Error(`Frame ${frame.id} is not a text frame`);
  if (frame.position < frame.actions.length || frame.deferred.length > 0) {
    return box(state, frame, answer);
  }
  const { seat, card: instance } = frame as AgentFrame;
  return {
    state: moveCard(pop(state), instance, "play", "discard"),
    events: [{ type: "agent_discarded", seat, card: { instance, cardId: state.cards[instance] } }],
  };
};

/** The frame handlers of a turn, with the action handlers its boxes resolve through. */
export function turnHandlers(actions: ActionHandlers): Registry["handlers"] {
  return {
    turn,
    agent_step: agentStep,
    main_action_step: mainActionStep,
    shuttle_step: shuttleStep,
    shuttle_deal: shuttleDeal,
    box,
    [AGENT_FRAME]: agent,
    [ON_PLAY_FRAME]: box,
    [ACTION_FRAME]: actionFrame(actions),
  };
}
