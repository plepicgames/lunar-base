import type { Seat } from "../../engine/index.ts";
import { nextInt, seedToState } from "../../engine/rng.ts";
import type { DecisionMaker } from "../maker.ts";
import { scorer } from "./score.ts";

export { score } from "./score.ts";

/** Synchronous scoring with an immediately resolved answer for the async interface. */
export function builtinMaker(seed: string, seat: Seat): DecisionMaker {
  let rng = seedToState(JSON.stringify(["builtinMaker", seed, seat]));
  return {
    decide(request) {
      const evaluate = scorer(request);
      let best = -Infinity;
      let tied: string[] = [];
      for (const option of request.decision.options) {
        const value = evaluate(option);
        if (value > best) {
          best = value;
          tied = [option.id];
        } else if (value === best) tied.push(option.id);
      }
      // Valid decisions have options. Advance even when there is only one best.
      const step = nextInt(rng, tied.length);
      rng = step.state;
      return Promise.resolve(tied[step.value]);
    },
  };
}
