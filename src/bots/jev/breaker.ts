/** Failed decisions in a row that turn Jev off. */
export const BREAKER_FAILURES = 3;

/** How long Jev stays off before one decision tries again. */
export const BREAKER_OFF_MS = 60_000;

/**
 * Keeps a failing Jev from costing every decision its budget. One breaker
 * serves the whole process.
 */
export interface Breaker {
  /**
   * The decision's pass if it may make a request. After the pause the first
   * caller is the one trial; the others are refused until it reports.
   */
  admit(): Pass | undefined;
}

/**
 * One admitted decision. It reports its result here, so the breaker knows a
 * result of a decision that was admitted before Jev was last turned off:
 * such a result changes nothing.
 */
export interface Pass {
  success(): void;
  /** Counts a failed decision. True when this failure turned Jev off. */
  failure(): boolean;
  /** Turns Jev off until the process restarts. */
  disable(): void;
}

type State =
  | { at: "closed"; failures: number }
  | { at: "open"; until: number }
  | { at: "trial" }
  | { at: "disabled" };

export function createBreaker(now: () => number = Date.now): Breaker {
  let state: State = { at: "closed", failures: 0 };
  /** How often Jev was turned off for a pause. */
  let pauses = 0;
  return {
    admit() {
      if (state.at === "open" && now() >= state.until) state = { at: "trial" };
      else if (state.at !== "closed") return undefined;
      const admittedAt = pauses;
      // A decision admitted before the last pause began reports late: neither
      // its success nor its failure ends the pause, the trial or the count.
      const late = () => admittedAt !== pauses;
      return {
        success() {
          if (state.at !== "disabled" && !late()) state = { at: "closed", failures: 0 };
        },
        failure() {
          if (state.at === "disabled" || late()) return false;
          // A failed trial opens the breaker again at once.
          const failures = state.at === "closed" ? state.failures + 1 : BREAKER_FAILURES;
          if (failures < BREAKER_FAILURES) {
            state = { at: "closed", failures };
            return false;
          }
          pauses += 1;
          state = { at: "open", until: now() + BREAKER_OFF_MS };
          return true;
        },
        disable() {
          state = { at: "disabled" };
        },
      };
    },
  };
}
