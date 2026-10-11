import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DecidedBy } from "../bots/fallback.ts";
import type { Choice, GameConfig } from "../engine/index.ts";
import { PROTOCOL_VERSION } from "../protocol/messages.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** `<game-id>.jsonl`, where the lobby makes each game ID with `randomUUID`. */
const LOG_FILE = /^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/;
export const DEFAULT_LOG_DIRECTORY = join(".data", "games");
export const DEFAULT_LOG_DAYS = 30;
export const DEFAULT_BUILD = "dev";

// This module never reads `process.env`. `main` reads the settings once for a
// server and hands them on, so its logs and its sweep cannot disagree.
type Environment = Readonly<Record<string, string | undefined>>;

/** What one server knows about its logs. */
export interface GameLogSettings {
  readonly directory: string;
  readonly days: number;
  readonly build: string;
}

export function gameLogSettings(env: Environment): GameLogSettings {
  return { directory: gameLogDirectory(env), days: gameLogDays(env), build: buildVersion(env) };
}

/** Where logs are written: `LUNAR_LOG_DIR`, or `.data/games` when it is unset or blank. */
export function gameLogDirectory(env: Environment): string {
  return env.LUNAR_LOG_DIR?.trim() ? env.LUNAR_LOG_DIR : DEFAULT_LOG_DIRECTORY;
}

/** How long a log is kept: `LUNAR_LOG_DAYS` whole days, 30 when unset. Throws on any other value. */
export function gameLogDays(env: Environment): number {
  const raw = env.LUNAR_LOG_DAYS;
  if (raw === undefined) return DEFAULT_LOG_DAYS;
  const days = /^[1-9]\d*$/.test(raw.trim()) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(days))
    throw new Error(`LUNAR_LOG_DAYS must be a whole number of days, 1 or more; got "${raw}"`);
  return days;
}

/** The build that runs: `LUNAR_BUILD`, or `dev`, as the client build names it. */
export function buildVersion(env: Environment): string {
  return env.LUNAR_BUILD ? env.LUNAR_BUILD : DEFAULT_BUILD;
}

/**
 * Throw when the log directory is a symbolic link: a sweep would then delete
 * files in a place the setting does not name. A missing directory is fine.
 */
export function refuseLinkedLogDirectory(directory: string): void {
  let linked = false;
  try {
    // `resolve` drops a trailing slash, which would make lstat follow the link.
    linked = lstatSync(resolve(directory)).isSymbolicLink();
  } catch {
    // Missing or unreadable: the first write reports it and play goes on.
  }
  if (linked) throw new Error(`The game log directory must not be a symbolic link: ${directory}`);
}

export interface GameLog {
  readonly path: string;
  choice(choice: Choice, by: DecidedBy | "human"): void;
  /** The game is over and gone: its log may now be deleted when it is old enough. */
  close(): void;
}

export interface GameLogOptions {
  readonly log?: (line: string) => void;
  readonly directory?: string;
  readonly build?: string;
  /** The current time in milliseconds. */
  readonly now?: () => number;
  /** The open games of the server that owns this log; its sweep reads the same set. */
  readonly open?: Set<string>;
}

/**
 * Server-only record of the seed and accepted choices. Never send it to a client.
 * It holds seat numbers only: no name, session token or address.
 */
export function createGameLog(
  id: string,
  config: GameConfig,
  seed: string,
  options: GameLogOptions = {},
): GameLog {
  const log = options.log ?? console.log;
  const open = options.open;
  const path = join(options.directory ?? DEFAULT_LOG_DIRECTORY, `${id}.jsonl`);
  const header = {
    config,
    seed,
    build: options.build ?? DEFAULT_BUILD,
    protocol: PROTOCOL_VERSION,
    created: new Date((options.now ?? Date.now)()).toISOString(),
  };
  let writable = true;
  open?.add(id);
  try {
    mkdirSync(dirname(path), { recursive: true });
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
      open?.delete(id);
    },
  };
}

export interface SweepOptions {
  readonly directory: string;
  readonly days: number;
  /** The games of this server whose log may still be written. Never deleted. */
  readonly open?: ReadonlySet<string>;
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
 *
 * The limit: the directory must be one that only this server writes to. The
 * check and the delete are two steps, so a file that another process puts in
 * a log's place between them is deleted unprotected.
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
    if (id === undefined || options.open?.has(id)) continue;
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
  try {
    if (deleted > 0) log(`gamelog_sweep deleted=${String(deleted)} directory=${directory}`);
    if (failed > 0)
      log(`gamelog_sweep_error directory=${directory} failed=${String(failed)} code=${code}`);
  } catch {
    // A logger that throws must not reach the server or stop the daily timer.
  }
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
