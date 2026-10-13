import fc from "fast-check";
import { expect, test } from "vitest";
import {
  createGame,
  eventFor,
  viewFor,
  type DecisionOption,
  type ViewPlayer,
} from "../../engine/index.ts";
import { play, seededPicker } from "../../engine/testing/play.ts";
import { pushAction } from "../../engine/actions/index.ts";
import { gameRegistry } from "../../engine/game.ts";
import { run } from "../../engine/loop.ts";
import { dealGame } from "../../engine/setup.ts";
import type { DecisionRequest } from "../maker.ts";
import { builtinMaker, score } from "./index.ts";

const signal = AbortSignal.abort();
const initial = viewFor(
  createGame({ seats: 2, influences: false, kickstarter: false }, "builtin"),
  0,
);
const skip = { id: "skip", label: "Skip" };
function request(
  kind: string,
  options: DecisionOption[],
  player: Partial<ViewPlayer> = {},
): DecisionRequest {
  return {
    view: {
      ...initial,
      players: initial.players.map((p) => (p.seat === 0 ? { ...p, ...player } : p)),
      hand: [],
      supply: [],
    },
    decision: { id: "test", seat: 0, kind, options },
    seat: 0,
    events: [],
  };
}
function build(card: string, price = 0, orbs = ["blue"]): DecisionOption {
  return { id: card, label: card, card, x: 2, y: 0, q: 0, price, orbs };
}
function hand(input: DecisionRequest, ...cardIds: string[]): DecisionRequest {
  return {
    ...input,
    view: { ...input.view, hand: cardIds.map((cardId) => ({ instance: cardId, cardId })) },
  };
}

test("takes the Build reaching ten colonists over cheaper alternatives and skip", async () => {
  const input = hand(
    request("build", [skip, build("mod-laika-memorial"), build("mod-indigo-egregore", 4)], {
      colonists: 7,
    }),
    "mod-laika-memorial",
    "mod-indigo-egregore",
  );
  expect(await builtinMaker("win", 0).decide(input, signal)).toBe("mod-indigo-egregore");
});

test("builds a fifth distinct achievement even at a price; duplicate icons do not count", async () => {
  const input = hand(
    request("build", [skip, build("mod-satellite-1"), build("mod-rover-1", 1)], {
      achievements: ["dog", "atom", "dome", "satellite"],
    }),
    "mod-satellite-1",
    "mod-rover-1",
  );
  expect(await builtinMaker("achievement", 0).decide(input, signal)).toBe("mod-rover-1");
  const raised = {
    ...input,
    view: { ...input.view, targets: { ...input.view.targets, achievements: 6 } },
  };
  expect(score(input, input.decision.options[2])).toBeGreaterThan(
    score(raised, raised.decision.options[2]),
  );
});

test("values colonists, new achievements, threshold progress, lower prices and needed Orbs", () => {
  const input = hand(
    request("build", [], { colonists: 0 }),
    "mod-inflatable-habitat",
    "mod-rover-1",
    "mod-indigo-egregore",
  );
  const habitat = build("mod-inflatable-habitat");
  expect(score(input, habitat)).toBeGreaterThan(score(input, skip));
  expect(score(input, habitat)).toBeGreaterThan(score(input, { ...habitat, price: 2 }));
  expect(score(input, habitat)).toBeGreaterThan(score(input, { ...habitat, orbs: ["yellow"] }));
  const nearer = {
    ...input,
    view: { ...input.view, players: input.view.players.map((p) => ({ ...p, colonists: 6 })) },
  };
  expect(score(nearer, habitat)).toBeGreaterThan(score(input, habitat));
  const duplicate = {
    ...input,
    view: {
      ...input.view,
      players: input.view.players.map((p) => ({ ...p, achievements: ["rover"] })),
    },
  };
  expect(score(input, build("mod-rover-1"))).toBeGreaterThan(
    score(duplicate, build("mod-rover-1")),
  );
});

