import { Declined } from "./fallback.ts";
import type { DecisionMaker } from "./maker.ts";

/** The length of the window a budget counts over. */
export const BUDGET_WINDOW_MINUTES = 60;

const MINUTE_MS = 60_000;

/**
 * Takes one counted decision back: it made no request. It takes from the
 * minute its own decision was counted in, and only once: a second call, and
 * a call after that minute left the window, change nothing.
 */
export type Refund = () => void;

/** How many decisions a paid maker may be asked for, for everything that shares it. */
export interface DecisionBudget {
  /** Counts one decision and returns its refund, or `undefined` when the window holds the limit already. */
  take(): Refund | undefined;
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
 *
 * The budget's time never goes backwards. Each operation reads the clock
 * once and keeps the latest time it has seen: a reading before that one,
 * from a wall clock that was set back, counts as no time passed. So a count
 * is never filed under a minute that has left the window already, and the
 * minutes remembered stay within one window.
 */
export function createDecisionBudget(options: DecisionBudgetOptions): DecisionBudget {
  const { limit } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? console.log;
  /** Decisions per clock minute, for the minutes still in the window. */
  const counts = new Map<number, number>();
  /** The latest time the clock has shown. */
  let latest = Number.NEGATIVE_INFINITY;
  /** True from the first refusal until the next decision that is let through. */
  let exhausted = false;
  const state = `limit=${String(limit)} window=${String(BUDGET_WINDOW_MINUTES)}m`;

  /** Reads the clock once: the current minute, never earlier than the one before. */
  function currentMinute(): number {
    latest = Math.max(latest, now());
    return Math.floor(latest / MINUTE_MS);
  }

  /** The decisions counted in the window that ends with `current`; forgets older minutes. */
  function usedAt(current: number): number {
    const oldest = current - BUDGET_WINDOW_MINUTES;
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
      if (limit === 0) return undefined;
      const minute = currentMinute();
      if (usedAt(minute) >= limit) {
        if (!exhausted) log(`jev budget exhausted ${state}`);
        exhausted = true;
        return undefined;
      }
      if (exhausted) log(`jev budget resumed ${state}`);
      exhausted = false;
      counts.set(minute, (counts.get(minute) ?? 0) + 1);
      let refunded = false;
      return () => {
        if (refunded) return;
        refunded = true;
        // Forgets the minutes that left the window, this one perhaps among
        // them. Time never goes back, so a forgotten minute is never counted
        // in again: what is still here under `minute` holds this decision.
        usedAt(currentMinute());
        const count = counts.get(minute);
        if (count === undefined) return;
        if (count > 1) counts.set(minute, count - 1);
        else counts.delete(minute);
      };
    },
    used: () => usedAt(currentMinute()),
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
      const refund = budget.take();
      if (!refund) throw new Declined("off");
      try {
        return await primary.decide(request, signal);
      } catch (error) {
        if (error instanceof Declined) refund();
        throw error;
      }
    },
  };
}
