import { readFileSync } from "node:fs";
import {
  applyChoice,
  startGame,
  viewFor,
  type Choice,
  type GameConfig,
} from "../src/engine/index.ts";
import { MAX_TURNS } from "../src/server/limits.ts";

export function replayFile(file: string, at?: number) {
  const lines = readFileSync(file, "utf8").trimEnd().split("\n");
  const first = JSON.parse(lines[0]) as { config: GameConfig; seed: string };
  if (typeof first.seed !== "string") throw new Error("Invalid game log header");
  let state = startGame(first.config, first.seed).state;
  const choices = lines.slice(1);
  if (at !== undefined && (!Number.isSafeInteger(at) || at < 0 || at > choices.length))
    throw new Error(`--at must be between 0 and ${String(choices.length)}`);
  const limit = at ?? choices.length;
  for (let n = 0; n < limit; n++) {
    const choice = JSON.parse(choices[n]) as Choice;
    const applied = applyChoice(state, choice);
    if (!applied.ok) throw new Error(`Choice ${String(n + 1)}: ${applied.error.code}`);
    state = applied.state;
  }
  const result =
    state.result ??
    (state.turn.number > MAX_TURNS
      ? {
          reason: "turn_limit" as const,
          winners: [],
          scores: Array<number>(state.config.seats).fill(0),
        }
      : null);
  return { state, choices: limit, result, view: viewFor(state, null) };
}

function main(args: string[]): void {
  const file = args[0];
  if (
    !file ||
    (args.length !== 1 && args.length !== 3) ||
    (args.length === 3 && args[1] !== "--at")
  )
    throw new Error("Usage: npm run replay -- <file> [--at <n>]");
  const at = args[1] === "--at" ? Number(args[2]) : undefined;
  const replay = replayFile(file, at);
  process.stdout.write(
    `turns=${String(replay.state.turn.number)} choices=${String(replay.choices)} result=${replay.result?.reason ?? "ongoing"} winners=${JSON.stringify(replay.result?.winners ?? [])}\n`,
  );
  if (at !== undefined) process.stdout.write(`${JSON.stringify(replay.view, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("tools/replay.ts")) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
