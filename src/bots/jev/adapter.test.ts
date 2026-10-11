import type { Fetch } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import { createGame, viewFor, type DecisionOption } from "../../engine/index.ts";
import { Declined, withFallback } from "../fallback.ts";
import type { DecisionMaker, DecisionRequest } from "../maker.ts";
import { JEV_ATTEMPT_MS, JEV_MODEL, JEV_RETRIES, jevMaker, type JevOptions } from "./adapter.ts";
import { BREAKER_OFF_MS, createBreaker } from "./breaker.ts";

/** A made-up credential. No test sends it anywhere: every `fetch` here is a stub. */
const KEY = "ts-test-credential-9f3a71c2d5e8";

const view = viewFor(createGame({ seats: 2, influences: false, kickstarter: false }, "adapter"), 0);
const offered = ["a", "b", "c"].map((id) => ({ id, label: `Option ${id}` }));

function request(kind = "target", options: DecisionOption[] = offered): DecisionRequest {
  return { seat: 0, events: [], view, decision: { id: "decision", seat: 0, kind, options } };
}

type Reply = (signal: AbortSignal | undefined) => Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    );
}

// Recorded from the response and error shapes of https://docs.typesafe.ai/api (2026-10-10).
// The reference does not give the fields of an error body; the SDK reads `detail`.
/** A 200 whose Choice names `choice`. */
function picks(choice: string, model = "jev-1.13.0"): Reply {
  return json(200, {
    model,
    answers: {
      pick: {
        type: "choice",
        choice,
        confidence: 0.82,
        probabilities: { a: 0.06, b: 0.88, c: 0.06 },
      },
    },
    usage: { input_tokens: 1843, output_tokens: 1 },
  });
}
const unauthorized = json(401, { detail: "Invalid API key" });
const invalid = json(422, {
  detail: [
    { loc: ["body", "questions", "pick", "criteria"], msg: "Field required", type: "missing" },
  ],
});
const limited = json(429, { detail: "Rate limit exceeded" });
const overloaded = json(529, { detail: "Service temporarily overloaded" });
const broken = json(503, { detail: "Service unavailable" });
/** Never answers; like the real `fetch`, it rejects when its signal aborts. */
const hang: Reply = (signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("This operation was aborted", "AbortError"));
    });
  });
const refuse: Reply = () => Promise.reject(new TypeError("fetch failed"));

/** A maker over a stub `fetch` that plays `replies` in order and repeats the last one. */
function jev(replies: Reply[], options: Partial<JevOptions> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const logs: string[] = [];
  const fetch: Fetch = (url, init = {}) => {
    calls.push({ url, init });
    const reply = replies[Math.min(calls.length, replies.length) - 1];
    return reply(init.signal ?? undefined);
  };
  const log = (line: string) => {
    logs.push(line);
    everyLine.push(line);
  };
  const maker = jevMaker({ apiKey: KEY, fetch, log, ...options });
  return { maker, calls, logs };
}

type Outcome = { option?: string; error?: unknown };

/** Starts a decision and lets `ms` of fake time pass; an unsettled decision has neither field. */
async function decide(maker: DecisionMaker, input = request(), ms = 0, signal = caller()) {
  const outcome: Outcome = {};
  void maker.decide(input, signal).then(
    (option) => {
      outcome.option = option;
    },
    (error: unknown) => {
      outcome.error = error;
    },
  );
  await vi.advanceTimersByTimeAsync(ms);
  return outcome;
}

/** The decision failed: Jev was asked and gave no usable answer. */
function expectFailure(outcome: Outcome) {
  expect(outcome.option).toBeUndefined();
  expect(outcome.error).toBeInstanceOf(Error);
  expect(outcome.error).not.toBeInstanceOf(Declined);
}

function expectDeclined(outcome: Outcome, reason: Declined["reason"]) {
  expect(outcome.error).toBeInstanceOf(Declined);
  expect((outcome.error as Declined).reason).toBe(reason);
}

const caller = () => new AbortController().signal;
/** Stands in for the built-in maker. */
const builtin: DecisionMaker = { decide: () => Promise.resolve("a") };

/** With `Math.random` at 0 the SDK waits exactly this long before its retry. */
const BACKOFF_MS = 500;

