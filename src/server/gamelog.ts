import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DecidedBy } from "../bots/fallback.ts";
import type { Choice, GameConfig } from "../engine/index.ts";
import { PROTOCOL_VERSION } from "../protocol/messages.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** `<game-id>.jsonl`, where the lobby makes each game ID with `randomUUID`. */
const LOG_FILE = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/;
/** Games whose log this process may still write. The sweep never deletes one. */
const open = new Set<string>();

type Environment = Readonly<Record<string, string | undefined>>;

/** Where logs are written: `LUNAR_LOG_DIR`, or `.data/games` when it is unset or blank. */
export function gameLogDirectory(env: Environment = process.env): string {
  return env.LUNAR_LOG_DIR?.trim() ? env.LUNAR_LOG_DIR : join(".data", "games");
}

/** How long a log is kept: `LUNAR_LOG_DAYS` whole days, 30 when unset. Throws on any other value. */
export function gameLogDays(env: Environment = process.env): number {
  const raw = env.LUNAR_LOG_DAYS;
  if (raw === undefined) return 30;
  const days = /^[1-9]\d*$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(days))
    throw new Error(`LUNAR_LOG_DAYS must be a whole number of days, 1 or more; got "${raw}"`);
  return days;
}

/** The build that runs: `LUNAR_BUILD`, or `dev`, as the client build names it. */
export function buildVersion(env: Environment = process.env): string {
  return env.LUNAR_BUILD ? env.LUNAR_BUILD : "dev";
}

export interface GameLog {
  readonly path: string;
  choice(choice: Choice, by: DecidedBy | "human"): void;
  /** The game is over and gone: its log may now be deleted when it is old enough. */
  close(): void;
}

/**
 * Server-only record of the seed and accepted choices. Never send it to a client.
 * It holds seat numbers only: no name, session token or address.
 */
export function createGameLog(
  id: string,
  config: GameConfig,
  seed: string,
  log: (line: string) => void = console.log,
  directory = gameLogDirectory(),
  now: () => Date = () => new Date(),
): GameLog {
  const path = join(directory, `${id}.jsonl`);
  const header = {
    config,
    seed,
    build: buildVersion(),
    protocol: PROTOCOL_VERSION,
    created: now().toISOString(),
  };
  let writable = true;
  open.add(id);
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, `${JSON.stringify(header)}\n`, { flag: "wx" });
  } catch {
    writable = false;
    log(`game=${id} gamelog_write_error path=${path}`);
  }
  return {
    path,
    choice({ seat, decision, option }, by) {
      if (!writable) return;
      try {
        appendFileSync(path, `${JSON.stringify({ seat, decision, option, by })}\n`);
      } catch {
        writable = false;
        log(`game=${id} gamelog_write_error path=${path}`);
      }
    },
    close() {
      open.delete(id);
    },
  };
}

export interface SweepOptions {
  readonly directory: string;
  readonly days: number;
  /** The current time in milliseconds. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  readonly remove?: (path: string) => void;
}

const errorCode = (error: unknown): string =>
  error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "unknown";

/**
 * Delete the logs last written more than `days` days ago. Only a regular file
 * named `<game-id>.jsonl` directly in the directory is deleted: never a
 * symbolic link, a directory, another file, or the log of an open game.
 * Never throws: a failure is one log line, and the next sweep tries again.
 */
export function sweepGameLogs(options: SweepOptions): void {
  const { directory, days } = options;
  const log = options.log ?? console.log;
  const remove = options.remove ?? unlinkSync;
  const oldest = (options.now ?? Date.now)() - days * DAY_MS;
  let deleted = 0;
  let failed = 0;
  let code = "";
  const failure = (error: unknown): void => {
    failed += 1;
    code ||= errorCode(error);
  };
  let names: string[] = [];
  try {
    names = readdirSync(directory);
  } catch (error) {
    // A directory that does not exist yet has had no game logged in it.
    if (errorCode(error) !== "ENOENT") failure(error);
  }
  for (const name of names) {
    const id = LOG_FILE.exec(name)?.[1];
    if (id === undefined || open.has(id)) continue;
    const path = join(directory, name);
    try {
      // lstat does not follow a symbolic link, so a link is never a regular file here.
      const entry = lstatSync(path);
      if (!entry.isFile() || entry.mtimeMs >= oldest) continue;
      remove(path);
      deleted += 1;
    } catch (error) {
      failure(error);
    }
  }
  if (deleted > 0) log(`gamelog_sweep deleted=${String(deleted)} directory=${directory}`);
  if (failed > 0)
    log(`gamelog_sweep_error directory=${directory} failed=${String(failed)} code=${code}`);
}

export interface SweepTimer<Handle extends { unref(): unknown }> {
  setInterval(run: () => void, ms: number): Handle;
  clearInterval(handle: Handle): void;
}

/** Sweep now and then once a day. The timer does not keep the process alive. */
export function startGameLogSweep<Handle extends { unref(): unknown } = NodeJS.Timeout>(
  options: SweepOptions & { readonly timer?: SweepTimer<Handle> },
): { stop(): void } {
  const timer = options.timer ?? (globalThis as unknown as SweepTimer<Handle>);
  sweepGameLogs(options);
  const handle = timer.setInterval(() => {
    sweepGameLogs(options);
  }, DAY_MS);
  handle.unref();
  return {
    stop() {
      timer.clearInterval(handle);
    },
  };
}
