import type { Choice, DecisionOption, GameState, PendingDecision } from "./state.ts";

export type ChoiceErrorCode = "stale_decision" | "wrong_seat" | "unknown_option";

/** Why a choice was rejected. Plain JSON, so the server can send it on. */
export interface ChoiceError {
  readonly code: ChoiceErrorCode;
  readonly message: string;
}

/** The option taken for a decision, with the decision it answers. */
export interface Answer {
  readonly decision: PendingDecision;
  readonly option: DecisionOption;
}

export type CheckedChoice =
  ({ readonly ok: true } & Answer) | { readonly ok: false; readonly error: ChoiceError };

function reject(code: ChoiceErrorCode, message: string): CheckedChoice {
  return { ok: false, error: { code, message } };
}

/**
 * Sets the pending decision with the next decision id. The caller lists every
 * legal option in the documented order of its decision kind; that order and
 * the option ids are what a client or bot picks from.
 */
export function ask(state: GameState, decision: Omit<PendingDecision, "id">): GameState {
  if (state.pending !== null) throw new Error(`Decision ${state.pending.id} is still pending`);
  if (decision.options.length === 0) throw new Error(`Decision ${decision.kind} has no options`);
  const ids = new Set<string>();
  for (const { id } of decision.options) {
    if (ids.has(id)) throw new Error(`Decision ${decision.kind} repeats option id ${id}`);
    ids.add(id);
  }
  const decisions = state.counters.decisions + 1;
  return {
    ...state,
    counters: { ...state.counters, decisions },
    pending: {
      id: `d${String(decisions)}`,
      seat: decision.seat,
      kind: decision.kind,
      options: [...decision.options],
    },
  };
}

/** The answer a choice gives to the pending decision, or the first reason to reject it. */
export function checkChoice(state: GameState, choice: Choice): CheckedChoice {
  if (state.result !== null) {
    return reject("stale_decision", "The game has ended; no decision can be answered.");
  }
  const pending = state.pending;
  if (pending?.id !== choice.decision) {
    return reject("stale_decision", `Decision ${choice.decision} is not the pending decision.`);
  }
  if (pending.seat !== choice.seat) {
    return reject("wrong_seat", `Decision ${pending.id} is not for seat ${String(choice.seat)}.`);
  }
  const option = pending.options.find(({ id }) => id === choice.option);
  if (option === undefined) {
    return reject("unknown_option", `Decision ${pending.id} has no option ${choice.option}.`);
  }
  return { ok: true, decision: pending, option };
}
