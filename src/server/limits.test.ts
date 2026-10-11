import { expect, test } from "vitest";
import {
  createVisitorLimits,
  DEFAULT_LIMITS,
  describeJev,
  describeLimits,
  jevBudgetSetting,
  limitSettings,
  originAllowed,
  visitorAddress,
} from "./limits.ts";

const HOUR = 60 * 60 * 1000;

test("with nothing set the limits are the defaults", () => {
  expect(limitSettings({})).toEqual({
    allowedOrigins: null,
    trustProxy: false,
    maxGames: 20,
    maxConnectionsPerAddress: 8,
    maxNewGamesPerHour: 10,
  });
  expect(describeLimits(DEFAULT_LIMITS)).toBe(
    "Limits: origins same host, proxy trust off, 20 games, 8 connections per address, 10 new games per address per hour",
  );
});

test("every setting is read", () => {
  const settings = limitSettings({
    LUNAR_ALLOWED_ORIGINS:
      "https://Example.org/, http://localhost:4780 ,HTTPS://www.example.org:443",
    LUNAR_TRUST_PROXY: "true",
    LUNAR_MAX_GAMES: "3",
    LUNAR_MAX_CONNECTIONS_PER_ADDRESS: "2",
    LUNAR_MAX_NEW_GAMES_PER_HOUR: "1",
  });
  expect(settings).toEqual({
    allowedOrigins: ["https://example.org", "http://localhost:4780", "https://www.example.org"],
    trustProxy: true,
    maxGames: 3,
    maxConnectionsPerAddress: 2,
    maxNewGamesPerHour: 1,
  });
  expect(describeLimits(settings)).toBe(
    "Limits: origins 3 allowed, proxy trust on, 3 games, 2 connections per address, 1 new game per address per hour",
  );
});

test.each([
  ["LUNAR_ALLOWED_ORIGINS", ""],
  ["LUNAR_ALLOWED_ORIGINS", "  "],
  ["LUNAR_ALLOWED_ORIGINS", "https://example.org,"],
  ["LUNAR_ALLOWED_ORIGINS", "example.org"],
  ["LUNAR_ALLOWED_ORIGINS", "https://example.org/play"],
  ["LUNAR_ALLOWED_ORIGINS", "https://example.org/?a=1"],
  ["LUNAR_ALLOWED_ORIGINS", "https://example.org?"],
  ["LUNAR_ALLOWED_ORIGINS", "https://example.org/#top"],
  ["LUNAR_ALLOWED_ORIGINS", "https://user:secret@example.org"],
  ["LUNAR_ALLOWED_ORIGINS", "https://user@example.org"],
  ["LUNAR_ALLOWED_ORIGINS", "ws://example.org"],
  ["LUNAR_ALLOWED_ORIGINS", "file:///tmp"],
  ["LUNAR_ALLOWED_ORIGINS", "*"],
  ["LUNAR_TRUST_PROXY", ""],
  ["LUNAR_TRUST_PROXY", "1"],
  ["LUNAR_TRUST_PROXY", "TRUE"],
  ["LUNAR_TRUST_PROXY", "yes"],
  ["LUNAR_MAX_GAMES", "0"],
  ["LUNAR_MAX_GAMES", ""],
  ["LUNAR_MAX_GAMES", "-1"],
  ["LUNAR_MAX_GAMES", "1.5"],
  ["LUNAR_MAX_GAMES", "ten"],
  ["LUNAR_MAX_GAMES", "1e3"],
  ["LUNAR_MAX_GAMES", "99999999999999999999"],
  ["LUNAR_MAX_CONNECTIONS_PER_ADDRESS", "0"],
  ["LUNAR_MAX_CONNECTIONS_PER_ADDRESS", "many"],
  ["LUNAR_MAX_NEW_GAMES_PER_HOUR", "0"],
  ["LUNAR_MAX_NEW_GAMES_PER_HOUR", "0x10"],
])("%s=%j stops the start with an error that names the setting", (name, value) => {
  expect(() => limitSettings({ [name]: value })).toThrow(name);
});

