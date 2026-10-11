import { describe, expect, test } from "vitest";
import { REPORT_FIELDS, reportUrl } from "./report.ts";

const game = "3f2b8c1e-6a4d-4b7e-9c1a-0d5e7f8a9b2c";
const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36";

function query(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("reportUrl", () => {
  test("opens the game-problem form of the game's repository", () => {
    const url = new URL(reportUrl({ screen: "lobby", build: "dev", userAgent }));
    expect(url.origin + url.pathname).toBe("https://github.com/plepicgames/lunar-base/issues/new");
    expect(url.searchParams.get("template")).toBe("game-problem.yml");
  });

  test("at the table it carries the game ID, the turn, the screen, the build and the browser", () => {
    const params = query(reportUrl({ screen: "table", build: "1.4.0", userAgent, game, turn: 7 }));
    expect(Object.fromEntries(params)).toEqual({
      template: "game-problem.yml",
      "game-id": game,
      turn: "7",
      screen: "table",
      build: "1.4.0",
      browser: userAgent,
    });
  });

  test("in the lobby the game fields are left out", () => {
    const params = query(reportUrl({ screen: "lobby", build: "dev", userAgent }));
    expect([...params.keys()]).toEqual(["template", "screen", "build", "browser"]);
  });

  test("every parameter is the template or a declared field", () => {
    const params = query(reportUrl({ screen: "result", build: "dev", userAgent, game, turn: 3 }));
    for (const key of params.keys()) expect(["template", ...REPORT_FIELDS]).toContain(key);
  });

  test("every value is percent-encoded", () => {
    const url = reportUrl({
      screen: "table",
      build: "a b/c?d#e",
      userAgent: "Mozilla/5.0 (Ünï; code) 100%",
      game: "id with space",
      turn: 2,
    });
    const text = url.slice(url.indexOf("?") + 1);
    expect(text).toMatch(/^[A-Za-z0-9\-_.~%=&()!*']+$/);
    expect(text).not.toContain(" ");
    const params = query(url);
    expect(params.get("build")).toBe("a b/c?d#e");
    expect(params.get("browser")).toBe("Mozilla/5.0 (Ünï; code) 100%");
    expect(params.get("game-id")).toBe("id with space");
  });

  test("no value can add a query parameter or a fragment", () => {
    const hostile = "x&title=Injected&labels=agent-ready#body=owned";
    const url = reportUrl({
      screen: "table",
      build: hostile,
      userAgent: hostile,
      game: hostile,
      turn: 1,
    });
    const parsed = new URL(url);
    expect(parsed.hash).toBe("");
    expect([...parsed.searchParams.keys()]).toEqual([
      "template",
      "game-id",
      "turn",
      "screen",
      "build",
      "browser",
    ]);
    expect(parsed.searchParams.get("build")).toBe(hostile);
    expect(parsed.searchParams.has("title")).toBe(false);
    expect(parsed.searchParams.has("labels")).toBe(false);
  });

  test("a very long user agent is cut so the URL stays under 2,000 characters", () => {
    for (const long of ["A".repeat(10_000), "Ü ".repeat(5_000), "🚀".repeat(5_000)]) {
      const url = reportUrl({ screen: "table", build: "dev", userAgent: long, game, turn: 12 });
      expect(url.length).toBeLessThan(2000);
      const browser = query(url).get("browser") ?? "";
      expect(browser.length).toBeGreaterThan(100);
      expect(long.startsWith(browser)).toBe(true);
    }
  });

  test("long game and build values are cut too", () => {
    const url = reportUrl({
      screen: "table",
      build: "b".repeat(5_000),
      userAgent: "u".repeat(5_000),
      game: "g".repeat(5_000),
      turn: 1,
    });
    expect(url.length).toBeLessThan(2000);
    expect(query(url).get("game-id")).toBe("g".repeat(64));
    expect(query(url).get("build")).toBe("b".repeat(64));
  });

  test("a broken surrogate pair does not throw", () => {
    const url = reportUrl({ screen: "lobby", build: "dev", userAgent: "ok\ud83d" });
    expect(query(url).get("browser")).toBe("ok�");
  });

  test("a turn that is not a positive whole number is left out", () => {
    for (const turn of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const params = query(reportUrl({ screen: "table", build: "dev", userAgent, game, turn }));
      expect(params.has("turn")).toBe(false);
    }
  });
});
