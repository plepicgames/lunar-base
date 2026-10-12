// The links to the two issue forms (decision 0008): one reports a problem, the
// other suggests a change. They carry only what every seat of a game already
// sees: never a seed, a hand, a session token or a player's name.

/** Set by the build from `LUNAR_BUILD`; absent when no bundler ran, as in the unit tests. */
declare const __LUNAR_BUILD__: string | undefined;

export const BUILD: string = typeof __LUNAR_BUILD__ === "string" ? __LUNAR_BUILD__ : "dev";

const NEW_ISSUE = "https://github.com/plepicgames/lunar-base/issues/new?template=";
const PROBLEM_FORM = "game-problem.yml";
const IDEA_FORM = "feature-request.yml";

/** Which form a link opens. The form sets the label: `game-problem` or `feature-request`. */
export type ReportKind = "problem" | "idea";

/** The query parameters. Each is the `id` of a field in both forms. */
export const REPORT_FIELDS = ["game-id", "turn", "screen", "build", "browser"] as const;
type ReportField = (typeof REPORT_FIELDS)[number];

export type ReportScreen = "name" | "lobby" | "waiting" | "table" | "result";

export interface ReportFacts {
  readonly screen: ReportScreen;
  readonly build: string;
  readonly userAgent: string;
  /** The public game ID of `game.update`. Absent outside a game. */
  readonly game?: string;
  /** The public turn number of the view. Absent outside a game. */
  readonly turn?: number;
}

/** Browsers and proxies accept a URL below this length. */
const MAX_URL = 2000;
const MAX_SHORT_VALUE = 64;

/** Cuts at a code point, so the encoded text is never longer than `budget`. */
function encodeWithin(value: string, budget: number): string {
  let encoded = "";
  for (const character of value.toWellFormed()) {
    const next = encodeURIComponent(character);
    if (encoded.length + next.length > budget) break;
    encoded += next;
  }
  return encoded;
}

function short(value: string): string {
  return encodeURIComponent(Array.from(value.toWellFormed()).slice(0, MAX_SHORT_VALUE).join(""));
}

/** The pre-filled form URL: every value percent-encoded, the whole below 2,000 characters. */
export function reportUrl(facts: ReportFacts, kind: ReportKind = "problem"): string {
  // Only these two file names reach the URL, whatever `kind` holds at run time.
  const form = NEW_ISSUE + (kind === "idea" ? IDEA_FORM : PROBLEM_FORM);
  const pairs: [ReportField, string][] = [];
  if (facts.game !== undefined && facts.game !== "") pairs.push(["game-id", short(facts.game)]);
  if (facts.turn !== undefined && Number.isSafeInteger(facts.turn) && facts.turn > 0)
    pairs.push(["turn", String(facts.turn)]);
  pairs.push(["screen", short(facts.screen)], ["build", short(facts.build)]);
  const head = pairs.reduce((url, [name, value]) => `${url}&${name}=${value}`, form);
  const tail = "&browser=";
  return head + tail + encodeWithin(facts.userAgent, MAX_URL - 1 - head.length - tail.length);
}