const everyLine: string[] = [];
const consoles = ["debug", "info", "log", "warn", "error"] as const;
let spies: MockInstance[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  // The SDK must stay silent even when its environment asks for request logs.
  vi.stubEnv("TYPESAFE_LOG_LEVEL", "debug");
  spies = consoles.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  everyLine.length = 0;
});

afterEach(() => {
  // Every case: the adapter's log holds neither the credential nor a header,
  // and nothing reaches the console past the caller's log.
  for (const line of everyLine) {
    expect(line).not.toContain(KEY);
    expect(line).not.toMatch(/authorization|bearer/i);
  }
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("the limits are 4 s per attempt, 1 retry and the model jev-latest", () => {
  expect(JEV_ATTEMPT_MS).toBe(4_000);
  expect(JEV_RETRIES).toBe(1);
  expect(JEV_MODEL).toBe("jev-latest");
});

test("a valid answer returns that option id and the log names the model id from the response", async () => {
  const { maker, calls, logs } = jev([picks("b", "jev-1.13.0")]);
  expect(await maker.decide(request("draft"), caller())).toBe("b");
  expect(calls).toHaveLength(1);
  expect(logs).toEqual(["jev decision=draft model=jev-1.13.0"]);
  // No timer of the attempt outlives the decision.
  expect(vi.getTimerCount()).toBe(0);
});

test("one POST to /v1/systemone carries the prompt, the model name and the credential in memory", async () => {
  const { maker, calls } = jev([picks("a")], { model: "jev-1.12.0" });
  await maker.decide(request(), caller());
  const [{ url, init }] = calls;
  expect(url).toBe("https://api.typesafe.ai/v1/systemone");
  expect(init.method).toBe("POST");
  expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
  const body = JSON.parse(init.body as string) as {
    model: string;
    state: { decision: string };
    questions: { pick: { type: string; criteria: Record<string, string> } };
  };
  expect(body.model).toBe("jev-1.12.0");
  expect(body.state.decision).toContain("Choose the player");
  expect(body.questions.pick.type).toBe("choice");
  expect(body.questions.pick.criteria).toEqual({ a: "Option a", b: "Option b", c: "Option c" });
});

test("the model is jev-latest unless the caller names another", async () => {
  const { maker, calls } = jev([picks("a")]);
  await maker.decide(request(), caller());
  expect((JSON.parse(calls[0].init.body as string) as { model: string }).model).toBe("jev-latest");
});

test("the environment cannot send the credential to another host or change the model", async () => {
  vi.stubEnv("TYPESAFE_BASE_URL", "https://example.com");
  vi.stubEnv("TYPESAFE_DEFAULT_MODEL", "other-model");
  const { maker, calls } = jev([picks("a")]);
  await maker.decide(request(), caller());
  expect(calls[0].url).toBe("https://api.typesafe.ai/v1/systemone");
  expect((JSON.parse(calls[0].init.body as string) as { model: string }).model).toBe("jev-latest");
});

test("an empty credential builds no adapter", () => {
  expect(() => jevMaker({ apiKey: "  ", fetch: () => refuse(undefined) })).toThrow(/credential/);
});

test("behind the fallback wrapper a valid answer is labelled jev", async () => {
  const { maker } = jev([picks("c")]);
  const decided = await withFallback(maker, builtin).decideBy(request(), caller());
  expect(decided).toEqual({ option: "c", by: "jev" });
});

test("timeout: an attempt is given up after 4 s, retried once, then the decision fails", async () => {
  const { maker, calls, logs } = jev([hang]);
  const outcome = await decide(maker, request(), JEV_ATTEMPT_MS - 1);
  expect(calls).toHaveLength(1);
  expect(calls[0].init.signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls[0].init.signal?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(BACKOFF_MS);
  expect(calls).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(JEV_ATTEMPT_MS - 1);
  expect(outcome.error).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expectFailure(outcome);
  expect(calls).toHaveLength(2);
  expect(logs).toEqual(["jev decision=target failed=timeout"]);
  expect(vi.getTimerCount()).toBe(0);
});

test("timeout: a retry that answers in time decides", async () => {
  const { maker, calls, logs } = jev([hang, picks("b")]);
  const outcome = await decide(maker, request(), JEV_ATTEMPT_MS + BACKOFF_MS);
  expect(outcome.option).toBe("b");
  expect(calls).toHaveLength(2);
  expect(logs).toEqual(["jev decision=target model=jev-1.13.0"]);
});

test("connection error: retried once, then the decision fails", async () => {
  const { maker, calls, logs } = jev([refuse]);
  const outcome = await decide(maker, request(), BACKOFF_MS);
  expectFailure(outcome);
  expect(calls).toHaveLength(2);
  expect(logs).toEqual(["jev decision=target failed=connection"]);
});

test.each([
  ["429", limited, "status_429"],
  ["529", overloaded, "status_529"],
  ["5xx", broken, "status_503"],
])("%s: retried once, then the decision fails", async (_row, reply, reason) => {
  const { maker, calls, logs } = jev([reply]);
  const outcome = await decide(maker, request(), BACKOFF_MS - 1);
  expect(calls).toHaveLength(1);
  expect(outcome.error).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expectFailure(outcome);
  expect(calls).toHaveLength(2);
  expect(logs).toEqual([`jev decision=target failed=${reason}`]);
});

test.each([
  ["429", limited],
  ["529", overloaded],
  ["5xx", broken],
])("%s then a valid answer: the retry decides", async (_row, reply) => {
  const { maker, calls } = jev([reply, picks("c")]);
  const outcome = await decide(maker, request(), BACKOFF_MS);
  expect(outcome.option).toBe("c");
  expect(calls).toHaveLength(2);
});

test.each([
  ["timeout", hang, 2 * JEV_ATTEMPT_MS + BACKOFF_MS],
  ["connection error", refuse, BACKOFF_MS],
  ["429", limited, BACKOFF_MS],
  ["529", overloaded, BACKOFF_MS],
  ["5xx", broken, BACKOFF_MS],
  ["422", invalid, 0],
  ["an answer naming no offered option", picks("z"), 0],
])("%s counts for the breaker: the third in a row turns Jev off", async (_row, reply, ms) => {
  const { maker, calls, logs } = jev([reply]);
  for (let i = 0; i < 3; i += 1) expectFailure(await decide(maker, request(), ms));
  const made = calls.length;
  expectDeclined(await decide(maker), "off");
  expect(calls).toHaveLength(made);
  expect(logs.at(-1)).toBe("jev breaker=open: Jev is off for 60 s");
});

test("401: no retry, no further request, and one log line that does not contain the key", async () => {
  const { maker, calls, logs } = jev([unauthorized, picks("a")]);
  expectFailure(await decide(maker, request("draft")));
  expect(calls).toHaveLength(1);
  expectDeclined(await decide(maker), "off");
  // No pause ends it: Jev stays off until the server restarts.
  await vi.advanceTimersByTimeAsync(10 * BREAKER_OFF_MS);
  expectDeclined(await decide(maker), "off");
  expect(calls).toHaveLength(1);
  expect(logs).toEqual([
    "jev decision=draft failed=status_401: Jev is off until the server restarts",
  ]);
  expect(logs[0]).not.toContain(KEY);
});

test("401: behind the fallback wrapper the built-in maker decides, then Jev is off", async () => {
  const { maker } = jev([unauthorized]);
  const both = withFallback(maker, builtin);
  expect(await both.decideBy(request(), caller())).toEqual({
    option: "a",
    by: "builtin-after-jev-failure",
  });
  expect(await both.decideBy(request(), caller())).toEqual({ option: "a", by: "builtin" });
});

test("422: no retry, the decision fails and the log names the decision kind", async () => {
  const { maker, calls, logs } = jev([invalid, picks("a")]);
  expectFailure(await decide(maker, request("steal_module")));
  expect(calls).toHaveLength(1);
  expect(logs).toEqual(["jev decision=steal_module failed=status_422"]);
});

test("an answer naming no offered option fails and the log names the decision kind", async () => {
  const { maker, calls, logs } = jev([picks("z")]);
  expectFailure(await decide(maker, request("flip")));
  expect(calls).toHaveLength(1);
  expect(logs).toEqual(["jev decision=flip model=jev-1.13.0 failed=invalid_answer"]);
});

test("an answer naming an offered option that narrowing did not send fails", async () => {
  const placements = Array.from({ length: 299 }, (_, i) => ({
    id: `placement-${String(i)}`,
    label: `Placement ${String(i)}`,
    card: "module",
    x: i * 2,
    y: 0,
    q: 0,
    price: 299 - i,
  }));
  const input = request("build", [...placements, { id: "skip", label: "Skip Build" }]);
  input.view = { ...view, hand: [{ instance: "module", cardId: "mod-inflatable-habitat" }] };
  const { maker, calls } = jev([picks("placement-0"), picks("placement-298")]);
  expectFailure(await decide(maker, input));
  const sent = JSON.parse(calls[0].init.body as string) as {
    questions: { pick: { criteria: Record<string, string> } };
  };
  expect(Object.keys(sent.questions.pick.criteria)).toHaveLength(60);
  expect(sent.questions.pick.criteria).not.toHaveProperty("placement-0");
  expect((await decide(maker, input)).option).toBe("placement-298");
});

test.each([
  ["no answers", { model: "jev-1.13.0", usage: { input_tokens: 9, output_tokens: 1 } }],
  ["no model", { answers: { pick: { type: "choice", choice: "a" } } }],
  ["a choice that is no string", { model: "jev-1.13.0", answers: { pick: { choice: 1 } } }],
  ["text", "ok"],
])("a 200 with %s fails as an invalid answer", async (_name, body) => {
  const { maker, logs } = jev([json(200, body)]);
  expectFailure(await decide(maker));
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("decision=target");
  expect(logs[0]).toContain("failed=invalid_answer");
});

test("a model id that is no plain name is not copied into the log", async () => {
  const { maker, logs } = jev([picks("a", "jev-1\nseat=0 decision=x by=jev")]);
  expect((await decide(maker)).option).toBe("a");
  expect(logs).toEqual(["jev decision=target model=unknown"]);
});

test.each([
  ["the credential", KEY],
  ["the credential inside a longer name", `jev-${KEY}.1`],
  ["the credential in another letter case", KEY.toUpperCase()],
  ["the header's name", "Authorization"],
  ["the header's name in small letters", "proxy-authorization"],
  ["the header's scheme", "Bearer"],
  ["the name of a key header", "x-api-key"],
])("a model id that is %s is not copied into the log or the error", async (_name, model) => {
  const valid = jev([picks("a", model)]);
  expect((await decide(valid.maker)).option).toBe("a");
  expect(valid.logs).toEqual(["jev decision=target model=unknown"]);

  const unoffered = jev([picks("z", model)]);
  const outcome = await decide(unoffered.maker);
  expectFailure(outcome);
  expect(unoffered.logs).toEqual(["jev decision=target model=unknown failed=invalid_answer"]);
  expect((outcome.error as Error).message).toBe(
    "Jev gave no answer: model=unknown failed=invalid_answer",
  );
});

test("a credential given with spaces around it is still kept out of the log", async () => {
  const { maker, logs } = jev([picks("a", KEY)], { apiKey: ` ${KEY} ` });
  expect((await decide(maker)).option).toBe("a");
  expect(logs).toEqual(["jev decision=target model=unknown"]);
});

test("a model id that only resembles the credential is logged", async () => {
  const { maker, logs } = jev([picks("a", KEY.slice(0, -1))]);
  expect((await decide(maker)).option).toBe("a");
  expect(logs).toEqual([`jev decision=target model=${KEY.slice(0, -1)}`]);
});

test("budget used up: the request is aborted at 8 s and the built-in maker decides", async () => {
  const { maker, calls, logs } = jev([hang]);
  let decided: unknown;
  void withFallback(maker, builtin)
    .decideBy(request(), caller())
    .then((value) => {
      decided = value;
    });
  // 4 s for the first attempt and 0.5 s of backoff: the retry is in flight.
  await vi.advanceTimersByTimeAsync(7_999);
  expect(calls).toHaveLength(2);
  expect(calls[1].init.signal?.aborted).toBe(false);
  expect(decided).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(calls[1].init.signal?.aborted).toBe(true);
  expect(decided).toEqual({ option: "a", by: "builtin-after-jev-failure" });
  expect(logs).toEqual(["jev decision=target failed=aborted"]);
  // Nothing of the SDK goes on after the abort: no timer and no further request.
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(JEV_ATTEMPT_MS);
  expect(calls).toHaveLength(2);
});

test("budget used up: the retry is not made when the budget ends during the backoff", async () => {
  const { maker, calls, logs } = jev([limited]);
  const answer = withFallback(maker, builtin, { budgetMs: BACKOFF_MS - 1 }).decideBy(
    request(),
    caller(),
  );
  await vi.advanceTimersByTimeAsync(BACKOFF_MS - 1);
  expect(await answer).toEqual({ option: "a", by: "builtin-after-jev-failure" });
  expect(logs).toEqual(["jev decision=target failed=aborted"]);
  await vi.advanceTimersByTimeAsync(JEV_ATTEMPT_MS);
  expect(calls).toHaveLength(1);
});

test("budget used up counts for the breaker: a Jev that hangs is turned off", async () => {
  const { maker, calls } = jev([hang]);
  const both = withFallback(maker, builtin);
  for (let i = 0; i < 3; i += 1) {
    const answer = both.decideBy(request(), caller());
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await answer).by).toBe("builtin-after-jev-failure");
  }
  expect(calls).toHaveLength(6);
  expect(await both.decideBy(request(), caller())).toEqual({ option: "a", by: "builtin" });
  expect(calls).toHaveLength(6);
});

test("a decision that is already aborted makes no request and is no failure of Jev", async () => {
  const { maker, calls, logs } = jev([picks("a")]);
  for (let i = 0; i < 3; i += 1) {
    expectFailure(await decide(maker, request(), 0, AbortSignal.abort()));
  }
  expect(calls).toHaveLength(0);
  expect(logs).toEqual([]);
  expect((await decide(maker)).option).toBe("a");
});

test("more than 255 options: no request, the built-in maker decides, no count for the breaker", async () => {
  const many = Array.from({ length: 256 }, (_, i) => ({ id: `card-${String(i)}`, label: "Card" }));
  const { maker, calls, logs } = jev([picks("a")]);
  for (let i = 0; i < 3; i += 1) {
    expectDeclined(await decide(maker, request("discard", many)), "too-many-options");
  }
  expect(await withFallback(maker, builtin).decideBy(request("discard", many), caller())).toEqual({
    option: "a",
    by: "builtin-too-many-options",
  });
  expect(calls).toHaveLength(0);
  expect(logs).toEqual([]);
  // The breaker is still closed: the next decision is sent.
  expect((await decide(maker)).option).toBe("a");
  expect(calls).toHaveLength(1);
});

test("255 options are sent whole", async () => {
  const many = Array.from({ length: 255 }, (_, i) => ({ id: `card-${String(i)}`, label: "Card" }));
  const { maker, calls } = jev([picks("card-254")]);
  expect((await decide(maker, request("discard", many))).option).toBe("card-254");
  expect(calls).toHaveLength(1);
});

test("three failed decisions open the breaker, the fourth makes no request, and after 60 s one request is made", async () => {
  const { maker, calls, logs } = jev([broken]);
  const both = withFallback(maker, builtin);
  for (let i = 0; i < 3; i += 1) {
    const answer = both.decideBy(request(), caller());
    await vi.advanceTimersByTimeAsync(BACKOFF_MS);
    expect((await answer).by).toBe("builtin-after-jev-failure");
  }
  expect(calls).toHaveLength(6);
  expect(logs).toEqual([
    "jev decision=target failed=status_503",
    "jev decision=target failed=status_503",
    "jev decision=target failed=status_503",
    "jev breaker=open: Jev is off for 60 s",
  ]);

  expect(await both.decideBy(request(), caller())).toEqual({ option: "a", by: "builtin" });
  await vi.advanceTimersByTimeAsync(BREAKER_OFF_MS - 1);
  expect(await both.decideBy(request(), caller())).toEqual({ option: "a", by: "builtin" });
  expect(calls).toHaveLength(6);
  // A refused decision writes no line.
  expect(logs).toHaveLength(4);

  await vi.advanceTimersByTimeAsync(1);
  // Two decisions at once: one is the trial, the other does not wait for it.
  const trial = decide(maker);
  const other = decide(maker);
  expectDeclined(await other, "off");
  await vi.advanceTimersByTimeAsync(BACKOFF_MS);
  expectFailure(await trial);
  // One request and the SDK's one retry of it.
  expect(calls).toHaveLength(8);
  // The failed trial turns Jev off for another 60 s.
  expectDeclined(await decide(maker), "off");
  expect(calls).toHaveLength(8);
});

test("a trial that succeeds turns Jev on again", async () => {
  const { maker, calls } = jev([invalid, invalid, invalid, picks("b")]);
  for (let i = 0; i < 3; i += 1) expectFailure(await decide(maker));
  expectDeclined(await decide(maker), "off");
  await vi.advanceTimersByTimeAsync(BREAKER_OFF_MS);
  expect((await decide(maker)).option).toBe("b");
  expect((await decide(maker)).option).toBe("b");
  expect(calls).toHaveLength(5);
});

test("a success between failures starts the breaker's count again", async () => {
  const { maker, calls } = jev([invalid, invalid, picks("a"), invalid, invalid, picks("a")]);
  for (let i = 0; i < 6; i += 1) await decide(maker);
  expect(calls).toHaveLength(6);
});

test("a late success of an earlier decision does not end the breaker's pause", async () => {
  let answer: (response: Response) => void = () => {};
  const slow: Reply = () =>
    new Promise((resolve) => {
      answer = resolve;
    });
  const { maker, calls } = jev([slow, invalid, invalid, invalid, picks("b")]);
  // Still in flight while three other decisions fail and open the breaker.
  const early = await decide(maker);
  for (let i = 0; i < 3; i += 1) expectFailure(await decide(maker));
  expect(calls).toHaveLength(4);

  answer(await picks("a")(undefined));
  await vi.advanceTimersByTimeAsync(0);
  expect(early.option).toBe("a");
  expectDeclined(await decide(maker), "off");
  await vi.advanceTimersByTimeAsync(BREAKER_OFF_MS - 1);
  expectDeclined(await decide(maker), "off");
  expect(calls).toHaveLength(4);

  // The pause ends when it was due and the trial turns Jev on again.
  await vi.advanceTimersByTimeAsync(1);
  expect((await decide(maker)).option).toBe("b");
  expect((await decide(maker)).option).toBe("b");
  expect(calls).toHaveLength(6);
});

test("makers that share a breaker go off together", async () => {
  const breaker = createBreaker();
  const first = jev([invalid], { breaker });
  const second = jev([picks("a")], { breaker });
  for (let i = 0; i < 3; i += 1) expectFailure(await decide(first.maker));
  expectDeclined(await decide(second.maker), "off");
  expect(second.calls).toHaveLength(0);
});

test("the log of every case holds neither the credential nor the word Authorization", async () => {
  // A service and a network that repeat the request's secrets back.
  const echo = `Authorization: Bearer ${KEY}`;
  const leaky: Reply = () => Promise.reject(new TypeError(`fetch failed: ${echo}`));
  const cases: [Reply, number][] = [
    [picks("b"), 0],
    [picks("z"), 0],
    [picks("a", echo), 0],
    // The key and the header's name each alone are plain names.
    [picks("a", KEY), 0],
    [picks("z", KEY), 0],
    [picks("a", "Authorization"), 0],
    [picks("z", "Authorization"), 0],
    [json(200, { detail: echo }), 0],
    [json(422, { detail: echo }), 0],
    [json(429, { detail: echo }, { "x-echo": echo }), BACKOFF_MS],
    [json(529, { detail: echo }), BACKOFF_MS],
    [json(500, { detail: echo }), BACKOFF_MS],
    [leaky, BACKOFF_MS],
    [hang, 2 * JEV_ATTEMPT_MS + BACKOFF_MS],
    [json(401, { detail: echo }), 0],
  ];
  const seen: unknown[] = [];
  for (const [reply, ms] of cases) {
    const { maker } = jev([reply]);
    const outcome = await decide(maker, request(), ms);
    seen.push(outcome.option ?? outcome.error);
    // Three failures and the refusals after them, for the breaker's line.
    for (let i = 0; i < 3; i += 1) await decide(maker, request(), ms);
  }
  const budget = jev([hang]);
  void withFallback(budget.maker, builtin).decideBy(request(), caller());
  await vi.advanceTimersByTimeAsync(8_000);
  const many = Array.from({ length: 256 }, (_, i) => ({ id: `card-${String(i)}`, label: echo }));
  await decide(jev([picks("a")]).maker, request("discard", many));

  expect(seen).toHaveLength(cases.length);
  expect(everyLine.length).toBeGreaterThan(cases.length);
  const output = everyLine.join("\n");
  expect(output).not.toContain(KEY);
  expect(output).not.toMatch(/authorization/i);
  // What the fallback wrapper and the room receive is as clean as the log.
  for (const value of seen) {
    const text = value instanceof Error ? `${value.message} ${String(value.cause)}` : String(value);
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/authorization/i);
  }
});