test.each([
  [undefined, 2000],
  ["0", 0],
  ["1", 1],
  ["2000", 2000],
  [" 5 ", 5],
])("LUNAR_JEV_MAX_DECISIONS_PER_HOUR=%j allows %i Jev decisions an hour", (value, expected) => {
  expect(jevBudgetSetting({ LUNAR_JEV_MAX_DECISIONS_PER_HOUR: value })).toBe(expected);
});

test.each(["-1", "1.5", "abc", "", "   ", "1e3", "0x10", "00", "99999999999999999999"])(
  "LUNAR_JEV_MAX_DECISIONS_PER_HOUR=%j stops the start with an error that names the setting",
  (value) => {
    expect(() => jevBudgetSetting({ LUNAR_JEV_MAX_DECISIONS_PER_HOUR: value })).toThrow(
      `LUNAR_JEV_MAX_DECISIONS_PER_HOUR must be a whole number, 0 or more; got "${value}"`,
    );
  },
);

test.each([
  [false, 2000, "Jev is off"],
  [false, 0, "Jev is off"],
  [true, 2000, "Jev is on, at most 2000 decisions per hour"],
  [true, 1, "Jev is on, at most 1 decision per hour"],
  [true, 0, "Jev is off because the budget is 0 decisions per hour"],
])("the startup line for credential %j and budget %i is %j", (credential, budget, line) => {
  expect(describeJev(credential, budget)).toBe(line);
});

test("a refused origin is named by its place, so a credential in it is not repeated", () => {
  const read = () =>
    limitSettings({ LUNAR_ALLOWED_ORIGINS: "https://a.example,https://user:pass@b.example" });
  expect(read).toThrow("entry 2");
  expect(read).not.toThrow("pass");
});

const listed = ["https://example.org", "http://localhost:4780"];

test.each([
  ["exact match", "https://example.org", true],
  ["scheme and host in another case", "HTTPS://Example.ORG", true],
  ["the default port written out", "https://example.org:443", true],
  ["second entry", "http://localhost:4780", true],
  ["wrong scheme", "http://example.org", false],
  ["wrong port", "https://example.org:8443", false],
  ["wrong port of the second entry", "http://localhost:4781", false],
  ["another host", "https://www.example.org", false],
  ["a host that only starts the same", "https://example.org.evil.example", false],
  ["extra path", "https://example.org/play", false],
  ["trailing slash", "https://example.org/", false],
  ["a query", "https://example.org?x", false],
  ["credentials", "https://user@example.org", false],
  ["the opaque origin", "null", false],
  ["a fragment", "https://example.org#top", false],
  ["a backslash", "https://example.org\\", false],
  ["a backslash before another host", "https://example.org\\@evil.example", false],
  ["a space inside", "https://example .org", false],
  ["a space after", "https://example.org ", false],
  ["a tab", "https://example.org\t", false],
  ["a line break", "https://example.org\r\nX: y", false],
  ["a control character", "https://example.org\u0000", false],
  ["a password", "https://user:pass@example.org", false],
  ["another scheme", "wss://example.org", false],
  ["a scheme with no host", "https://", false],
  ["garbage", "not an origin", false],
  ["empty", "", false],
  ["missing", undefined, false],
])("with a list, %s is %s", (_name, origin, allowed) => {
  // The request's own Host is no pass: only the list counts.
  expect(originAllowed(listed, origin, "example.org.evil.example")).toBe(allowed);
});

