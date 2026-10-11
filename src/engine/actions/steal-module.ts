// R7.14: choose a Module of the named kind in an opponent's Base and take it
// into the hand. It is the only way a Module leaves a Base (R9.3).
import type { BaseModule } from "../base.ts";
import { cardById, type CardDef } from "../catalogue.ts";
import { ask } from "../decisions.ts";
import { supplyEffects } from "../influences/supply.ts";
import { pop } from "../loop.ts";
import type { GameState, Seat } from "../state.ts";
import type { ActionHandler } from "./index.ts";

/** The decision D11 (rules 13). */
export const STEAL_MODULE_DECISION = "steal_module";

interface Stealable {
  readonly victim: Seat;
  readonly module: BaseModule;
  readonly card: CardDef;
}

/**
 * Every Module of `kind` in a Base other than the thief's (Q11), in seat
 * order and then in the order built. The kind decides, not the STEALABLE tag
 * (Q10).
 */
function stealable(state: GameState, thief: Seat, kind: string): Stealable[] {
  return state.bases.flatMap((base, victim) =>
    victim === thief
      ? []
      : base.modules.flatMap((module) => {
          const card = cardById(state.cards[module.card]);
          return card.kind === kind ? [{ victim, module, card }] : [];
        }),
  );
}

export const stealModule: ActionHandler = (state, { action, seat }, answer) => {
  if (action.op !== "steal_module") throw new Error("Expected steal_module");
  const cops = supplyEffects(state).find(
    ({ effect }) => "rule" in effect && effect.rule === "forbid_steal_modules",
  );
  if (cops) {
    return {
      state: pop(state),
      events: [{ type: "action_blocked", seat, action: "steal_module", card: cops.card }],
    };
  }
  const found = stealable(state, seat, action.kind);
  // R7.5: with no such Module the action is skipped.
  if (found.length === 0) return { state: pop(state) };
  if (answer === null) {
    return {
      state: ask(state, {
        seat,
        kind: STEAL_MODULE_DECISION,
        // The loop takes the only Module without asking.
        options: found.map(({ victim, module, card }) => ({
          id: module.card,
          label: `Steal ${card.name} at ${String(module.x)},${String(module.y)} from Player ${String(victim + 1)}`,
          card: module.card,
          target: victim,
        })),
      }),
    };
  }
  // The state has not changed since the decision was asked.
  const chosen = found.find(({ module }) => module.card === answer.option.id);
  if (chosen === undefined) throw new Error(`No Steal Module option ${answer.option.id}`);
  const { victim, card } = chosen;
  const instance = chosen.module.card;
  // R5.16: every other Module stays where it lies. Nothing else is stored, so
  // the Orbs, colonists and achievements of the Base follow from this (R5.8).
  return {
    state: pop({
      ...state,
      bases: state.bases.map((base, owner) =>
        owner === victim
          ? { ...base, modules: base.modules.filter((module) => module.card !== instance) }
          : base,
      ),
      hands: state.hands.map((hand, owner) => (owner === seat ? [...hand, instance] : hand)),
    }),
    events: [{ type: "module_stolen", thief: seat, victim, card: { instance, cardId: card.id } }],
  };
};