function mainRequest(): DecisionRequest {
  const station = {
    instance: "station",
    cardId: "stn-selene-labs",
    side: "named" as const,
    named: "stn-selene-labs",
    revealed: true,
  };
  return hand(
    request(
      "main_action",
      [
        { id: "draw", label: "Draw three", card: "station", box: 2 },
        { id: "build", label: "Build", card: "station", box: 1 },
      ],
      { credits: 0, base: { station, modules: [], orbs: { red: 2, blue: 0, yellow: 0, wild: 0 } } },
    ),
    "mod-inflatable-habitat",
    "mod-indigo-egregore",
  );
}

test("prefers a free legal Build forming a needed Orb to Draw; unavailable Builds have no value", async () => {
  const input = mainRequest();
  expect(await builtinMaker("main", 0).decide(input, signal)).toBe("build");
  const empty = { ...input, view: { ...input.view, hand: [] } };
  expect(await builtinMaker("main", 0).decide(empty, signal)).toBe("draw");
  const unaffordable = hand(empty, "mod-indigo-egregore");
  expect(await builtinMaker("main", 0).decide(unaffordable, signal)).toBe("draw");
});

test("Main Action gives no Resell value to an empty Supply", () => {
  const input = request("main_action", [
    { id: "resell", label: "Resell twice and Draw", card: "station", box: 2 },
  ]);
  input.view = {
    ...input.view,
    deck: 0,
    players: input.view.players.map((p) =>
      p.seat !== 0
        ? p
        : {
            ...p,
            base: {
              ...p.base,
              station: { ...p.base.station, instance: "station", cardId: "stn-terran-outpost" },
            },
          },
    ),
  };
  expect(score(input, input.decision.options[0])).toBe(0);
  input.view = {
    ...input.view,
    supply: [{ instance: "supply", cardId: "mod-inflatable-habitat" }],
  };
  expect(score(input, input.decision.options[0])).toBeGreaterThan(0);
});

test("Draw remains useful when an exhausted Deck can reshuffle its discard", async () => {
  const input = mainRequest();
  input.view = {
    ...input.view,
    hand: [],
    deck: 0,
    discard: [{ instance: "discard", cardId: "mod-inflatable-habitat" }],
    discardCount: 1,
  };
  expect(score(input, input.decision.options[0])).toBeGreaterThan(
    score(input, input.decision.options[1]),
  );
  expect(await builtinMaker("reshuffle", 0).decide(input, signal)).toBe("draw");
});

test("Draft prefers an affordable useful Module to an expensive duplicate achievement", async () => {
  const input = request("draft", [build("mod-satellite-1"), build("mod-inflatable-habitat")], {
    achievements: ["satellite"],
    credits: 0,
  });
  input.view = {
    ...input.view,
    supply: ["mod-satellite-1", "mod-inflatable-habitat"].map((cardId) => ({
      instance: cardId,
      cardId,
    })),
  };
  expect(await builtinMaker("draft", 0).decide(input, signal)).toBe("mod-inflatable-habitat");
});

test("plays a useful free Agent but keeps Credits when its price exceeds its benefit", async () => {
  const agent = { id: "spy", label: "Spy", card: "agt-spybot-py", price: 0 };
  const input = hand(request("agent", [{ id: "go_on", label: "Go on" }, agent]), "agt-spybot-py");
  expect(await builtinMaker("agent", 0).decide(input, signal)).toBe("spy");
  input.decision = {
    ...input.decision,
    options: [input.decision.options[0], { ...agent, price: 10 }],
  };
  expect(await builtinMaker("agent", 0).decide(input, signal)).toBe("go_on");
});

