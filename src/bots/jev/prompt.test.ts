import { expect, test } from "vitest";
import {
  createGame,
  eventFor,
  viewFor,
  type DecisionOption,
  type ViewEvent,
} from "../../engine/index.ts";
import { applyChoice, push, run } from "../../engine/loop.ts";
import { gameRegistry } from "../../engine/game.ts";
import { dealGame } from "../../engine/setup.ts";
import { buildState } from "../../engine/testing/build.ts";
import { pushTurn } from "../../engine/turn.ts";
import type { DecisionRequest } from "../maker.ts";
import { narrow } from "./narrow.ts";
import { buildPrompt } from "./prompt.ts";

const skip = { id: "skip", label: "Skip Build" };
function request(kind = "build", options: DecisionOption[] = [skip]): DecisionRequest {
  const view = viewFor(
    createGame({ seats: 2, influences: false, kickstarter: false }, "prompt"),
    0,
  );
  return {
    seat: 0,
    events: [],
    decision: { id: "decision", seat: 0, kind, options },
    view: {
      ...view,
      hand: [{ instance: "habitat", cardId: "mod-inflatable-habitat" }],
      supply: [{ instance: "rover", cardId: "mod-rover-1" }],
      pending: null,
    },
  };
}
function prompt(input: DecisionRequest) {
  const result = buildPrompt(input);
  if (result === "too many") throw new Error("Expected a prompt");
  return result;
}
function options(input: DecisionRequest) {
  const result = narrow(input);
  if (result === "too many") throw new Error("Expected options");
  return result;
}
function recent(count = 12): ViewEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "credits_changed",
    seat: 0,
    delta: 1,
    credits: i + 1,
    text: `Credit event ${String(i)}`,
  }));
}
const seen: ViewEvent = {
  type: "hand_seen",
  looker: 0,
  opponent: 1,
  cards: [{ instance: "seen", cardId: "mod-bacon-printer" }],
  text: "Player 1 looked at Player 2's hand.",
};

// Snapshots cover the complete wire payload, including option labels and private reveals.
test.each([
  [
    "build",
    [
      skip,
      {
        id: "habitat:2:0:0",
        label: "Build Inflatable Habitat at (2, 0), rotation 0, cost 0",
        card: "habitat",
        x: 2,
        y: 0,
        q: 0,
        price: 0,
      },
    ],
  ],
  ["draft", [{ id: "rover", label: "Draft Rover", card: "rover" }]],
  ["target", [{ id: "1", label: "Player 2", target: 1 }]],
] satisfies [string, DecisionOption[]][])("%s prompt snapshot", (kind, offered) => {
  const input = request(kind, offered);
  expect(prompt(input)).toMatchSnapshot();
  expect(prompt(input).questions.pick.criteria).toEqual(
    Object.fromEntries(offered.map((o) => [o.id, o.label])),
  );
});

test("defence-free Spybot.py snapshot includes the hand revealed by the engine", () => {
  const bases = buildState([{ station: "stn-shackleton" }, { station: "stn-shackleton" }]);
  const start = run(
    pushTurn({
      ...dealGame(
        { seats: 2, influences: false, kickstarter: false, startingSeat: 0 },
        "spy-prompt",
      ),
      ...bases,
      cards: {
        ...bases.cards,
        spy: "agt-spybot-py",
        secret: "mod-bacon-printer",
        next: "mod-rover-1",
      },
      hands: [["spy"], ["secret"]],
      credits: [0, 0],
      deck: ["next"],
      supply: [],
      discard: [],
      removedStations: [],
    }),
    gameRegistry,
  );
  if (!start.state.pending) throw new Error("Expected Agent decision");
  const played = applyChoice(
    start.state,
    { seat: 0, decision: start.state.pending.id, option: "spy" },
    gameRegistry,
  );
  if (!played.ok || !played.state.pending) throw new Error("Expected Spybot choice");
  const input: DecisionRequest = {
    seat: 0,
    view: viewFor(played.state, 0),
    decision: played.state.pending,
    events: [...start.events, ...played.events].flatMap((e) => {
      const v = eventFor(e, 0);
      return v ? [v] : [];
    }),
  };
  expect(input.decision.kind).toBe("choose_one");
  const result = prompt(input);
  expect(result).toMatchSnapshot();
  expect(JSON.stringify(result.state.seenHands)).toContain("mod-bacon-printer");
});

