import { ask } from "../decisions.ts";
import { pop, push } from "../loop.ts";
import type { ActionHandler } from "./index.ts";

/** R7.10 / D9: choose once, then let that opponent perform each Resell (D8). */
export const opponentResells: ActionHandler = (state, { action, seat }, answer) => {
  if (action.op !== "opponent_resells") throw new Error("Expected opponent_resells");
  if (answer === null) {
    return {
      state: ask(state, {
        seat,
        kind: "target",
        // Choose even when no card can be Resold. A sole opponent is automatic.
        options: state.credits.flatMap((_, target) =>
          target === seat
            ? []
            : [
                {
                  id: String(target),
                  label: `Player ${String(target + 1)} Resells`,
                  target,
                  op: action.op,
                },
              ],
        ),
      }),
    };
  }
  return {
    state: push(pop(state), "box", {
      seat: answer.option.target,
      actions: [{ op: "resell", n: action.n }],
      position: 0,
      repeated: 0,
      deferred: [],
    }),
  };
};
