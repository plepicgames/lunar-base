// Long random engine runs. Keep this outside `npm run check`.
import { performance } from "node:perf_hooks";
import { gameRegistry, startGame } from "../src/engine/game.ts";
import { applyChoice, type Registry } from "../src/engine/loop.ts";
import { nextInt, seedToState } from "../src/engine/rng.ts";
import type { Choice, GameConfig, GameState, Seat } from "../src/engine/state.ts";
import { TURN_CAP } from "../src/engine/testing/play.ts";

type Options = { games: number; seed: string; influences: boolean; kickstarter: boolean };

function optionsOf(args: string[]): Options {
  const options: Options = {
    games: 2_000,
    seed: "lunar-base-soak",
    influences: false,
    kickstarter: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--influences") {
      options.influences = true;
    } else if (arg === "--kickstarter") {
      options.kickstarter = true;
    } else if (arg === "--games" && i + 1 < args.length) {
      options.games = Number(args[++i]);
    } else if (arg === "--seed" && i + 1 < args.length) {
      options.seed = args[++i];
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (!Number.isSafeInteger(options.games) || options.games < 1) {
    throw new Error("--games must be a positive integer");
  }
  return options;
}

/** One independent option stream per seat, using randomMaker's seed scheme. */
function pickers(seed: string, seats: number): (seat: Seat, count: number) => number {
  const streams = Array.from({ length: seats }, (_, seat) =>
    seedToState(JSON.stringify(["randomMaker", seed, seat])),
  );
  return (seat, count) => {
    const picked = nextInt(streams[seat], count);
    streams[seat] = picked.state;
    return picked.value;
  };
}

function runGame(
  config: GameConfig,
  seed: string,
): { turns: number; work: number; ending: string } {
  const choices: Choice[] = [];
  let work = 0;
  const registry: Registry = {
    handlers: gameRegistry.handlers,
    afterStep: (state, frame) => {
      work = Math.max(work, state.turn.work);
      return gameRegistry.afterStep(state, frame);
    },
  };
  try {
    let state: GameState = startGame(config, seed, registry).state;
    const pick = pickers(seed, config.seats);
    while (state.result === null && state.turn.number <= TURN_CAP) {
      const pending = state.pending;
      if (pending === null) throw new Error("Game stopped without a decision or result");
      const choice: Choice = {
        seat: pending.seat,
        decision: pending.id,
        option: pending.options[pick(pending.seat, pending.options.length)].id,
      };
      choices.push(choice);
      const applied = applyChoice(state, choice, registry);
      if (!applied.ok) throw new Error(applied.error.message);
      state = applied.state;
    }
    return {
      turns: state.result === null ? TURN_CAP : state.turn.number,
      work,
      ending: state.result?.reason ?? "turn_cap",
    };
  } catch (error) {
    process.stderr.write(`Failing game: ${JSON.stringify({ config, seed, choices })}\n`);
    throw error;
  }
}

function main(): void {
  const { games, seed, influences, kickstarter } = optionsOf(process.argv.slice(2));
  const started = performance.now();
  const endings = { victory: 0, turn_cap: 0, step_limit: 0 };
  let totalTurns = 0;
  let largestTurns = 0;
  let largestWork = 0;
  for (let game = 0; game < games; game += 1) {
    const config: GameConfig = { seats: 2 + (game % 5), influences, kickstarter };
    const played = runGame(config, `${seed}:${String(game)}`);
    if (!(played.ending in endings)) throw new Error(`Unknown ending: ${played.ending}`);
    endings[played.ending as keyof typeof endings] += 1;
    totalTurns += played.turns;
    largestTurns = Math.max(largestTurns, played.turns);
    largestWork = Math.max(largestWork, played.work);
  }
  process.stdout.write(
    `Games: ${String(games)} (seed ${JSON.stringify(seed)}, seats 2–6, influences ${String(influences)}, kickstarter ${String(kickstarter)})\n` +
      `Endings: ${String(endings.victory)} victory, ${String(endings.turn_cap)} turn cap, ` +
      `${String(endings.step_limit)} step budget\n` +
      `Turns: mean ${(totalTurns / games).toFixed(2)}, largest ${String(largestTurns)}\n` +
      `Largest turn.work: ${String(largestWork)}\n` +
      `Time: ${((performance.now() - started) / 1_000).toFixed(2)} s\n`,
  );
}

main();