test.each([
  ["http://127.0.0.1:4780", "127.0.0.1:4780", true],
  ["http://LOCALHOST:4780", "localhost:4780", true],
  ["https://example.org", "example.org", true],
  ["https://example.org", "EXAMPLE.org:443", true],
  ["https://example.org:443", "example.org", true],
  ["http://example.org", "example.org:80", true],
  ["http://example.org:80", "example.org", true],
  ["http://[2001:db8::1]:4780", "[2001:db8::1]:4780", true],
  ["https://[2001:db8::80]", "[2001:db8::80]", true],
  // The default port of the other scheme is a different port.
  ["https://example.org", "example.org:80", false],
  ["http://example.org", "example.org:443", false],
  ["https://example.org", "example.org:8443", false],
  ["http://elsewhere.example", "127.0.0.1:4780", false],
  ["http://127.0.0.1:4781", "127.0.0.1:4780", false],
  ["http://127.0.0.1:4780/", "127.0.0.1:4780", false],
  ["http://127.0.0.1:4780/play", "127.0.0.1:4780", false],
  ["http://127.0.0.1:4780?x", "127.0.0.1:4780", false],
  ["http://127.0.0.1:4780#x", "127.0.0.1:4780", false],
  ["http://user@127.0.0.1:4780", "127.0.0.1:4780", false],
  ["http://elsewhere.example\\@127.0.0.1:4780", "127.0.0.1:4780", false],
  ["http://127.0.0.1:4780\\", "127.0.0.1:4780", false],
  [" http://127.0.0.1:4780", "127.0.0.1:4780", false],
  ["http://127.0.0.1:4780\n", "127.0.0.1:4780", false],
  ["ws://127.0.0.1:4780", "127.0.0.1:4780", false],
  ["ftp://127.0.0.1:4780", "127.0.0.1:4780", false],
  ["null", "null", false],
  ["nonsense", "127.0.0.1:4780", false],
  ["", "", false],
  [undefined, "127.0.0.1:4780", false],
  ["http://127.0.0.1:4780", undefined, false],
])("with no list, Origin %j and Host %j give %s", (origin, host, allowed) => {
  expect(originAllowed(null, origin, host)).toBe(allowed);
});

test.each([
  ["192.0.2.7", "192.0.2.7"],
  ["::ffff:192.0.2.7", "192.0.2.7"],
  ["::FFFF:c000:207", "192.0.2.7"],
  ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
  ["2001:db8:1:2::9", "2001:db8:1:2::/64"],
  ["2001:DB8:0001:0002:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"],
  ["2001:db8:1:3::9", "2001:db8:1:3::/64"],
  ["2001:db8::1", "2001:db8:0:0::/64"],
  ["::1", "0:0:0:0::/64"],
  ["fe80::1%eth0", "fe80:0:0:0::/64"],
  [undefined, "unknown"],
])("the socket address %j counts as %s", (socket, key) => {
  expect(visitorAddress(false, {}, socket)).toBe(key);
});

test("without proxy trust the headers are ignored", () => {
  const headers = { "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2" };
  expect(visitorAddress(false, headers, "198.51.100.9")).toBe("198.51.100.9");
});

test.each([
  [
    "CF-Connecting-IP first",
    { "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2" },
    "192.0.2.1",
  ],
  ["CF-Connecting-IP with spaces", { "cf-connecting-ip": " 192.0.2.1 " }, "192.0.2.1"],
  ["a mapped IPv4", { "cf-connecting-ip": "::ffff:192.0.2.1" }, "192.0.2.1"],
  ["an IPv6 by its /64", { "cf-connecting-ip": "2001:db8:a:b:1:2:3:4" }, "2001:db8:a:b::/64"],
  ["the right-most X-Forwarded-For", { "x-forwarded-for": "192.0.2.66, 192.0.2.2" }, "192.0.2.2"],
  [
    "X-Forwarded-For when CF-Connecting-IP is garbage",
    { "cf-connecting-ip": "<script>", "x-forwarded-for": "192.0.2.2" },
    "192.0.2.2",
  ],
  [
    "X-Forwarded-For when CF-Connecting-IP is sent twice",
    { "cf-connecting-ip": "192.0.2.1, 192.0.2.3", "x-forwarded-for": "192.0.2.2" },
    "192.0.2.2",
  ],
  [
    "the socket when both are garbage",
    { "cf-connecting-ip": "1.2.3", "x-forwarded-for": "192.0.2.2, x" },
    "198.51.100.9",
  ],
  ["the socket when the last entry is empty", { "x-forwarded-for": "192.0.2.2," }, "198.51.100.9"],
  ["the socket when a port is attached", { "cf-connecting-ip": "192.0.2.1:443" }, "198.51.100.9"],
  ["the socket when there is no header", {}, "198.51.100.9"],
])("with proxy trust the address is %s", (_name, headers, key) => {
  expect(visitorAddress(true, headers, "198.51.100.9")).toBe(key);
});

