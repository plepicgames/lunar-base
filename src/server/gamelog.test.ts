import {
  existsSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyChoice, startGame, viewFor, type Choice, type GameConfig } from "../engine/index.ts";
import { PROTOCOL_VERSION } from "../protocol/messages.ts";
import {
  buildVersion,
  createGameLog,
  gameLogDays,
  gameLogDirectory,
  startGameLogSweep,
  sweepGameLogs,
} from "./gamelog.ts";
import { replayFile } from "../../tools/replay.ts";

let directory: string;
const config: GameConfig = { seats: 2, influences: false, kickstarter: false };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lunar-gamelog-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 31);
const created = () => new Date(NOW);
const header = (seed: string) => ({
  config,
  seed,
  build: "dev",
  protocol: PROTOCOL_VERSION,
  created: "2026-01-31T00:00:00.000Z",
});
/** A file name as the server writes it: the game ID is a random UUID. */
const named = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function aged(name: string, age: number, content = "{}\n"): string {
  const path = join(directory, name);
  writeFileSync(path, content);
  utimesSync(path, (NOW - age) / 1000, (NOW - age) / 1000);
  return path;
}

test("creates a log and replays accepted decisions to the identical state", () => {
  vi.stubEnv("LUNAR_BUILD", undefined);
  const log = createGameLog("game-1", config, "log-seed", () => {}, directory, created);
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
  expect(lines[0]).toEqual(header("log-seed"));
  expect(lines).toHaveLength(31);
});