test("resolves beneficial text now and delays a hand discard", async () => {
  for (const [cardId, expected] of [
    ["mod-experimental-borehole", "now"],
    ["mod-laika-memorial", "later"],
  ]) {
    const input = hand(
      request(
        "defer",
        ["later", "now"].map((id) => ({ id, label: id, card: "built" })),
      ),
      "mod-indigo-egregore",
    );
    input.view = {
      ...input.view,
      players: input.view.players.map((p) =>
        p.seat !== 0
          ? p
          : {
              ...p,
              base: { ...p.base, modules: [{ instance: "built", cardId, x: 2, y: 0, q: 0 }] },
            },
      ),
    };
    expect(await builtinMaker("defer", 0).decide(input, signal)).toBe(expected);
  }
});

test("unknown kinds are neutral; tie streams repeat by seed and seat without mutating requests", async () => {
  const input = request(
    "future_kind",
    ["a", "b", "c"].map((id) => ({ id, label: id })),
  );
  const before = structuredClone(input);
  expect(input.decision.options.map((option) => score(input, option))).toEqual([0, 0, 0]);
  const answers = async (seed: string, seat: number) => {
    const maker = builtinMaker(seed, seat);
    const results = [];
    for (let i = 0; i < 100; i++) results.push(await maker.decide(input, signal));
    return results;
  };
  const first = await answers("ties", 0);
  expect(await answers("ties", 0)).toEqual(first);
  expect(await answers("ties", 1)).not.toEqual(first);
  expect(await answers("other", 0)).not.toEqual(first);
  expect(new Set(first).size).toBe(3);
  expect(input).toEqual(before);
});

test.each([false, true])(
  "is total and deterministic on decisions from random games with two through six seats (Influences: %s)",
  async (influences) => {
    const kinds = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.integer({ min: 2, max: 6 }), async (seed, seats) => {
        const game = play({ seats, influences, kickstarter: false }, seed, seededPicker(seed), 70);
        const makers = Array.from({ length: seats }, (_, seat) => builtinMaker(seed, seat));
        const repeats = Array.from({ length: seats }, (_, seat) => builtinMaker(seed, seat));
        for (const [index, state] of game.states.entries()) {
          const decision = state.pending;
          if (!decision) continue;
          const seat = decision.seat;
          const input = {
            view: viewFor(state, seat),
            decision,
            seat,
            events: game.events
              .slice(0, index + 1)
              .flat()
              .flatMap((event) => eventFor(event, seat) ?? [])
              .slice(-200),
          };
          const before = structuredClone(input);
          kinds.add(decision.kind);
          for (const option of decision.options)
            expect(Number.isFinite(score(input, option))).toBe(true);
          const answer = await makers[seat].decide(input, signal);
          expect(decision.options.map((option) => option.id)).toContain(answer);
          expect(await repeats[seat].decide(input, signal)).toBe(answer);
          expect(input).toEqual(before);
        }
      }),
      { seed: 62, numRuns: 25 },
    );
    for (const kind of [
      "main_action",
      "build",
      "draft",
      "agent",
      "defer",
      "choose_one",
      "discard",
      "resell",
      "target",
      "flip",
      "steal_module",
    ])
      expect(kinds.has(kind)).toBe(true);
  },
  20_000,
);

test("scores 1,000 decisions in under 5 ms mean", async () => {
  const input = mainRequest();
  const maker = builtinMaker("timing", 0);
  const start = performance.now();
  for (let i = 0; i < 1_000; i++) await maker.decide(input, signal);
  const mean = (performance.now() - start) / 1_000;
  process.stdout.write(`builtin: 1,000 decisions, mean ${mean.toFixed(3)} ms\n`);
  expect(mean).toBeLessThan(5);
});

test("Discard and Resell preserve the Module that can be built soon", () => {
  for (const kind of ["discard", "resell"]) {
    const input = hand(
      request(kind, [build("mod-inflatable-habitat"), build("mod-indigo-egregore")], {
        credits: 0,
      }),
      "mod-inflatable-habitat",
      "mod-indigo-egregore",
    );
    if (kind === "resell") input.view = { ...input.view, supply: input.view.hand, hand: [] };
    expect(score(input, input.decision.options[1])).toBeGreaterThan(
      score(input, input.decision.options[0]),
    );
  }
});

