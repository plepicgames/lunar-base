// One source for the server limits in the Lobby and Reconnect contracts, and
// the limits that make the server safe to reach without a sign-in: allowed
// origins, the visitor address, and the caps counted per address.
import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";

/** The default of `LUNAR_MAX_GAMES`. */
export const MAX_GAMES = 20;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_HISTORY_EVENTS = 200;
export const MAX_TURNS = 300;
export const TAKEOVER_DELAY_MS = 60_000;
export const PING_INTERVAL_MS = 15_000;
export const FINISHED_GAME_TTL_MS = 10 * 60_000;
export const IDLE_SESSION_TTL_MS = 30 * 60_000;

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;
const PRUNE_INTERVAL_MS = MINUTE_MS;
/** Tags and reasons whose refusals are counted apart; the rest share one line. */
const MAX_REFUSAL_LINES = 1000;

// This module never reads `process.env`. `main` reads the settings once for a
// server and hands them on.
type Environment = Readonly<Record<string, string | undefined>>;
type Headers = Readonly<Record<string, string | string[] | undefined>>;

/** What one server allows a visitor. */
export interface LimitSettings {
  /** The origins a browser may connect from. `null`: the Origin's host must equal the Host. */
  readonly allowedOrigins: readonly string[] | null;
  /** Whether the visitor address is read from the proxy's headers. */
  readonly trustProxy: boolean;
  readonly maxGames: number;
  readonly maxConnectionsPerAddress: number;
  readonly maxNewGamesPerHour: number;
}

export const DEFAULT_LIMITS: LimitSettings = {
  allowedOrigins: null,
  trustProxy: false,
  maxGames: MAX_GAMES,
  maxConnectionsPerAddress: 8,
  maxNewGamesPerHour: 10,
};

/** Reads the five limit settings. Throws on a value that is set and not valid. */
export function limitSettings(env: Environment): LimitSettings {
  const count = (name: string, unset: number): number => {
    const raw = env[name];
    if (raw === undefined) return unset;
    const value = /^[1-9]\d*$/.test(raw.trim()) ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(value))
      throw new Error(`${name} must be a whole number, 1 or more; got "${raw}"`);
    return value;
  };
  const proxy = env.LUNAR_TRUST_PROXY;
  if (proxy !== undefined && proxy !== "true" && proxy !== "false")
    throw new Error(`LUNAR_TRUST_PROXY must be true or false; got "${proxy}"`);
  return {
    allowedOrigins: allowedOrigins(env.LUNAR_ALLOWED_ORIGINS),
    trustProxy: proxy === "true",
    maxGames: count("LUNAR_MAX_GAMES", DEFAULT_LIMITS.maxGames),
    maxConnectionsPerAddress: count(
      "LUNAR_MAX_CONNECTIONS_PER_ADDRESS",
      DEFAULT_LIMITS.maxConnectionsPerAddress,
    ),
    maxNewGamesPerHour: count("LUNAR_MAX_NEW_GAMES_PER_HOUR", DEFAULT_LIMITS.maxNewGamesPerHour),
  };
}

