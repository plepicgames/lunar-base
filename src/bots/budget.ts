import { Declined } from "./fallback.ts";
import type { DecisionMaker } from "./maker.ts";

/** The length of the window a budget counts over. */
export const BUDGET_WINDOW_MINUTES = 60;

const MINUTE_MS = 60_000;

/** How many decisions a paid maker may be asked for, for everything that shares it. */
export interface DecisionBudget {
  /** Counts one decision. False when the window holds the limit already. */
  take(): boolean;
  /** Takes the newest count back: that decision made no request. */
  giveBack(): void;
  /** The decisions counted in the window now. */
  used(): number;
  /** How many minutes are remembered, for the test of the memory bound. */
  buckets(): number;
}

export type DecisionBudgetOptions = {
  /** Decisions per window, a whole number, 0 or more. 0 refuses every decision. */
  limit: number;
  now?: () => number;
  /** Receives one line when the budget is first used up and one when it is available again. */
  log?: (line: string) => void;
};

/**
 * A budget of decisions per sliding hour. It counts per clock minute, so it
 * remembers at most 61 numbers. A decision is counted until its minute is 61
 * minutes old: for 60 to 61 minutes, so no 60 minutes hold more than the limit.
 */
export function createDecisionBudget(options: DecisionBudgetOptions): DecisionBudget {
  const { limit } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? console.log;
  /** Decisions per clock minute, for the minutes still in the window. */
  const counts = new Map<number, number>();
  /** The minute of the newest count. */
  let newest = 0;
  /** True from the first refusal until the next decision that is let through. */
  let exhausted = false;
  const state = `limit=${String(limit)} window=${String(BUDGET_WINDOW_MINUTES)}m`;

  function used(): number {
    const oldest = Math.floor(now() / MINUTE_MS) - BUDGET_WINDOW_MINUTES;
    let total = 0;
    for (const [minute, count] of [...counts]) {
      if (minute < oldest) counts.delete(minute);
      else total += count;
    }
    return total;
  }

  return {
    take() {
      // A limit of 0 is a setting, not an exhaustion: the startup line says it.
      if (limit === 0) return false;
      if (used() >= limit) {
        if (!exhausted) log(`jev budget exhausted ${state}`);
        exhausted = true;
        return false;
      }
      if (exhausted) log(`jev budget resumed ${state}`);
      exhausted = false;
      newest = Math.floor(now() / MINUTE_MS);
      counts.set(newest, (counts.get(newest) ?? 0) + 1);
      return true;
    },
    giveBack() {
      const count = counts.get(newest) ?? 0;
      if (count > 1) counts.set(newest, count - 1);
      else counts.delete(newest);
    },
    used,
    buckets: () => counts.size,
  };
}

/**
 * A primary for `withFallback` that asks `primary` only while `budget` has a
 * decision left. Over the budget it rejects with `Declined("off")` without
 * asking: the fallback decides, and the primary has not failed. A decision
 * the primary itself declines made no request and is not counted.
 */
export function withDecisionBudget(primary: DecisionMaker, budget: DecisionBudget): DecisionMaker {
  return {
    async decide(request, signal) {
      if (!budget.take()) throw new Declined("off");
      try {
        return await primary.decide(request, signal);
      } catch (error) {
        if (error instanceof Declined) budget.giveBack();
        throw error;
      }
    },
  };
}