test("300 Build options retain skip and each Module's best placement deterministically", () => {
  const offered = Array.from({ length: 299 }, (_, i) => ({
    id: `placement-${String(i)}`,
    label: `Placement ${String(i)}`,
    card: `module-${String(i % 3)}`,
    x: i * 2,
    y: 0,
    q: 0,
    price: 299 - i,
  }));
  const input = request("build", [...offered, skip]);
  input.view = {
    ...input.view,
    hand: [0, 1, 2].map((i) => ({
      instance: `module-${String(i)}`,
      cardId: "mod-inflatable-habitat",
    })),
  };
  const before = structuredClone(input);
  const result = options(input);
  expect(result).toHaveLength(60);
  expect(result.map((o) => o.id)).toEqual([...offered.slice(240).map((o) => o.id), "skip"]);
  expect(new Set(result.filter((o) => o.id !== "skip").map((o) => o.card))).toEqual(
    new Set(["module-0", "module-1", "module-2"]),
  );
  expect(options(input)).toEqual(result);
  expect(input).toEqual(before);
  expect(Object.keys(prompt(input).questions.pick.criteria)).toEqual(result.map((o) => o.id));
});

test("reserves a weak Module's best placement even when another Module has 60 stronger ones", () => {
  const offered = Array.from({ length: 62 }, (_, i) => ({
    id: `p${String(i)}`,
    label: "Build",
    card: "habitat",
    price: 0,
  }));
  const input = request("build", [
    ...offered,
    { id: "weak", label: "Build other", card: "other", price: 20 },
    skip,
  ]);
  input.view = {
    ...input.view,
    hand: [...input.view.hand, { instance: "other", cardId: "mod-inflatable-habitat" }],
  };
  expect(options(input).map((o) => o.id)).toEqual([
    ...offered.slice(0, 58).map((o) => o.id),
    "weak",
    "skip",
  ]);
});

test.each([
  ["flip", 64],
  ["discard", 70],
  ["target", 255],
  ["build", 60],
])("sends %s with %i options whole", (kind, count) => {
  const offered = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    label: `${kind} ${String(i)}`,
    card: `card-${String(i)}`,
    ...(kind === "flip"
      ? { seats: Array.from({ length: 6 }, (_, seat) => seat).filter((seat) => i & (1 << seat)) }
      : {}),
  }));
  const input = request(kind, offered);
  if (kind === "discard")
    input.view = {
      ...input.view,
      hand: offered.map((o) => ({ instance: o.card, cardId: "mod-rover-1" })),
    };
  if (kind === "flip")
    input.view = viewFor(createGame({ seats: 6, influences: false, kickstarter: false }, "six"), 0);
  expect(options(input)).toEqual(offered);
  expect(prompt(input).questions.pick.criteria).toEqual(
    Object.fromEntries(offered.map((o) => [o.id, o.label])),
  );
});

test("a non-Build decision over 255 returns too many without building a request", () => {
  const input = request(
    "discard",
    Array.from({ length: 256 }, (_, i) => ({ id: String(i), label: "Discard" })),
  );
  expect(narrow(input)).toBe("too many");
  expect(buildPrompt(input)).toBe("too many");
});

test("keeps the last ten events and pins only own current-turn hand reveals", () => {
  const input = request();
  input.events = [
    { ...seen, cards: [{ instance: "old", cardId: "mod-rover-1" }] },
    { type: "turn_started", seat: 0, turn: input.view.turn.number, text: "New turn" },
    seen,
    { type: "hand_seen", looker: 1, opponent: 0, text: "Other look" },
    ...recent(),
  ];
  const result = prompt(input);
  expect(result.state.events).toEqual(recent().slice(-10));
  expect(result.state.seenHands).toEqual([seen]);
  input.events = [seen, ...recent()]; // Turn start can fall outside the room's 200-event window.
  expect(prompt(input).state.seenHands).toEqual([seen]);
});

