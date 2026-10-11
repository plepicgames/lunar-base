import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DecidedBy } from "../bots/fallback.ts";
import type { Choice, GameConfig } from "../engine/index.ts";

export interface GameLog {
  readonly path: string;
  choice(choice: Choice, by: DecidedBy | "human"): void;
}

/** Server-only record of the seed and accepted choices. Never send it to a client. */
export function createGameLog(
  id: string,
  config: GameConfig,
  seed: string,
  log: (line: string) => void = console.log,
  directory = join(".data", "games"),
): GameLog {
  const path = join(directory, `${id}.jsonl`);
  let writable = true;
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, `${JSON.stringify({ config, seed })}\n`, { flag: "wx" });
  } catch {
    writable = false;
    log(`game=${id} gamelog_write_error path=${path}`);
  }
  return {
    path,
    choice(choice, by) {
      if (!writable) return;
      try {
        appendFileSync(path, `${JSON.stringify({ ...choice, by })}\n`);
      } catch {
        writable = false;
        log(`game=${id} gamelog_write_error path=${path}`);
      }
    },
  };
}
