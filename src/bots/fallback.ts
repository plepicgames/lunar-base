import type { DecisionMaker, DecisionRequest, OptionId } from "./maker.ts";

/** Time for one decision by the primary maker. */
export const DECISION_BUDGET_MS = 8_000;

export type FallbackLimits = {
  /** After this long the primary's signal is aborted and the fallback decides. */
  budgetMs: number;
};

/** Which maker decided, as the log names it. */
export type DecidedBy =
  "jev" | "builtin" | "builtin-after-jev-failure" | "builtin-too-many-options";

export type Decided = { option: OptionId; by: DecidedBy };

/** The one maker a room talks to. */
export interface FallbackMaker extends DecisionMaker {
  /** `decide`, with the maker whose answer it is. */
  decideBy(request: DecisionRequest, signal: AbortSignal): Promise<Decided>;
}

/**
 * A primary rejects with this when it makes no attempt: it is off, or the
 * decision has more options than it can send. The fallback's answer is then
 * no failure of the primary.
 */
export class Declined extends Error {
  readonly reason: "off" | "too-many-options";

  constructor(reason: "off" | "too-many-options") {
    super(`Declined: ${reason}`);
    this.name = "Declined";
    this.reason = reason;
  }
}

/**
 * Asks `primary` within the budget and `fallback` when that gives no offered
 * option. The fallback's own answer is not checked here: the room validates
 * it like a human's. With one maker in both places there is no primary: it is
 * asked once, without a budget, and decides as `builtin`.
 */
export function withFallback(
  primary: DecisionMaker,
  fallback: DecisionMaker,
  limits: FallbackLimits = { budgetMs: DECISION_BUDGET_MS },
): FallbackMaker {
  async function decideBy(request: DecisionRequest, signal: AbortSignal): Promise<Decided> {
    let by: DecidedBy = "builtin";
    if (primary !== fallback) {
      const budget = new AbortController();
      const stop = () => {
        budget.abort();
      };
      const timer = setTimeout(stop, limits.budgetMs);
      signal.addEventListener("abort", stop);
      if (signal.aborted) stop();
      try {
        const option = await new Promise<OptionId>((resolve, reject) => {
          const giveUp = () => {
            reject(new Error("The decision's budget is used up"));
          };
          budget.signal.addEventListener("abort", giveUp);
          if (budget.signal.aborted) giveUp();
          // A late answer or rejection of an aborted primary settles nothing.
          Promise.resolve()
            .then(() => primary.decide(request, budget.signal))
            .then(resolve, reject);
        });
        if (request.decision.options.some(({ id }) => id === option)) return { option, by: "jev" };
        by = "builtin-after-jev-failure";
      } catch (error) {
        if (!(error instanceof Declined)) by = "builtin-after-jev-failure";
        else if (error.reason === "too-many-options") by = "builtin-too-many-options";
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      }
    }
    return { option: await fallback.decide(request, signal), by };
  }
  return {
    decideBy,
    decide: (request, signal) => decideBy(request, signal).then(({ option }) => option),
  };
}