function opponents(input: DecisionRequest): DecisionRequest {
  input.view = {
    ...input.view,
    players: [0, 1, 2].map((seat) => ({
      ...input.view.players[0],
      seat,
      colonists: seat === 2 ? 8 : 1,
      base: {
        ...input.view.players[0].base,
        station: {
          instance: `station-${String(seat)}`,
          cardId: "stn-shackleton",
          side: "named",
          named: "stn-shackleton",
          revealed: true,
        },
      },
    })),
  };
  return input;
}

test("targets the leading opponent and spares its own seat", () => {
  const input = opponents(
    request(
      "target",
      [0, 1, 2].map((target) => ({ id: String(target), label: "Target", target })),
    ),
  );
  const values = input.decision.options.map((option) => score(input, option));
  expect(values[2]).toBeGreaterThan(values[1]);
  expect(values[1]).toBeGreaterThan(values[0]);
});

test("gives an opponent Resells to the trailing seat, regardless of option labels", async () => {
  const dealt = dealGame({ seats: 3, influences: false, kickstarter: false }, "resell-target");
  const state = run(
    pushAction({ ...dealt, credits: [0, 0, 19] }, { op: "opponent_resells", n: 2 }, 0),
    gameRegistry,
  ).state;
  const view = viewFor(state, 0);
  const pending = view.pending;
  if (!pending || !("options" in pending)) throw new Error("Expected own target decision");
  expect(pending.kind).toBe("target");
  const input: DecisionRequest = {
    view,
    decision: {
      ...pending,
      options: pending.options.map((option) => ({ ...option, label: "Choose a player" })),
    },
    seat: 0,
    events: [],
  };
  expect(await builtinMaker("resell-target", 0).decide(input, signal)).toBe("1");
});

test("Flip and neighbour targeting score the affected Stations, including self harm", () => {
  for (const kind of ["flip", "target"]) {
    const input = opponents(
      request(
        kind,
        [[], [0], [1], [2]].map((seats, target) => ({
          id: String(target),
          label: "Flip",
          seats,
          target,
        })),
      ),
    );
    const values = input.decision.options.map((option) => score(input, option));
    expect(values[0]).toBeGreaterThan(values[1]);
    expect(values[3]).toBeGreaterThan(values[2]);
    expect(values[2]).toBeGreaterThan(values[0]);
  }
});

test("flips its known Outpost to the named side but never guesses an opponent's hidden Station", () => {
  const input = opponents(
    request(
      "flip",
      [[], [0], [1]].map((seats, id) => ({ id: String(id), label: "Flip", seats })),
    ),
  );
  input.view = {
    ...input.view,
    players: input.view.players.map((p) => ({
      ...p,
      base: {
        ...p.base,
        station: {
          ...p.base.station,
          cardId: "stn-terran-outpost",
          side: "terran_outpost",
          named: p.seat === 0 ? "stn-shackleton" : null,
          revealed: false,
        },
      },
    })),
  };
  expect(score(input, input.decision.options[1])).toBeGreaterThan(
    score(input, input.decision.options[0]),
  );
  expect(score(input, input.decision.options[2])).toBe(score(input, input.decision.options[0]));
});

test("Steal Module values the gained Module and harm to the leading owner", () => {
  const input = opponents(
    request(
      "steal_module",
      [1, 2].map((target) => ({
        id: `rover-${String(target)}`,
        card: `rover-${String(target)}`,
        target,
        label: "Steal",
      })),
    ),
  );
  input.view = {
    ...input.view,
    players: input.view.players.map((p) => ({
      ...p,
      base: {
        ...p.base,
        modules:
          p.seat === 0
            ? []
            : [{ instance: `rover-${String(p.seat)}`, cardId: "mod-rover-1", x: 2, y: 0, q: 0 }],
      },
    })),
  };
  expect(score(input, input.decision.options[1])).toBeGreaterThan(
    score(input, input.decision.options[0]),
  );
  expect(score(input, input.decision.options[0])).toBeGreaterThan(0);
});

