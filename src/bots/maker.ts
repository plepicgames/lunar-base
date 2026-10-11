import type {
  DecisionOption,
  PendingDecision,
  PlayerView,
  Seat,
  ViewEvent,
} from "../engine/index.ts";
import { nextInt, seedToState } from "../engine/rng.ts";

export type OptionId = DecisionOption["id"];

export type DecisionRequest = {
  view: PlayerView;
  /** A decision offered to this seat, with at least one option. */
  decision: PendingDecision;
  seat: Seat;
  /** This seat's filtered event history, newest last (at most 200). */
  events: ViewEvent[];
};

export interface DecisionMaker {
  decide(request: DecisionRequest, signal: AbortSignal): Promise<OptionId>;
}

/** A uniform picker with a private, deterministic stream per seed and seat. */
export function randomMaker(seed: string, seat: Seat): DecisionMaker {
  let rng = seedToState(JSON.stringify(["randomMaker", seed, seat]));
  return {
    decide({ decision }) {
      // Valid requests always offer options. The immediate fallback still
      // answers when its caller's signal is aborted; it has no work to cancel.
      const step = nextInt(rng, decision.options.length);
      rng = step.state;
      return Promise.resolve(decision.options[step.value].id);
    },
  };
}