function limits(overrides: object = {}) {
  const clock = { now: 1_000_000 };
  const lines: string[] = [];
  const visitors = createVisitorLimits({
    settings: { ...DEFAULT_LIMITS, ...overrides },
    now: () => clock.now,
    log: (line) => lines.push(line),
  });
  return { clock, lines, visitors };
}

test("the ninth connection of an address is refused; a closed one frees its place", () => {
  const { visitors, lines } = limits();
  for (let index = 0; index < 8; index++) expect(visitors.connect("192.0.2.1")).toBe(true);
  expect(visitors.connect("192.0.2.1")).toBe(false);
  expect(visitors.connect("192.0.2.2")).toBe(true);
  visitors.disconnect("192.0.2.1");
  expect(visitors.connect("192.0.2.1")).toBe(true);
  expect(visitors.connect("192.0.2.1")).toBe(false);
  // The second refusal of the same address is counted, not written.
  expect(lines).toHaveLength(1);
  visitors.stop();
});

test("an address with no connection left is forgotten", () => {
  const { visitors } = limits();
  visitors.connect("192.0.2.1");
  visitors.connect("192.0.2.1");
  visitors.disconnect("192.0.2.1");
  expect(visitors.size()).toEqual({ connections: 1, newGames: 0, refusals: 0 });
  visitors.disconnect("192.0.2.1");
  visitors.disconnect("192.0.2.1");
  expect(visitors.size()).toEqual({ connections: 0, newGames: 0, refusals: 0 });
  for (let index = 0; index < 8; index++) expect(visitors.connect("192.0.2.1")).toBe(true);
  visitors.stop();
});

test("the eleventh new game in an hour is refused and the hour slides", () => {
  const { visitors, clock } = limits();
  for (let index = 0; index < 10; index++) {
    expect(visitors.newGame("192.0.2.1")).toBe(true);
    clock.now += 60_000;
  }
  expect(visitors.newGame("192.0.2.1")).toBe(false);
  expect(visitors.newGame("192.0.2.2")).toBe(true);
  // The first game was made 10 minutes ago: one millisecond short of an hour is too early.
  clock.now += HOUR - 10 * 60_000 - 1;
  expect(visitors.newGame("192.0.2.1")).toBe(false);
  clock.now += 1;
  expect(visitors.newGame("192.0.2.1")).toBe(true);
  // Only that one place came free.
  expect(visitors.newGame("192.0.2.1")).toBe(false);
  visitors.stop();
});

test("a refused new game does not extend the wait", () => {
  const { visitors, clock } = limits({ maxNewGamesPerHour: 1 });
  expect(visitors.newGame("192.0.2.1")).toBe(true);
  clock.now += HOUR - 1;
  expect(visitors.newGame("192.0.2.1")).toBe(false);
  clock.now += 1;
  expect(visitors.newGame("192.0.2.1")).toBe(true);
  visitors.stop();
});

test("pruning forgets the addresses whose games are an hour old", () => {
  const { visitors, clock } = limits();
  for (let index = 0; index < 50; index++) visitors.newGame(`192.0.2.${String(index)}`);
  clock.now += HOUR / 2;
  visitors.newGame("198.51.100.1");
  expect(visitors.size().newGames).toBe(51);
  clock.now += HOUR / 2;
  visitors.prune();
  expect(visitors.size().newGames).toBe(1);
  visitors.stop();
});

