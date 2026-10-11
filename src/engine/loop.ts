import type { ActionDef } from "./catalogue.ts";
import { checkChoice, type Answer, type ChoiceError } from "./decisions.ts";
import type { GameEvent } from "./events.ts";
import type { CardInstanceId, Choice, Frame, GameState, JsonValue } from "./state.ts";

/** Loop steps one turn may use before the game ends with no winner (Q42). */
export const STEP_BUDGET = 5000;

/** What one step did: the next state and the events it emitted, in order. */
export interface Step {
  readonly state: GameState;
  readonly events?: readonly GameEvent[];
}

/**
 * Performs one step of the top frame: change the state, emit events, push or
 * pop frames, or ask a decision. `answer` is null unless the frame's last step
 * asked a decision; it is that decision's answer and `pending` is cleared. A
 * handler never mutates its arguments.
 */
export type FrameHandler = (state: GameState, frame: Frame, answer: Answer | null) => Step;

/** Runs after every step, with the frame that was stepped as it was before. */
export type AfterStep = (state: GameState, frame: Frame) => Step;

export interface Registry {
  readonly handlers: Readonly<Record<string, FrameHandler>>;
  readonly afterStep: AfterStep;
}

export interface Resolved {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export type ChoiceResult =
  ({ readonly ok: true } & Resolved) | { readonly ok: false; readonly error: ChoiceError };

/**
 * A frame that holds a list of actions: a Main Action box, an Agent, an "On
 * playing this card" text or an Influence effect. `position` is the action to
 * resolve next. `deferred` holds the built Modules whose texts wait for the
 * end of this text, first deferred first (R8.3, R8.10).
 */
export interface TextFrame extends Frame {
  readonly actions: readonly ActionDef[];
  readonly position: number;
  readonly deferred: readonly CardInstanceId[];
}

export function isTextFrame(frame: Frame): frame is TextFrame {
  return (
    Array.isArray(frame.actions) &&
    typeof frame.position === "number" &&
    Array.isArray(frame.deferred)
  );
}

/** Puts a new frame on top of the stack, with the next frame id. */
export function push(
  state: GameState,
  kind: string,
  data: Readonly<Record<string, JsonValue>> = {},
): GameState {
  const frames = state.counters.frames + 1;
  return {
    ...state,
    counters: { ...state.counters, frames },
    stack: [...state.stack, { ...data, id: `f${String(frames)}`, kind }],
  };
}

/** Removes the top frame. */
export function pop(state: GameState): GameState {
  if (state.stack.length === 0) throw new Error("The resolution stack is empty");
  return { ...state, stack: state.stack.slice(0, -1) };
}

/** Replaces the frame that has this frame's id, wherever it lies on the stack. */
export function update(state: GameState, frame: Frame): GameState {
  if (!state.stack.some(({ id }) => id === frame.id)) {
    throw new Error(`Frame ${frame.id} is not on the resolution stack`);
  }
  return { ...state, stack: state.stack.map((old) => (old.id === frame.id ? frame : old)) };
}

/** No rule decides this ending, so nobody wins and nobody scores. */
function stepLimit(state: GameState): Step {
  const seats = state.config.seats;
  return {
    state: {
      ...state,
      stack: [],
      pending: null,
      result: { reason: "step_limit", winners: [], scores: Array<number>(seats).fill(0) },
    },
    events: [
      {
        type: "game_ended",
        reason: "step_limit",
        winners: [],
        scores: Array<number>(seats).fill(0),
      },
    ],
  };
}

function resolve(start: GameState, registry: Registry, chosen: Answer | null): Resolved {
  let state = start;
  let answer = chosen;
  const events: GameEvent[] = [];
  const apply = (step: Step): void => {
    state = step.state;
    if (step.events) events.push(...step.events);
  };
  while (state.result === null) {
    if (state.turn.work >= STEP_BUDGET) {
      apply(stepLimit(state));
      break;
    }
    if (state.pending !== null) {
      const { id, options } = state.pending;
      if (options.length === 0) throw new Error(`Decision ${id} has no options`);
      if (answer === null) {
        if (options.length > 1) break;
        answer = { decision: state.pending, option: options[0] };
      }
      state = { ...state, pending: null };
    }
    const frame = state.stack.at(-1);
    if (frame === undefined) throw new Error("The resolution stack is empty");
    if (!Object.hasOwn(registry.handlers, frame.kind)) {
      throw new Error(`No handler for frame kind ${frame.kind}`);
    }
    apply(registry.handlers[frame.kind](state, frame, answer));
    answer = null;
    state = { ...state, turn: { ...state.turn, work: state.turn.work + 1 } };
    apply(registry.afterStep(state, frame));
  }
  return { state, events };
}

/**
 * Runs the game forward until a decision with more than one option is
 * pending, a result is set, or the turn's step budget is used up. A decision
 * with one option is applied at once, as a step of its own.
 */
export function run(state: GameState, registry: Registry): Resolved {
  return resolve(state, registry, null);
}

/** Applies a valid choice as one step and runs on. Never mutates its input. */
export function applyChoice(state: GameState, choice: Choice, registry: Registry): ChoiceResult {
  const checked = checkChoice(state, choice);
  if (!checked.ok) return checked;
  const { decision, option } = checked;
  return { ok: true, ...resolve(state, registry, { decision, option }) };
}