test("creates a missing nested log directory", () => {
  const missing = join(directory, "missing", "games");
  expect(existsSync(missing)).toBe(false);
  vi.stubEnv("LUNAR_BUILD", undefined);
  const log = createGameLog("nested", config, "seed", () => {}, missing, created);
  expect(existsSync(log.path)).toBe(true);
  expect(readFileSync(log.path, "utf8")).toBe(`${JSON.stringify(header("seed"))}\n`);
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

test("the header names the build that wrote the log", () => {
  vi.stubEnv("LUNAR_BUILD", "1.4.0");
  const log = createGameLog("built", config, "seed", () => {}, directory, created);
  expect(JSON.parse(readFileSync(log.path, "utf8"))).toMatchObject({ build: "1.4.0" });
  expect(buildVersion({ LUNAR_BUILD: "" })).toBe("dev");
  expect(buildVersion({})).toBe("dev");
});

test("a choice line holds the seat, decision, option and maker, and nothing else", () => {
  const log = createGameLog("strict", config, "seed", () => {}, directory);
  const extra = { seat: 1, decision: "d1", option: "o1", name: "Zebedee" };
  log.choice(extra, "human");
  const line = readFileSync(log.path, "utf8").trimEnd().split("\n")[1];
  expect(JSON.parse(line)).toEqual({ seat: 1, decision: "d1", option: "o1", by: "human" });
});

test("logs go to .data/games unless LUNAR_LOG_DIR names another directory", () => {
  expect(gameLogDirectory({})).toBe(join(".data", "games"));
  expect(gameLogDirectory({ LUNAR_LOG_DIR: "  " })).toBe(join(".data", "games"));
  expect(gameLogDirectory({ LUNAR_LOG_DIR: directory })).toBe(directory);

  vi.stubEnv("LUNAR_LOG_DIR", undefined);
  const usual = createGameLog(`default-${String(process.pid)}`, config, "seed", () => {});
  expect(usual.path).toBe(join(".data", "games", `default-${String(process.pid)}.jsonl`));
  expect(existsSync(usual.path)).toBe(true);
  rmSync(usual.path, { force: true });

  const chosen = join(directory, "chosen");
  vi.stubEnv("LUNAR_LOG_DIR", chosen);
  const log = createGameLog("placed", config, "seed", () => {});
  expect(log.path).toBe(join(chosen, "placed.jsonl"));
  expect(existsSync(log.path)).toBe(true);
});

test("logs are kept for 30 days unless LUNAR_LOG_DAYS names a whole number of days", () => {
  expect(gameLogDays({})).toBe(30);
  expect(gameLogDays({ LUNAR_LOG_DAYS: "1" })).toBe(1);
  expect(gameLogDays({ LUNAR_LOG_DAYS: " 45 " })).toBe(45);
});

test.each(["0", "-1", "abc", "", " ", "1.5", "1e2", "7d", "Infinity", "9".repeat(20)])(
  "LUNAR_LOG_DAYS=%j is rejected",
  (value) => {
    expect(() => gameLogDays({ LUNAR_LOG_DAYS: value })).toThrow(/LUNAR_LOG_DAYS must be/);
  },
);

test("a sweep deletes logs older than the limit and keeps one exactly at it", () => {
  const old = aged(`${named(1)}.jsonl`, 30 * DAY + 1000);
  const boundary = aged(`${named(2)}.jsonl`, 30 * DAY);
  const young = aged(`${named(3)}.jsonl`, DAY);
  const lines: string[] = [];
  sweepGameLogs({ directory, days: 30, now: () => NOW, log: (line) => lines.push(line) });
  expect(existsSync(old)).toBe(false);
  expect(existsSync(boundary)).toBe(true);
  expect(existsSync(young)).toBe(true);
  expect(lines).toEqual([`gamelog_sweep deleted=1 directory=${directory}`]);
});

test("a sweep keeps the log of a game that is still open, however old", () => {
  const log = createGameLog(named(4), config, "seed", () => {}, directory);
  utimesSync(log.path, (NOW - 90 * DAY) / 1000, (NOW - 90 * DAY) / 1000);
  sweepGameLogs({ directory, days: 30, now: () => NOW, log: () => {} });
  expect(existsSync(log.path)).toBe(true);
  log.close();
  sweepGameLogs({ directory, days: 30, now: () => NOW, log: () => {} });
  expect(existsSync(log.path)).toBe(false);
});

test("a sweep leaves alone everything that is not a log file of this server", () => {
  const outside = mkdtempSync(join(tmpdir(), "lunar-outside-"));
  const target = join(outside, `${named(5)}.jsonl`);
  writeFileSync(target, "outside\n");
  utimesSync(target, (NOW - 90 * DAY) / 1000, (NOW - 90 * DAY) / 1000);
  const link = join(directory, `${named(5)}.jsonl`);
  symlinkSync(target, link);
  lutimesSync(link, (NOW - 90 * DAY) / 1000, (NOW - 90 * DAY) / 1000);
  const folder = join(directory, `${named(6)}.jsonl`);
  mkdirSync(folder);
  const nested = join(folder, `${named(7)}.jsonl`);
  writeFileSync(nested, "{}\n");
  for (const path of [nested, folder])
    utimesSync(path, (NOW - 90 * DAY) / 1000, (NOW - 90 * DAY) / 1000);
  const others = ["notes.txt", "game-1.jsonl", `${named(8)}.jsonl.bak`, `x${named(9)}.jsonl`];
  for (const name of others) aged(name, 90 * DAY);
  const lines: string[] = [];
  sweepGameLogs({ directory, days: 30, now: () => NOW, log: (line) => lines.push(line) });
  expect(readdirSync(directory).sort()).toEqual(
    [...others, `${named(5)}.jsonl`, `${named(6)}.jsonl`].sort(),
  );
  expect(existsSync(nested)).toBe(true);
  expect(readFileSync(target, "utf8")).toBe("outside\n");
  expect(lines).toEqual([]);
  rmSync(outside, { recursive: true, force: true });
});

test("a sweep that fails logs one line and does not throw", () => {
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  // No game has been logged yet: nothing to delete and nothing to report.
  sweepGameLogs({ directory: join(directory, "missing"), days: 30, now: () => NOW, log });
  expect(lines).toEqual([]);

  const blocked = join(directory, "blocked");
  writeFileSync(blocked, "file");
  expect(() => {
    sweepGameLogs({ directory: blocked, days: 30, now: () => NOW, log });
  }).not.toThrow();
  expect(lines).toEqual([`gamelog_sweep_error directory=${blocked} failed=1 code=ENOTDIR`]);

  lines.length = 0;
  const stuck = aged(`${named(10)}.jsonl`, 90 * DAY);
  const gone = aged(`${named(11)}.jsonl`, 90 * DAY);
  const remove = (path: string) => {
    if (path === stuck) throw Object.assign(new Error("denied"), { code: "EACCES" });
    rmSync(path);
  };
  expect(() => {
    sweepGameLogs({ directory, days: 30, now: () => NOW, log, remove });
  }).not.toThrow();
  expect(existsSync(stuck)).toBe(true);
  expect(existsSync(gone)).toBe(false);
  expect(lines).toEqual([
    `gamelog_sweep deleted=1 directory=${directory}`,
    `gamelog_sweep_error directory=${directory} failed=1 code=EACCES`,
  ]);
});

test("the sweep runs at once and then daily on a timer that does not hold the process", () => {
  let now = NOW;
  const handle = { unref: vi.fn() };
  const timer = {
    setInterval: vi.fn<(run: () => void, ms: number) => typeof handle>(() => handle),
    clearInterval: vi.fn(),
  };
  const first = aged(`${named(12)}.jsonl`, 2 * DAY);
  const second = aged(`${named(13)}.jsonl`, DAY / 2);
  const sweep = startGameLogSweep({ directory, days: 1, now: () => now, log: () => {}, timer });
  expect(existsSync(first)).toBe(false);
  expect(existsSync(second)).toBe(true);
  expect(timer.setInterval).toHaveBeenCalledExactlyOnceWith(expect.any(Function), DAY);
  expect(handle.unref).toHaveBeenCalledOnce();

  now += DAY;
  timer.setInterval.mock.calls[0][0]();
  expect(existsSync(second)).toBe(false);

  sweep.stop();
  expect(timer.clearInterval).toHaveBeenCalledExactlyOnceWith(handle);
});

test("replay reads a log of the new format and one of the old format", () => {
  const choices = (path: string) => {
    let state = startGame(config, "both").state;
    for (let n = 0; n < 5 && state.pending; n++) {
      const pending = state.pending;
      const choice = { seat: pending.seat, decision: pending.id, option: pending.options[0].id };
      const applied = applyChoice(state, choice);
      if (!applied.ok) throw new Error("Expected accepted choice");
      writeFileSync(path, `${JSON.stringify({ ...choice, by: "human" })}\n`, { flag: "a" });
      state = applied.state;
    }
    return state;
  };
  const current = createGameLog("current", config, "both", () => {}, directory);
  const old = join(directory, "old.jsonl");
  writeFileSync(old, `${JSON.stringify({ config, seed: "both" })}\n`);
  const expected = choices(old);
  choices(current.path);
  expect(replayFile(old).state).toEqual(expected);
  expect(replayFile(current.path).state).toEqual(expected);
  expect(replayFile(current.path).choices).toBe(5);
});