test("a refusal logs the reason and a tag, never the address", () => {
  const { visitors, lines } = limits({ maxConnectionsPerAddress: 1, maxNewGamesPerHour: 1 });
  visitors.connect("192.0.2.1");
  visitors.connect("192.0.2.1");
  visitors.newGame("192.0.2.1");
  visitors.newGame("192.0.2.1");
  visitors.connect("192.0.2.2");
  visitors.connect("192.0.2.2");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toMatch(/^limit refused=connections address=[0-9a-f]{16}$/);
  expect(lines[1]).toMatch(/^limit refused=new_games address=[0-9a-f]{16}$/);
  expect(lines.join("\n")).not.toContain("192.0.2");
  const tag = (line: string) => line.slice(-16);
  expect(tag(lines[1])).toBe(tag(lines[0]));
  expect(tag(lines[2])).not.toBe(tag(lines[0]));
  visitors.stop();
});

test("after the first refusal a tag and reason get one counted line a minute", () => {
  const { visitors, lines, clock } = limits({ maxConnectionsPerAddress: 1 });
  visitors.connect("192.0.2.1");
  for (let index = 0; index < 500; index++) visitors.connect("192.0.2.1");
  expect(lines).toHaveLength(1);
  const first = lines[0];
  clock.now += 59_999;
  visitors.connect("192.0.2.1");
  expect(lines).toHaveLength(1);
  // A minute after the first line: the 501 refusals since then, this one included.
  clock.now += 1;
  visitors.connect("192.0.2.1");
  expect(lines).toEqual([first, `${first} count=501`]);
  for (let index = 0; index < 3; index++) visitors.connect("192.0.2.1");
  expect(lines).toHaveLength(2);
  // Nobody asks again: the timer's pass writes what was counted and forgets the tag.
  clock.now += 60_000;
  visitors.prune();
  expect(lines).toEqual([first, `${first} count=501`, `${first} count=3`]);
  expect(visitors.size().refusals).toBe(0);
  visitors.prune();
  expect(lines).toHaveLength(3);
  // Forgotten, so the next refusal is a first one again.
  visitors.connect("192.0.2.1");
  expect(lines.at(-1)).toBe(first);
  visitors.stop();
});

test("the refusal bookkeeping is bounded: past 1000 tags the rest share one line", () => {
  const { visitors, lines, clock } = limits({ maxNewGamesPerHour: 1 });
  for (let round = 0; round < 2; round++)
    for (let index = 0; index < 1500; index++)
      visitors.newGame(`2001:db8:0:${index.toString(16)}::/64`);
  expect(visitors.size().refusals).toBe(1001);
  expect(lines).toHaveLength(1001);
  expect(lines.at(-1)).toBe("limit refused=new_games address=other");
  clock.now += 60_000;
  visitors.prune();
  expect(lines.at(-1)).toBe("limit refused=new_games address=other count=499");
  expect(visitors.size().refusals).toBe(0);
  visitors.stop();
});

test("a new game from a socket with no recorded address is refused and logged", () => {
  const { visitors, lines } = limits();
  expect(visitors.newGame(undefined)).toBe(false);
  expect(visitors.newGame(undefined)).toBe(false);
  expect(lines).toEqual(["limit refused=new_games address=none"]);
  expect(visitors.size().newGames).toBe(0);
  visitors.stop();
});

test("two limiters share no counter and no tag", () => {
  const first = limits({ maxConnectionsPerAddress: 1 });
  const second = limits({ maxConnectionsPerAddress: 1 });
  expect(first.visitors.connect("192.0.2.1")).toBe(true);
  expect(second.visitors.connect("192.0.2.1")).toBe(true);
  expect(first.visitors.connect("192.0.2.1")).toBe(false);
  expect(second.visitors.connect("192.0.2.1")).toBe(false);
  expect(first.lines[0]).not.toBe(second.lines[0]);
  first.visitors.stop();
  second.visitors.stop();
});