function spyRequest(cardIds: string[]): DecisionRequest {
  const input = hand(
    request(
      "choose_one",
      [0, 1].map((id) => ({ id: String(id), label: "Opaque label", card: "agt-spybot-py" })),
    ),
    "agt-spybot-py",
  );
  input.events = [
    {
      type: "hand_seen",
      looker: 0,
      opponent: 1,
      cards: cardIds.map((cardId) => ({ instance: cardId, cardId })),
      text: "Opaque text",
    },
  ];
  return input;
}

test("Spybot chooses Discard after seeing one Influence and Draw after seeing an empty hand", async () => {
  const influence = spyRequest(["inf-lunar-alliance"]);
  const empty = spyRequest([]);
  expect(score(influence, influence.decision.options[1])).toBeGreaterThan(
    score(influence, influence.decision.options[0]),
  );
  expect(await builtinMaker("spy", 0).decide(influence, signal)).toBe("1");
  expect(await builtinMaker("spy", 0).decide(empty, signal)).toBe("0");
  empty.events.unshift(...influence.events);
  expect(await builtinMaker("spy", 0).decide(empty, signal)).toBe("0");
});

test("Spybot ignores a different looker's event and discounts a hand's cheapest discard", async () => {
  const input = spyRequest(["inf-lunar-alliance", "agt-spybot-py"]);
  expect(await builtinMaker("spy", 0).decide(input, signal)).toBe("0");
  input.events = [{ type: "hand_seen", looker: 1, opponent: 0, text: "No identities" }];
  expect(await builtinMaker("spy", 0).decide(input, signal)).toBe("0");
});

test("choose-one scores the printed actions rather than option labels", () => {
  const input = hand(
    request(
      "choose_one",
      [0, 1].map((id) => ({ id: String(id), label: "Opaque", card: "agt-panaman-broker" })),
    ),
    "agt-panaman-broker",
  );
  input.view = {
    ...input.view,
    supply: [],
    players: input.view.players.map((p) => ({ ...p, credits: p.seat === 0 ? 0 : 3 })),
  };
  expect(score(input, input.decision.options[1])).toBeGreaterThan(
    score(input, input.decision.options[0]),
  );
});

function stuckRequest(...supply: string[]): DecisionRequest {
  const station = {
    instance: "station",
    cardId: "stn-dark-side",
    side: "named" as const,
    named: "stn-dark-side",
    revealed: true,
  };
  const input = hand(
    request(
      "main_action",
      [
        { id: "draft", label: "Draft", card: "station", box: 0 },
        { id: "build", label: "Build", card: "station", box: 1 },
      ],
      { credits: 0, base: { station, modules: [], orbs: { red: 1, blue: 0, yellow: 1, wild: 0 } } },
    ),
    "mod-indigo-egregore",
  );
  input.view = {
    ...input.view,
    supply: supply.map((cardId) => ({ instance: cardId, cardId })),
  };
  return input;
}

test.each(["mod-artificial-intellect", "agt-kim-the-mech-pilot"])(
  "Main Action takes an unwanted %s from the Supply rather than a Build it cannot make",
  async (cardId) => {
    const input = stuckRequest(cardId);
    const [draft, build] = input.decision.options;
    expect(score(input, build)).toBe(0);
    expect(score(input, draft)).toBeGreaterThan(0);
    expect(await builtinMaker("stuck", 0).decide(input, signal)).toBe("draft");
  },
);

test("Main Action may still leave an Influence whose Draft costs more than it gains", async () => {
  const input = hand(
    stuckRequest("inf-runaway-bureaucracy"),
    "inf-lunar-alliance",
    "inf-quarantine",
  );
  const [draft, build] = input.decision.options;
  expect(score(input, draft)).toBeLessThan(0);
  expect(score(input, build)).toBe(0);
  expect(await builtinMaker("stuck", 0).decide(input, signal)).toBe("build");
});