/** The list in `LUNAR_ALLOWED_ORIGINS`, each entry in the form a browser sends. */
function allowedOrigins(raw: string | undefined): readonly string[] | null {
  if (raw === undefined) return null;
  if (!raw.trim())
    throw new Error("LUNAR_ALLOWED_ORIGINS is set and names no origin; unset it or list one");
  return raw.split(",").map((part, index) => {
    const entry = part.trim();
    let url: URL | undefined;
    try {
      url = new URL(entry);
    } catch {
      // Reported below with the others.
    }
    const bare =
      url !== undefined &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      !/[?#@]/.test(entry);
    // The entry is named by its place: its text may hold a credential.
    if (!url || !bare)
      throw new Error(
        `LUNAR_ALLOWED_ORIGINS entry ${String(index + 1)} is not an origin such as https://example.org: http or https, a host, an optional port, and nothing else`,
      );
    return url.origin;
  });
}

/** The startup line. It holds counts only. */
export function describeLimits(settings: LimitSettings): string {
  const origins =
    settings.allowedOrigins === null
      ? "same host"
      : `${String(settings.allowedOrigins.length)} allowed`;
  const games = settings.maxNewGamesPerHour === 1 ? "new game" : "new games";
  return (
    `Limits: origins ${origins}, proxy trust ${settings.trustProxy ? "on" : "off"}, ` +
    `${String(settings.maxGames)} games, ` +
    `${String(settings.maxConnectionsPerAddress)} ${settings.maxConnectionsPerAddress === 1 ? "connection" : "connections"} per address, ` +
    `${String(settings.maxNewGamesPerHour)} ${games} per address per hour`
  );
}

/** A backslash, a space or a control character: none belongs in an origin. */
// eslint-disable-next-line no-control-regex -- control characters are what it looks for
const NOT_IN_AN_ORIGIN = /[\\\s\u0000-\u001f\u007f]/;
/** `http` or `https`, a host and an optional port: what a browser sends as `Origin`. */
const BARE_ORIGIN = /^https?:\/\/[^/?#@]+$/i;

/** The header as a URL when it is a bare origin and nothing else. */
function bareOrigin(header: string | undefined): URL | undefined {
  if (header === undefined || NOT_IN_AN_ORIGIN.test(header) || !BARE_ORIGIN.test(header))
    return undefined;
  try {
    const url = new URL(header);
    const bare =
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/";
    return bare ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether an upgrade with this `Origin` is accepted. The header must be a
 * bare origin: `http` or `https`, a host, an optional port, and no path,
 * query, fragment, credentials, backslash, space or control character. With
 * a list, it must be one of the entries. With none, its host and port must
 * equal the request's `Host`, which may name the scheme's default port.
 */
export function originAllowed(
  allowed: readonly string[] | null,
  origin: string | undefined,
  host: string | undefined,
): boolean {
  const url = bareOrigin(origin);
  if (url === undefined) return false;
  if (allowed !== null) return allowed.includes(url.origin);
  if (host === undefined) return false;
  // `url.host` leaves the default port out; the `Host` header may spell it.
  const defaultPort = url.protocol === "https:" ? ":443" : ":80";
  const named = host.toLowerCase();
  return url.host === (named.endsWith(defaultPort) ? named.slice(0, -defaultPort.length) : named);
}

/** The eight 16-bit groups of an IPv6 address that `isIP` accepted. */
function groupsOf(address: string): number[] {
  let text = address.replace(/%.*$/, "");
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const gap = text.includes("::") ? 8 - left.length - right.length : 0;
  return [...left, ...Array.from({ length: gap }, () => "0"), ...right].map((group) =>
    Number.parseInt(group, 16),
  );
}

/**
 * The name an address is counted under, or `undefined` when the text is no IP
 * address. IPv4 counts as itself, also when it arrives mapped into IPv6
 * (`::ffff:192.0.2.1`). IPv6 counts by its /64 prefix: one network hands a
 * visitor that many addresses.
 */
function addressKey(text: string | undefined): string | undefined {
  const address = text?.trim() ?? "";
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return undefined;
  const groups = groupsOf(address);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/**
 * The visitor address an upgrade is counted under. With proxy trust it is
 * `CF-Connecting-IP`, else the right-most `X-Forwarded-For` entry, each only
 * when it is one valid IP address; else, and always without proxy trust, the
 * socket's address.
 */
export function visitorAddress(
  trustProxy: boolean,
  headers: Headers,
  socketAddress: string | undefined,
): string {
  const one = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : undefined;
  const fromProxy = trustProxy
    ? (addressKey(one(headers["cf-connecting-ip"])) ??
      addressKey(one(headers["x-forwarded-for"])?.split(",").at(-1)))
    : undefined;
  return fromProxy ?? addressKey(socketAddress) ?? "unknown";
}

export interface VisitorLimits {
  /** Takes a connection place for the address. False at the cap. */
  connect(address: string): boolean;
  /** Gives back a place that `connect` granted. */
  disconnect(address: string): void;
  /**
   * Counts a new game for the address. False at the cap, and false for a
   * socket whose address was not recorded: nobody creates a game uncounted.
   */
  newGame(address: string | undefined): boolean;
  /** Forgets every new game older than an hour and writes the refusals counted since a minute. */
  prune(): void;
  /** How many entries are remembered, for the tests of the memory bound. */
  size(): { connections: number; newGames: number; refusals: number };
  /** Stops the prune timer. */
  stop(): void;
}

export interface VisitorLimitsOptions {
  readonly settings: LimitSettings;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

/** The per-address counters of one server. */
export function createVisitorLimits(options: VisitorLimitsOptions): VisitorLimits {
  const { settings } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? console.log;
  const connections = new Map<string, number>();
  /** Per address, when each of its games of the last hour was made, oldest first. */
  const newGames = new Map<string, number[]>();
  // A log line names an address by a tag that cannot be turned back into it:
  // the salt lives in this process only.
  const salt = randomBytes(16);
  const tagOf = (address: string) =>
    createHash("sha256").update(salt).update(address).digest("hex").slice(0, 16);
  /** Per line, when it was last written and the refusals since. At most `MAX_REFUSAL_LINES` + 2. */
  const refusals = new Map<string, { since: number; count: number }>();

  /**
   * Refuses, and keeps a flood out of the log: the first refusal of a tag and
   * reason is written at once, later ones are counted and written as one
   * line a minute.
   */
  function refuse(reason: string, tag: string): false {
    const known = refusals.has(`limit refused=${reason} address=${tag}`);
    const line = `limit refused=${reason} address=${known || refusals.size < MAX_REFUSAL_LINES ? tag : "other"}`;
    const entry = refusals.get(line);
    if (entry === undefined) {
      refusals.set(line, { since: now(), count: 0 });
      log(line);
      return false;
    }
    entry.count += 1;
    if (now() - entry.since >= MINUTE_MS) {
      log(`${line} count=${String(entry.count)}`);
      refusals.set(line, { since: now(), count: 0 });
    }
    return false;
  }

  /** Writes what a quiet line still counted, and forgets every line a minute old. */
  function pruneRefusals(): void {
    for (const [line, entry] of [...refusals]) {
      if (now() - entry.since < MINUTE_MS) continue;
      if (entry.count > 0) log(`${line} count=${String(entry.count)}`);
      refusals.delete(line);
    }
  }

  function recent(address: string): number[] {
    const cutoff = now() - HOUR_MS;
    const times = (newGames.get(address) ?? []).filter((time) => time > cutoff);
    if (times.length > 0) newGames.set(address, times);
    else newGames.delete(address);
    return times;
  }

  function prune(): void {
    for (const address of [...newGames.keys()]) recent(address);
    pruneRefusals();
  }

  const timer = setInterval(prune, PRUNE_INTERVAL_MS);
  // The timer alone must not keep the process alive.
  timer.unref();

  return {
    connect(address) {
      const open = connections.get(address) ?? 0;
      if (open >= settings.maxConnectionsPerAddress) return refuse("connections", tagOf(address));
      connections.set(address, open + 1);
      return true;
    },
    disconnect(address) {
      const open = connections.get(address) ?? 0;
      if (open > 1) connections.set(address, open - 1);
      else connections.delete(address);
    },
    newGame(address) {
      if (address === undefined) return refuse("new_games", "none");
      const times = recent(address);
      if (times.length >= settings.maxNewGamesPerHour) return refuse("new_games", tagOf(address));
      newGames.set(address, [...times, now()]);
      return true;
    },
    prune,
    size: () => ({
      connections: connections.size,
      newGames: newGames.size,
      refusals: refusals.size,
    }),
    stop() {
      clearInterval(timer);
    },
  };
}