test("trims oldest events to about 6000 tokens without losing a seen hand or options", () => {
  const input = request();
  input.events = [seen, ...recent(10).map((e) => ({ ...e, text: e.text + "x".repeat(4000) }))];
  const before = structuredClone(input);
  const result = prompt(input);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(24_000);
  expect(result.state.events.length).toBeLessThan(10);
  expect(result.state.events.length).toBeGreaterThan(0);
  expect(result.state.events).toEqual(input.events.slice(-result.state.events.length));
  expect(result.state.seenHands).toEqual([seen]);
  expect(result.questions.pick.criteria).toEqual({ skip: "Skip Build" });
  expect(input).toEqual(before);
});

test("prompt contains no hidden hand identities or seed/rng keys", () => {
  const state = createGame({ seats: 2, influences: false, kickstarter: false }, "secret-seed");
  const input = request();
  input.view = viewFor(state, 0);
  const result = prompt(input);
  const json = JSON.stringify(result);
  for (const instance of state.hands[1]) expect(json).not.toContain(instance);
  expect(json).not.toContain('"seed":');
  expect(json).not.toContain('"rng":');
  const changed = { ...state, hands: [state.hands[0], [...state.hands[1]].reverse()] };
  expect(prompt({ ...input, view: viewFor(changed, 0) })).toEqual(result);
  input.events = [seen];
  expect(JSON.stringify(prompt(input))).toContain('"instance":"seen"');
});

test.each([
  [60, 61],
  [255, "too many"],
] as const)("preserves %i distinct Modules beyond the Build target", (count, expected) => {
  const input = request("build", [
    skip,
    ...Array.from({ length: count }, (_, i) => ({
      id: `p${String(i)}`,
      label: "Build",
      card: `module-${String(i)}`,
    })),
  ]);
  if (expected === "too many") {
    expect(narrow(input)).toBe("too many");
    expect(buildPrompt(input)).toBe("too many");
  } else {
    expect(options(input)).toHaveLength(expected);
    expect(options(input)).toEqual(input.decision.options);
  }
});

test("keeps required data when the size target cannot be met by trimming events", () => {
  const input = request("discard", [{ id: "large", label: "x".repeat(24_000) }]);
  input.events = [seen, ...recent()];
  const result = prompt(input);
  expect(result.state.events).toEqual([]);
  expect(result.state.seenHands).toEqual([seen]);
  expect(result.questions.pick.criteria.large).toBe(input.decision.options[0].label);
});

test("D12 defence prompt includes Influence rules and the threatened public action", () => {
  const dealt = dealGame(
    { seats: 2, influences: true, kickstarter: false, startingSeat: 0 },
    "defence-prompt",
  );
  const start = run(
    push(
      {
        ...dealt,
        cards: { ...dealt.cards, agent: "agt-panaman-broker", shield: "inf-lunar-alliance" },
        hands: [[], ["shield"]],
        credits: [19, 1],
        supply: [],
        play: ["agent"],
      },
      "agent",
      {
        seat: 0,
        card: "agent",
        actions: [{ op: "steal_credits", n: 3 }],
        position: 0,
        repeated: 0,
        deferred: [],
      },
    ),
    gameRegistry,
  );
  if (!start.state.pending) throw new Error("Expected target choice");
  const waiting = start;
  if (!waiting.state.pending) throw new Error("Expected defence choice");
  const result = prompt({
    view: viewFor(waiting.state, 1),
    seat: 1,
    decision: waiting.state.pending,
    events: [],
  });
  expect(waiting.state.pending.kind).toBe("defence");
  expect(result.state.rules).toContain("4 Influences");
  expect(result.state.decision).toContain("steal_credits");
  expect(result).toMatchSnapshot();
});

test("Kickstarter prompt carries public pile information and Kafka instructions", () => {
  const input = request("exchange_station", [
    { id: "1", label: "Exchange with Player 2's Station", target: 1 },
  ]);
  input.view = {
    ...input.view,
    config: { ...input.view.config, influences: true, kickstarter: true },
    deckTop: { instance: "top", cardId: "mod-rover-1" },
    discard: [],
    discardCount: 7,
  };
  const result = prompt(input);
  expect(result.state.piles).toMatchObject({ deckTop: input.view.deckTop, discardCount: 7 });
  expect(result.state.decision).toContain("Kafka");
  expect(result).toMatchSnapshot();
});
