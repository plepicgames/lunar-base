import { expect, test } from "vitest";
import { startGame, gameRegistry } from "../../engine/game.ts";
import { applyChoice } from "../../engine/loop.ts";
import { eventFor, viewFor, type ViewEvent } from "../../engine/index.ts";
import { TURN_CAP } from "../../engine/testing/play.ts";
import { randomMaker } from "../maker.ts";
import { builtinMaker } from "./index.ts";

test.each([
  [false, false],
  [true, false],
  [true, true],
])(
  "wins at least 65 of 100 seeded games against random (Influences: %s, Kickstarter: %s) within 20 seconds",
  async (influences, kickstarter) => {
    const started = performance.now();
    const signal = AbortSignal.abort();
    let wins = 0;
    let losses = 0;
    let noWinner = 0;
    let turns = 0;
    let stepLimits = 0;
    for (let game = 0; game < 100; game++) {
      const seed = `builtin-strength:${String(game)}`;
      const makers = [builtinMaker(seed, 0), randomMaker(seed, 1)];
      let result = startGame({ seats: 2, influences, kickstarter, startingSeat: game % 2 }, seed);
      const histories: ViewEvent[][] = [[], []];
      for (;;) {
        const state = result.state;
        for (const seat of [0, 1])
          histories[seat] = [
            ...histories[seat],
            ...result.events.flatMap((event) => eventFor(event, seat) ?? []),
          ].slice(-200);
        if (state.result || state.turn.number > TURN_CAP) break;
        const decision = state.pending;
        if (!decision) throw new Error(`No decision or result: ${seed}`);
        const seat = decision.seat;
        const option = await makers[seat].decide(
          { view: viewFor(state, seat), decision, seat, events: histories[seat] },
          signal,
        );
        const applied = applyChoice(state, { seat, decision: decision.id, option }, gameRegistry);
        if (!applied.ok) throw new Error(`${seed}: ${applied.error.message}`);
        result = applied;
      }
      const ending = result.state.result;
      if (ending?.winners.includes(0)) wins++;
      else if (ending?.winners.includes(1)) losses++;
      else noWinner++;
      if (ending?.reason === "step_limit") stepLimits++;
      turns += Math.min(TURN_CAP, result.state.turn.number);
    }
    const seconds = (performance.now() - started) / 1000;
    process.stdout.write(
      `builtin strength (Influences: ${String(influences)}, Kickstarter: ${String(kickstarter)}): ${String(wins)} wins, ${String(losses)} losses, ${String(noWinner)} no winner; mean turns ${(turns / 100).toFixed(2)}; ${String(stepLimits)} step limits; ${seconds.toFixed(2)} s\n`,
    );
    expect(wins).toBeGreaterThanOrEqual(65);
    expect(wins + losses + noWinner).toBe(100);
    expect(stepLimits).toBe(0);
    expect(seconds).toBeLessThan(20);
  },
  20_000,
);

test.each([
  [false, false, "issue26:2:754"],
  [true, true, "issue26:2:405"],
  [true, true, "issue26:2:644"],
  [true, true, "issue26:2:876"],
])(
  "two built-in makers reach a result before the turn limit (Influences: %s, Kickstarter: %s, seed %s)",
  async (influences, kickstarter, seed) => {
    const signal = AbortSignal.abort();
    const makers = [builtinMaker(seed, 0), builtinMaker(seed, 1)];
    let result = startGame({ seats: 2, influences, kickstarter }, seed);
    const histories: ViewEvent[][] = [[], []];
    for (;;) {
      const state = result.state;
      for (const seat of [0, 1])
        histories[seat] = [
          ...histories[seat],
          ...result.events.flatMap((event) => eventFor(event, seat) ?? []),
        ].slice(-200);
      if (state.result || state.turn.number > TURN_CAP) break;
      const decision = state.pending;
      if (!decision) throw new Error(`No decision or result: ${seed}`);
      const seat = decision.seat;
      const option = await makers[seat].decide(
        { view: viewFor(state, seat), decision, seat, events: histories[seat] },
        signal,
      );
      const applied = applyChoice(state, { seat, decision: decision.id, option }, gameRegistry);
      if (!applied.ok) throw new Error(`${seed}: ${applied.error.message}`);
      result = applied;
    }
    expect(result.state.result?.reason).toBe("victory");
    expect(result.state.turn.number).toBeLessThanOrEqual(TURN_CAP);
  },
);
