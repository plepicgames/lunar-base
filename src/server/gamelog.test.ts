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
  gameLogSettings,
  refuseLinkedLogDirectory,
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
const quiet = () => {};
const at = { log: quiet, now: () => NOW };
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
  const log = createGameLog("game-1", config, "log-seed", { ...at, directory });
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
  const log = createGameLog("nested", config, "seed", { ...at, directory: missing });
  expect(existsSync(log.path)).toBe(true);
  expect(readFileSync(log.path, "utf8")).toBe(`${JSON.stringify(header("seed"))}\n`);
});

test("write errors are reported and do not throw", () => {
  const errors = vi.fn();
  const blocked = join(directory, "blocked");
  writeFileSync(blocked, "file");
  const log = createGameLog("game-2", config, "seed", { log: errors, directory: blocked });
  expect(() => {
    log.choice({ seat: 0, decision: "d1", option: "o1" }, "human");
  }).not.toThrow();
  expect(errors).toHaveBeenCalled();
});

test("the header names the build that wrote the log", () => {
  const log = createGameLog("built", config, "seed", { ...at, directory, build: "1.4.0" });
  expect(JSON.parse(readFileSync(log.path, "utf8"))).toMatchObject({ build: "1.4.0" });
  expect(buildVersion({ LUNAR_BUILD: "" })).toBe("dev");
  expect(buildVersion({})).toBe("dev");
  expect(buildVersion({ LUNAR_BUILD: "1.4.0" })).toBe("1.4.0");
});

test("a choice line holds the seat, decision, option and maker, and nothing else", () => {
  const log = createGameLog("strict", config, "seed", { log: quiet, directory });
  const extra = { seat: 1, decision: "d1", option: "o1", name: "Zebedee" };
  log.choice(extra, "human");
  const line = readFileSync(log.path, "utf8").trimEnd().split("\n")[1];
  expect(JSON.parse(line)).toEqual({ seat: 1, decision: "d1", option: "o1", by: "human" });
});

test("logs go to .data/games unless LUNAR_LOG_DIR names another directory", () => {
  expect(gameLogDirectory({})).toBe(join(".data", "games"));
  expect(gameLogDirectory({ LUNAR_LOG_DIR: "  " })).toBe(join(".data", "games"));
  expect(gameLogDirectory({ LUNAR_LOG_DIR: directory })).toBe(directory);

  // The environment is read once by `main`; a log never reads it again.
  vi.stubEnv("LUNAR_LOG_DIR", join(directory, "ignored"));
  vi.stubEnv("LUNAR_BUILD", "ignored");
  const usual = createGameLog(`default-${String(process.pid)}`, config, "seed", at);
  expect(usual.path).toBe(join(".data", "games", `default-${String(process.pid)}.jsonl`));
  expect(readFileSync(usual.path, "utf8")).toBe(`${JSON.stringify(header("seed"))}\n`);
  rmSync(usual.path, { force: true });
  expect(existsSync(join(directory, "ignored"))).toBe(false);

  const chosen = join(directory, "chosen");
  const log = createGameLog("placed", config, "seed", { log: quiet, directory: chosen });
  expect(log.path).toBe(join(chosen, "placed.jsonl"));
  expect(existsSync(log.path)).toBe(true);
  expect(gameLogSettings({ LUNAR_LOG_DIR: chosen, LUNAR_LOG_DAYS: "7", LUNAR_BUILD: "2" })).toEqual(
    { directory: chosen, days: 7, build: "2" },
  );
  expect(gameLogSettings({})).toEqual({
    directory: join(".data", "games"),
    days: 30,
    build: "dev",
  });
});

test("a log directory that is a symbolic link is refused", () => {
  const real = join(directory, "real");
  mkdirSync(real);
  const link = join(directory, "link");
  symlinkSync(real, link);
  expect(() => {
    refuseLinkedLogDirectory(link);
  }).toThrow(`The game log directory must not be a symbolic link: ${link}`);
  expect(() => {
    refuseLinkedLogDirectory(`${link}/`);
  }).toThrow(/must not be a symbolic link/);
  expect(() => {
    refuseLinkedLogDirectory(real);
    refuseLinkedLogDirectory(join(directory, "missing"));
  }).not.toThrow();
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
  const open = new Set<string>();
  const log = createGameLog(named(4), config, "seed", { log: quiet, directory, open });
  utimesSync(log.path, (NOW - 90 * DAY) / 1000, (NOW - 90 * DAY) / 1000);
  sweepGameLogs({ directory, days: 30, open, ...at });
  expect(existsSync(log.path)).toBe(true);
  log.close();
  sweepGameLogs({ directory, days: 30, open, ...at });
  expect(existsSync(log.path)).toBe(false);
});

test("closing a game of one server does not unprotect the same ID in another", () => {
  const servers = ["one", "two"].map((name) => {
    const open = new Set<string>();
    const log = createGameLog(named(14), config, "seed", {
      log: quiet,
      directory: join(directory, name),
      open,
    });
    utimesSync(log.path, (NOW - 90 * DAY) / 1000, (NOW - 90 * DAY) / 1000);
    return { open, log, directory: join(directory, name) };
  });
  servers[0].log.close();
  for (const { open, directory: own } of servers)
    sweepGameLogs({ directory: own, days: 30, open, ...at });
  expect(existsSync(servers[0].log.path)).toBe(false);
  expect(existsSync(servers[1].log.path)).toBe(true);
});

test("a log callback that throws does not escape the sweep or stop the timer", () => {
  const log = vi.fn(() => {
    throw new Error("logger is broken");
  });
  const handle = { unref: vi.fn() };
  const timer = {
    setInterval: vi.fn<(run: () => void, ms: number) => typeof handle>(() => handle),
    clearInterval: vi.fn(),
  };
  const first = aged(`${named(15)}.jsonl`, 90 * DAY);
  expect(() =>
    startGameLogSweep({ directory, days: 30, now: () => NOW, log, timer }),
  ).not.toThrow();
  expect(existsSync(first)).toBe(false);
  const second = aged(`${named(16)}.jsonl`, 90 * DAY);
  expect(() => {
    timer.setInterval.mock.calls[0][0]();
  }).not.toThrow();
  expect(existsSync(second)).toBe(false);
  expect(log).toHaveBeenCalledTimes(2);
  expect(timer.clearInterval).not.toHaveBeenCalled();
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
  const current = createGameLog("current", config, "both", { log: quiet, directory });
  const old = join(directory, "old.jsonl");
  writeFileSync(old, `${JSON.stringify({ config, seed: "both" })}\n`);
  const expected = choices(old);
  choices(current.path);
  expect(replayFile(old).state).toEqual(expected);
  expect(replayFile(current.path).state).toEqual(expected);
  expect(replayFile(current.path).choices).toBe(5);
});
