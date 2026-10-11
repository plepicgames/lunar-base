import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { builtinMaker } from "../src/bots/builtin/index.ts";
import {
  applyChoice,
  catalogue,
  eventFor,
  startGame,
  viewFor,
  type Choice,
  type GameConfig,
  type GameResult,
  type GameState,
  type ViewEvent,
} from "../src/engine/index.ts";
import { MAX_TURNS } from "../src/server/limits.ts";

export type Condition = "credits" | "colonists" | "achievements" | "influences";
const influenceIds = new Set(
  catalogue.filter((card) => card.type === "influence").map((card) => card.id),
);

export interface Scenario {
  readonly config: GameConfig;
  readonly seed: string;
  readonly choices: readonly Choice[];
  readonly expected: {
    readonly result: GameResult;
    readonly turns: number;
    readonly stateHash: string;
    readonly conditions: readonly Condition[];
  };
}

function expectedOf(state: GameState): Scenario["expected"] {
  const result = state.result;
  if (result === null) throw new Error(`Game did not finish by turn ${String(MAX_TURNS)}`);
  const view = viewFor(state, null);
  const conditions = new Set<Condition>();
  for (const seat of result.winners) {
    const player = view.players[seat];
    if (player.credits >= view.targets.credits) conditions.add("credits");
    if (player.colonists >= view.targets.colonists) conditions.add("colonists");
    if (player.achievements.length >= view.targets.achievements) conditions.add("achievements");
    if (
      state.config.influences &&
      state.turn.seat === seat &&
      state.hands[seat].filter((card) => influenceIds.has(state.cards[card])).length >= 4
    )
      conditions.add("influences");
  }
  return {
    result,
    turns: state.turn.number,
    stateHash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    conditions: [...conditions].sort(),
  };
}

/** Replay stored choices without asking a maker again. */
export function replayScenario(scenario: Scenario): Scenario["expected"] {
  let state = startGame(scenario.config, scenario.seed).state;
  for (const [index, choice] of scenario.choices.entries()) {
    if (state.result !== null)
      throw new Error(`Choice ${String(index + 1)} comes after the result`);
    const applied = applyChoice(state, choice);
    if (!applied.ok) throw new Error(`Choice ${String(index + 1)}: ${applied.error.code}`);
    state = applied.state;
  }
  return expectedOf(state);
}

/** Record a whole game using the same per-seat request as a room. */
export async function recordScenario(config: GameConfig, seed: string): Promise<Scenario> {
  const makers = Array.from({ length: config.seats }, (_, seat) => builtinMaker(seed, seat));
  const histories: ViewEvent[][] = Array.from({ length: config.seats }, () => []);
  const choices: Choice[] = [];
  const signal = AbortSignal.abort();
  let current = startGame(config, seed);
  for (;;) {
    const state = current.state;
    for (let seat = 0; seat < config.seats; seat++) {
      histories[seat] = [
        ...histories[seat],
        ...current.events.flatMap((event) => eventFor(event, seat) ?? []),
      ].slice(-200);
    }
    if (state.result !== null)
      return { config: state.config, seed, choices, expected: expectedOf(state) };
    if (state.turn.number > MAX_TURNS)
      throw new Error(`Game did not finish by turn ${String(MAX_TURNS)}`);
    const decision = state.pending;
    if (decision === null) throw new Error("Game stopped without a decision or result");
    const seat = decision.seat;
    const option = await makers[seat].decide(
      { view: viewFor(state, seat), decision, seat, events: histories[seat] },
      signal,
    );
    const choice = { seat, decision: decision.id, option };
    const applied = applyChoice(state, choice);
    if (!applied.ok) throw new Error(`Choice ${String(choices.length + 1)}: ${applied.error.code}`);
    choices.push(choice);
    current = applied;
  }
}

async function main(args: string[]): Promise<void> {
  if (args.length !== 2)
    throw new Error("Usage: npm run scenario:record -- '<config-json>' '<seed>'");
  const config = JSON.parse(args[0]) as GameConfig;
  const seed = args[1];
  if (!seed) throw new Error("Seed must be nonempty");
  const scenario = await recordScenario(config, seed);
  const mode = `${config.influences ? "influences" : "base"}${config.kickstarter ? "-kickstarter" : ""}`;
  const slug = seed.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40);
  const tag = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  const directory = fileURLToPath(new URL("../src/engine/scenarios/", import.meta.url));
  const file = `${directory}${mode}-${String(config.seats)}-${slug}-${tag}.json`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, await format(JSON.stringify(scenario), { parser: "json", printWidth: 100 }));
  process.stdout.write(
    `${file}: ${scenario.expected.conditions.join("+")}, turn ${String(scenario.expected.turns)}, ${String(scenario.choices.length)} choices\n`,
  );
}

if (process.argv[1]?.endsWith("tools/scenario.ts")) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
