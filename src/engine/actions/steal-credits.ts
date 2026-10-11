// R7.13: choose an opponent, then transfer the available amount in one step.
import { ask } from "../decisions.ts";
import { supplyEffects } from "../influences/supply.ts";
import { pop } from "../loop.ts";
import type { ActionHandler } from "./index.ts";

export const stealCredits: ActionHandler = (state, { action, seat }, answer) => {
  if (action.op !== "steal_credits") throw new Error("Expected steal_credits");
  const alliance = supplyEffects(state).find(
    ({ effect }) => "rule" in effect && effect.rule === "forbid_steal_credits",
  );
  if (alliance) {
    return {
      state: pop(state),
      events: [{ type: "action_blocked", seat, action: "steal_credits", card: alliance.card }],
    };
  }
  if (answer === null) {
    return {
      state: ask(state, {
        seat,
        kind: "target",
        // Zero Credits does not remove a legal opponent. The loop automatically
        // takes the only option in a two-player game (D9).
        options: state.credits.flatMap((_, target) =>
          target === seat
            ? []
            : [
                {
                  id: String(target),
                  label: `Steal from Player ${String(target + 1)}`,
                  target,
                },
              ],
        ),
      }),
    };
  }
  const victim = answer.option.target as number;
  const amount = Math.min(action.n, state.credits[victim]);
  return {
    state: pop({
      ...state,
      credits: state.credits.map((credits, owner) =>
        owner === seat ? credits + amount : owner === victim ? credits - amount : credits,
      ),
    }),
    events: [{ type: "credits_stolen", thief: seat, victim, amount }],
  };
};
