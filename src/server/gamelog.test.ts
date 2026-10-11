import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyChoice, startGame, viewFor, type Choice, type GameConfig } from "../engine/index.ts";
import { createGameLog } from "./gamelog.ts";
import { replayFile } from "../../tools/replay.ts";

let directory: string;
const config: GameConfig = { seats: 2, influences: false, kickstarter: false };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lunar-gamelog-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test("creates a log and replays accepted decisions to the identical state", () => {
  const log = createGameLog("game-1", config, "log-seed", () => {}, directory);
  let state = startGame(config, "log-seed").state;
  for (let n = 0; n < 30 && state.pending && !state.result; n++) {
    const pending = state.pending;
    const choice: Choice = {
      seat: pending.seat,
      decision: pending.id,
      option: pending.options[0].id,
    };
    const applied = applyChoice(state, choice);
    if (!applied.ok) throw new Error("Expected accepted choice");
    log.choice(choice, "human");
    state = applied.state;
  }
  expect(replayFile(log.path).state).toEqual(state);
  expect(replayFile(log.path, 1).view).toEqual(viewFor(replayFile(log.path, 1).state, null));
  const lines = readFileSync(log.path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
  expect(lines[0]).toEqual({ config, seed: "log-seed" });
  expect(lines).toHaveLength(31);
});

test("creates a missing nested log directory", () => {
  const missing = join(directory, "missing", "games");
  expect(existsSync(missing)).toBe(false);
  const log = createGameLog("nested", config, "seed", () => {}, missing);
  expect(existsSync(log.path)).toBe(true);
  expect(readFileSync(log.path, "utf8")).toBe(`${JSON.stringify({ config, seed: "seed" })}\n`);
});

test("write errors are reported and do not throw", () => {
  const errors = vi.fn();
  const blocked = join(directory, "blocked");
  writeFileSync(blocked, "file");
  const log = createGameLog("game-2", config, "seed", errors, blocked);
  expect(() => {
    log.choice({ seat: 0, decision: "d1", option: "o1" }, "human");
  }).not.toThrow();
  expect(errors).toHaveBeenCalled();
});
