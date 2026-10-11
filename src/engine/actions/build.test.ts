import { describe, expect, it } from "vitest";
import { orbsOf, type CardOf } from "../base.ts";
import { cardById } from "../catalogue.ts";
import { applyChoice, push, run, type Registry, type Resolved } from "../loop.ts";
import { legalPlacements } from "../placement.ts";
import { dealGame } from "../setup.ts";
import type { DecisionOption, Frame, GameState } from "../state.ts";
import type { ModuleSpec } from "../testing/build.ts";
import { pushTurn, turnHandlers } from "../turn.ts";
import { buildOptions } from "./build.ts";
import { actionHandlers } from "./index.ts";

const dealt = dealGame(
  { seats: 3, startingSeat: 0, influences: false, kickstarter: false },
  "build",
);
const registry: Registry = {
  handlers: turnHandlers(actionHandlers),
  afterStep: (state) => ({ state }),
};

const BOREHOLE = "mod-experimental-borehole";
const HABITAT = "mod-inflatable-habitat";
const HEADQUARTERS = "mod-underground-headquarters";
const DEPOT = "mod-depot";
const EGREGORE = "mod-indigo-egregore";
const PRINTER = "mod-bacon-printer";
const REACTOR = "mod-fusion-reactor";

interface Spec {
  /** Catalogue ids of seat 0's hand: instances h1, h2, ... */
  readonly hand: readonly string[];
  /** Modules already in seat 0's Base: instances b1, b2, ... */
  readonly modules?: readonly ModuleSpec[];
  readonly credits?: number;
  /** Catalogue id of the named side that seat 0's Station shows. Default: Terran Outpost. */
  readonly station?: string;
}

/** The dealt game with seat 0's hand, Base and Credits set by hand. Seat 0 is active. */
function game({ hand, modules = [], credits = 3, station }: Spec): GameState {
  const cards: Record<string, string> = { ...dealt.cards };
  const instance = (prefix: string, id: string, index: number): string => {
    const key = `${prefix}${String(index + 1)}`;
    cards[key] = id;
    return key;
  };
  const held = hand.map((id, index) => instance("h", id, index));
  const built = modules.map(([id, x, y, q], index) => ({
    card: instance("b", id, index),
    x,
    y,
    q,
  }));
  const dealtStation = dealt.bases[0].station;
  if (station !== undefined) cards[dealtStation.card] = station;
  const shown: typeof dealtStation =
    station === undefined ? dealtStation : { ...dealtStation, side: "named", revealed: true };
  return {
    ...dealt,
    cards,
    // Keep the other seats free of incidental Agent choices when the turn ends.
    deck: [...dealt.deck, ...dealt.hands.flat()],
    hands: [held, ...dealt.hands.slice(1).map(() => [])],
    bases: [{ station: shown, modules: built }, ...dealt.bases.slice(1)],
    credits: [credits, ...dealt.credits.slice(1)],
  };
}

function choose(state: GameState, option: string, using: Registry = registry): Resolved {
  const pending = state.pending;
  if (!pending) throw new Error("Expected a pending decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, using);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

/** Seat 0 chooses the Main Action box with this label (R9.2). */
function chooseBox(state: GameState, label: string): Resolved {
  const started = run(pushTurn(state), registry).state;
  const box = started.pending?.options.find((option) => option.label === label);
  if (!box) throw new Error(`Expected the box ${label}`);
  return choose(started, box.id);
}

/** Seat 0 chooses the Terran Outpost box that holds only Build. */
function chooseBuildBox(state: GameState): Resolved {
  return chooseBox(state, "Terran Outpost: Build");
}

function optionsOf(state: GameState): readonly DecisionOption[] {
  if (state.pending?.kind !== "build") throw new Error("Expected a Build decision");
  return state.pending.options;
}

function cardOf(state: GameState): CardOf {
  return (instance) => cardById(state.cards[instance]);
}

describe("D6: the Build decision", () => {
  it("R10.1: never offers an Influence in hand, which is free and has no placement", () => {
    const mixed = game({ hand: ["inf-quarantine", HABITAT, "inf-entropic-cascade"] });
    expect(buildOptions(mixed, 0).length).toBeGreaterThan(0);
    expect(new Set(buildOptions(mixed, 0).map(({ card }) => card))).toEqual(new Set(["h2"]));
    const asked = chooseBuildBox(mixed).state;
    expect(new Set(optionsOf(asked).map((option) => option.card))).toEqual(
      new Set([undefined, "h2"]),
    );

    const only = game({ hand: ["inf-quarantine", "inf-entropic-cascade"] });
    expect(buildOptions(only, 0)).toEqual([]);
    // "Do not Build" is the one option left, so the engine takes it without asking.
    const skipped = chooseBuildBox(only);
    expect(skipped.state.pending?.kind).not.toBe("build");
    expect(skipped.events.map((event) => event.type)).not.toContain("module_built");
    expect(skipped.state.hands[0]).toEqual(["h1", "h2"]);
    expect(skipped.state.bases[0].modules).toEqual([]);
  });

  it("offers skip first, then every placement of each Module in hand", () => {
    const state = chooseBuildBox(game({ hand: [BOREHOLE, HABITAT] })).state;
    const base = state.bases[0];
    const expected = ["h1", "h2"].flatMap((card) =>
      legalPlacements(base, cardOf(state)(card), cardOf(state)).map(({ x, y, q, orbs }) => ({
        id: `${card}:${String(x)},${String(y)},${String(q)}`,
        card,
        x,
        y,
        q,
        price: 0,
        orbs,
      })),
    );
    expect(state.pending).toMatchObject({ id: "d2", seat: 0, kind: "build" });
    const [skip, ...options] = optionsOf(state);
    expect(skip).toStrictEqual({ id: "skip", label: "Do not Build" });
    expect(options).toMatchObject(expected);
    expect(options).toHaveLength(expected.length);
    expect(options[0]).toStrictEqual({
      id: "h1:0,-2,0",
      label: "Build Experimental Borehole at 0,-2 upright, pay 0",
      card: "h1",
      x: 0,
      y: -2,
      q: 0,
      price: 0,
      orbs: ["red"],
    });
  });

  it("names the turn and the price in the label", () => {
    const options = buildOptions(game({ hand: [DEPOT] }), 0);
    const labels = [0, 1, 2, 3].map((q) => options.find((option) => option.q === q)?.label);
    expect(labels.map((label) => label?.replace(/^Build Depot at -?\d+,-?\d+ /, ""))).toEqual([
      "upright, pay 2",
      "turned right, pay 2",
      "upside down, pay 2",
      "turned left, pay 2",
    ]);
  });

  it("orders options by hand position, then y, x and q", () => {
    const options = buildOptions(game({ hand: [HABITAT, BOREHOLE, HABITAT] }), 0);
    const keys = options.map(({ card, x, y, q }) => [Number(card.slice(1)), y, x, q]);
    const sorted = keys.toSorted((a, b) => a.map((n, i) => n - b[i]).find((n) => n !== 0) ?? 0);
    expect(new Set(options.map(({ card }) => card))).toEqual(new Set(["h1", "h2", "h3"]));
    expect(keys).toEqual(sorted);
  });

  it("gives equal option ids in equal order for two equal states", () => {
    const first = optionsOf(chooseBuildBox(game({ hand: [DEPOT, BOREHOLE, HABITAT] })).state);
    const second = optionsOf(chooseBuildBox(game({ hand: [DEPOT, BOREHOLE, HABITAT] })).state);
    expect(second).toStrictEqual(first);
    expect(new Set(first.map(({ id }) => id)).size).toBe(first.length);
    expect(first.length).toBeGreaterThan(3);
  });

  it("R7.7: offers only Modules", () => {
    // A Station is never in a hand (R9.1). It stands in here for a card that
    // is free and has half-orbs, and still is not a Module.
    const state = game({ hand: [HABITAT, HABITAT] });
    const cards = { ...state.cards, h1: "agt-crazy-president", h2: "stn-shackleton" };
    expect(buildOptions({ ...state, cards }, 0)).toEqual([]);
  });

  it("R7.7: a Module with no legal placement is not offered", () => {
    // The Engineers cover the Station's gray half-orb and put a blue one next
    // to its red: no red half-orb of a Borehole can lie against either.
    const state = game({
      hand: [BOREHOLE, HABITAT],
      modules: [["mod-beruang-engineers", 1, -1, 0]],
    });
    expect(legalPlacements(state.bases[0], cardById(BOREHOLE), cardOf(state))).toEqual([]);
    const options = optionsOf(chooseBuildBox(state).state);
    expect(options.length).toBeGreaterThan(1);
    expect(options.slice(1).every(({ card }) => card === "h2")).toBe(true);
  });

  it("R6.4: with 0 Credits only free or Orb-covered Modules are offered", () => {
    // The Headquarters forms two blue Orbs with the Station.
    const modules: ModuleSpec[] = [[HEADQUARTERS, -1, 0, 0]];
    const hand = [DEPOT, EGREGORE, HABITAT, PRINTER];
    const broke = game({ hand, modules, credits: 0 });
    expect(orbsOf(broke.bases[0], cardOf(broke))).toEqual({ red: 0, blue: 2, yellow: 0, wild: 0 });
    const offered = buildOptions(broke, 0);
    expect(new Set(offered.map(({ card }) => card))).toEqual(new Set(["h1", "h3"]));
    expect(offered.every(({ price }) => price === 0)).toBe(true);

    // Exact payment is allowed: the Egregore costs 2 Credits, the Printer 3.
    const two = buildOptions(game({ hand, modules, credits: 2 }), 0);
    expect(new Set(two.map(({ card }) => card))).toEqual(new Set(["h1", "h2", "h3"]));
    expect(two.find(({ card }) => card === "h2")?.price).toBe(2);
  });

  it("R6.4: with nothing to Build the decision has only skip and is applied at once", () => {
    const state = game({ hand: [EGREGORE, PRINTER], credits: 0 });
    const result = chooseBuildBox(state);
    expect(result.events.map(({ type }) => type)).toEqual(["box_chosen", "turn_started"]);
    // d1 was the box, d2 the Build with its one option, d3 the next seat's box.
    expect(result.state.pending).toMatchObject({ id: "d3", seat: 1, kind: "main_action" });
    expect(result.state.hands[0]).toEqual(["h1", "h2"]);
    expect(result.state.bases[0]).toEqual(state.bases[0]);
    expect(result.state.credits).toEqual(state.credits);
  });
});

describe("Build", () => {
  it.each(["mod-satellite-1", "mod-satellite-2"])(
    "R7.18: building %s without Supply Influences Resells nothing",
    (satellite) => {
      const start = game({ hand: [satellite] });
      const asked = chooseBuildBox(start).state;
      const option = optionsOf(asked).find(({ card }) => card === "h1");
      if (!option) throw new Error("Expected a Satellite placement");
      const result = choose(asked, option.id);
      expect(result.state.bases[0].modules).toHaveLength(1);
      expect(result.state.supply).toEqual(start.supply);
      expect(result.state.discard).toEqual(start.discard);
      expect(option.price).toBe(2);
      expect(result.state.credits[0]).toBe(1);
      expect(result.events.some(({ type }) => type === "card_resold")).toBe(false);
      expect(result.state.pending).toMatchObject({ kind: "main_action", seat: 1 });
    },
  );

  it("R7.7: pays the price, then moves the Module from the hand into the Base", () => {
    const start = game({ hand: [HABITAT, HEADQUARTERS] });
    const before = structuredClone(start);
    const asked = chooseBuildBox(start).state;
    const option = optionsOf(asked).find(({ id }) => id === "h2:-1,0,0");
    expect(option).toMatchObject({ card: "h2", x: -1, y: 0, q: 0, price: 2 });

    const result = choose(asked, "h2:-1,0,0");
    expect(result.state.credits).toEqual([1, 3, 3]);
    expect(result.state.hands[0]).toEqual(["h1"]);
    expect(result.state.bases[0].modules).toEqual([{ card: "h2", x: -1, y: 0, q: 0 }]);
    expect(result.events.slice(0, 2)).toEqual([
      { type: "credits_changed", seat: 0, delta: -2, credits: 1 },
      {
        type: "module_built",
        seat: 0,
        card: { instance: "h2", cardId: HEADQUARTERS },
        x: -1,
        y: 0,
        q: 0,
        cost: 2,
      },
    ]);
    expect(result.events.slice(2).map(({ type }) => type)).toEqual(["turn_started"]);
    expect(result.state.hands.slice(1)).toEqual(start.hands.slice(1));
    expect(result.state.bases.slice(1)).toEqual(start.bases.slice(1));
    expect(start).toEqual(before);
  });

  it("R8.5: the payment and the placement are two steps", () => {
    const asked = chooseBuildBox(game({ hand: [HEADQUARTERS] })).state;
    const seen: GameState[] = [];
    const spy: Registry = {
      ...registry,
      afterStep: (state) => {
        seen.push(state);
        return { state };
      },
    };
    const pending = asked.pending;
    if (!pending) throw new Error("Expected a pending decision");
    applyChoice(asked, { seat: 0, decision: pending.id, option: "h1:-1,0,0" }, spy);
    expect(seen[0].credits[0]).toBe(1);
    expect(seen[0].hands[0]).toEqual(["h1"]);
    expect(seen[0].bases[0].modules).toEqual([]);
    expect(seen[1].hands[0]).toEqual([]);
    expect(seen[1].bases[0].modules).toEqual([{ card: "h1", x: -1, y: 0, q: 0 }]);
  });

  it("R6.6: a Module's own half-orbs do not lower its own price", () => {
    const asked = chooseBuildBox(game({ hand: [HEADQUARTERS, HEADQUARTERS] })).state;
    const option = optionsOf(asked).find(({ id }) => id === "h1:-1,0,0");
    // The placement forms the two blue Orbs the card costs, and it still costs 2.
    expect(cardById(HEADQUARTERS).cost).toEqual(["blue", "blue"]);
    expect(option).toMatchObject({ orbs: ["blue", "blue"], price: 2 });
    const built = choose(asked, "h1:-1,0,0").state;
    expect(built.credits[0]).toBe(1);
    // R6.5: the same Orbs then cover the cost of the second copy.
    const next = buildOptions(built, 0);
    expect(next.length).toBeGreaterThan(0);
    expect(next.every(({ card, price }) => card === "h2" && price === 0)).toBe(true);
  });

  it("skip changes nothing and emits nothing", () => {
    const start = game({ hand: [HABITAT] });
    const result = choose(chooseBuildBox(start).state, "skip");
    expect(result.events.map(({ type }) => type)).toEqual(["turn_started"]);
    expect(result.state.hands[0]).toEqual(["h1"]);
    expect(result.state.bases[0]).toEqual(start.bases[0]);
    expect(result.state.credits).toEqual(start.credits);
  });

  it("R9.5: the builder of an Experimental Borehole then Draws 2", () => {
    const start = game({ hand: [BOREHOLE] });
    const [first, second] = start.deck;
    const result = choose(chooseBuildBox(start).state, "h1:0,-2,0");
    expect(result.events).toEqual([
      {
        type: "module_built",
        seat: 0,
        card: { instance: "h1", cardId: BOREHOLE },
        x: 0,
        y: -2,
        q: 0,
        cost: 0,
      },
      { type: "card_drawn", seat: 0, card: { instance: first, cardId: start.cards[first] } },
      { type: "card_drawn", seat: 0, card: { instance: second, cardId: start.cards[second] } },
      { type: "turn_started", seat: 1, turn: 2 },
    ]);
    expect(result.state.hands[0]).toEqual([first, second]);
    expect(result.state.deck).toEqual(start.deck.slice(2));
    expect(result.state.credits).toEqual(start.credits);
  });

  it("R9.5: Depot's text is resolved at once and offers the next Build", () => {
    const asked = chooseBuildBox(game({ hand: [DEPOT, HABITAT] })).state;
    const depot = optionsOf(asked).find(({ card }) => card === "h1");
    if (!depot) throw new Error("Expected an option for the Depot");
    const result = choose(asked, depot.id);
    expect(result.events.map(({ type }) => type)).toEqual(["credits_changed", "module_built"]);
    expect(result.state.pending).toMatchObject({ id: "d3", seat: 0, kind: "build" });
    const next = optionsOf(result.state);
    expect(next.slice(1)).toStrictEqual(buildOptions(result.state, 0));
    expect(next.slice(1).every(({ card }) => card === "h2")).toBe(true);
    const done = choose(result.state, next[1].id);
    expect(done.state.hands[0]).toEqual([]);
    expect(done.state.bases[0].modules.map(({ card }) => card)).toEqual(["h1", "h2"]);
    expect(done.state.pending).toMatchObject({ seat: 1, kind: "main_action" });
  });
});

describe("D7: resolve the text of a built Module now or later", () => {
  const REACTOR_BOX = "Fusion Reactor: Build, Draw, Discard";
  const reactor: ModuleSpec = [REACTOR, -1, 0, 0];

  /** The id of the first Build option for a card of the hand. */
  function buildOf(state: GameState, card: string): string {
    const option = optionsOf(state).find((offered) => offered.card === card);
    if (!option) throw new Error(`Expected a Build option for ${card}`);
    return option.id;
  }

  /** Seat 0 chooses a box and Builds `card` with its first Build. */
  function buildFrom(start: GameState, box: string, card: string): Resolved {
    const asked = chooseBox(start, box).state;
    return choose(asked, buildOf(asked, card));
  }

  function drawn(state: GameState, instance: string) {
    return { type: "card_drawn", seat: 0, card: { instance, cardId: state.cards[instance] } };
  }

  function deferredEvent(state: GameState, instance: string) {
    return { type: "text_deferred", seat: 0, card: { instance, cardId: state.cards[instance] } };
  }

  /** A registry that keeps the state after every step. */
  function watching(seen: GameState[]): Registry {
    return {
      ...registry,
      afterStep: (state) => {
        seen.push(state);
        return { state };
      },
    };
  }

  /** Each frame of the stack that has a `deferred` list, by frame id. */
  function deferredLists(state: GameState): Record<string, unknown> {
    return Object.fromEntries(
      state.stack.filter((frame) => "deferred" in frame).map(({ id, deferred }) => [id, deferred]),
    );
  }

  it("R8.3: asks the builder when the box that holds the Build has actions left", () => {
    const built = buildFrom(
      game({ hand: [BOREHOLE, HABITAT], modules: [reactor] }),
      REACTOR_BOX,
      "h1",
    );
    expect(built.events.map(({ type }) => type)).toEqual(["module_built"]);
    expect(built.state.pending).toStrictEqual({
      id: "d3",
      seat: 0,
      kind: "defer",
      options: [
        { id: "now", label: "Resolve the text of Experimental Borehole now", card: "h1" },
        {
          id: "later",
          label: "Resolve the text of Experimental Borehole after the current card",
          card: "h1",
        },
      ],
    });
    expect(built.state.bases[0].modules.map(({ card }) => card)).toEqual(["b1", "h1"]);
    expect(built.state.hands[0]).toEqual(["h2"]);
    expect(JSON.parse(JSON.stringify(built.state))).toStrictEqual(built.state);
  });

  it("R8.5: the placement is checked in its own step, before D7 is asked", () => {
    const asked = chooseBox(
      game({ hand: [BOREHOLE, HABITAT], modules: [reactor] }),
      REACTOR_BOX,
    ).state;
    const seen: GameState[] = [];
    choose(asked, buildOf(asked, "h1"), watching(seen));
    // The payment, the placement and the question, with the Modules in the Base.
    expect(seen.map((state) => [state.bases[0].modules.length, state.pending?.kind])).toEqual([
      [1, undefined],
      [2, undefined],
      [2, "defer"],
    ]);
  });

  it("R8.3: a deferred Experimental Borehole Draws 2 after the box's Draw and Discard", () => {
    const start = game({ hand: [BOREHOLE, HABITAT], modules: [reactor] });
    const [first, second, third] = start.deck;
    const deferred = choose(buildFrom(start, REACTOR_BOX, "h1").state, "later");
    expect(deferred.events).toEqual([deferredEvent(start, "h1"), drawn(start, first)]);
    // The box's Discard waits for a choice; the Borehole has not Drawn yet.
    expect(deferred.state.pending).toMatchObject({ seat: 0, kind: "discard" });
    expect(deferred.state.hands[0]).toEqual(["h2", first]);
    const done = choose(deferred.state, first);
    expect(done.events).toEqual([
      { type: "card_discarded", seat: 0, card: { instance: first, cardId: start.cards[first] } },
      drawn(start, second),
      drawn(start, third),
      { type: "turn_started", seat: 1, turn: 2 },
    ]);
    expect(done.state.hands[0]).toEqual(["h2", second, third]);
  });

  it("R8.3: resolved at once, the Borehole Draws 2 before the box's Draw", () => {
    const start = game({ hand: [BOREHOLE, HABITAT], modules: [reactor] });
    const seen: GameState[] = [];
    const now = choose(buildFrom(start, REACTOR_BOX, "h1").state, "now", watching(seen));
    expect(now.events).toEqual(start.deck.slice(0, 3).map((card) => drawn(start, card)));
    expect(now.state.pending).toMatchObject({ seat: 0, kind: "discard" });
    expect(now.state.hands[0]).toEqual(["h2", ...start.deck.slice(0, 3)]);
    // The answer puts the text above the box and defers nothing.
    expect(seen[0].stack.map(({ kind }) => kind)).toEqual(["turn", "box", "on_play"]);
    expect(seen[0].stack.at(-1)).toMatchObject({ seat: 0, card: "h1", position: 0, deferred: [] });
    expect(seen.flatMap((state) => Object.values(deferredLists(state))).flat()).toEqual([]);
  });

  it("R8.3: Terran Outpost's box Build has no action left, so no D7 is asked", () => {
    const start = game({ hand: [BOREHOLE] });
    const result = buildFrom(start, "Terran Outpost: Build", "h1");
    expect(result.events.map(({ type }) => type)).toEqual([
      "module_built",
      "card_drawn",
      "card_drawn",
      "turn_started",
    ]);
    // d1 was the box and d2 the Build; the next decision is the next seat's box.
    expect(result.state.pending).toMatchObject({ id: "d3", seat: 1, kind: "main_action" });
    expect(result.state.hands[0]).toEqual(start.deck.slice(0, 2));
  });

  it.each([
    { order: "a Borehole, then a Bacon Printer", hand: [BOREHOLE, PRINTER], beforeDiscard: 4 },
    { order: "a Bacon Printer, then a Borehole", hand: [PRINTER, BOREHOLE], beforeDiscard: 2 },
  ])("R8.10: $order deferred in one box resolve in that order", ({ hand, beforeDiscard }) => {
    const start = game({ hand, station: "stn-shackleton", credits: 5 });
    const one = choose(buildFrom(start, "Shackleton: Build x2, Draw", "h1").state, "later");
    expect(one.events).toEqual([deferredEvent(start, "h1")]);
    expect(Object.values(deferredLists(one.state))).toEqual([["h1"]]);
    const two = choose(one.state, buildOf(one.state, "h2")).state;
    expect(two.pending).toMatchObject({ seat: 0, kind: "defer" });
    // The box's Draw, then each text in full: Draw 2 for the Borehole, and
    // Draw, Discard for the Printer, whose Discard waits for a choice.
    const texts = choose(two, "later");
    expect(texts.events).toEqual([
      deferredEvent(start, "h2"),
      ...start.deck.slice(0, beforeDiscard).map((card) => drawn(start, card)),
    ]);
    expect(texts.state.pending).toMatchObject({ seat: 0, kind: "discard" });
    expect(texts.state.hands[0]).toEqual(start.deck.slice(0, beforeDiscard));
    const done = choose(texts.state, start.deck[0]);
    expect(done.events.map(({ type }) => type)).toEqual([
      "card_discarded",
      ...Array<string>(4 - beforeDiscard).fill("card_drawn"),
      "turn_started",
    ]);
    expect(done.state.hands[0]).toEqual(start.deck.slice(1, 4));
  });

  it("R8.3: a Depot resolved at once Builds a Borehole, whose text has no D7 and comes before the box's Draw", () => {
    const start = game({ hand: [DEPOT, BOREHOLE], modules: [reactor] });
    const depot = buildFrom(start, REACTOR_BOX, "h1").state;
    expect(depot.pending).toMatchObject({ id: "d3", seat: 0, kind: "defer" });
    const text = choose(depot, "now").state;
    expect(text.pending).toMatchObject({ id: "d4", seat: 0, kind: "build" });
    const seen: GameState[] = [];
    const result = choose(text, buildOf(text, "h2"), watching(seen));
    expect(result.events.map(({ type }) => type)).toEqual([
      "module_built",
      "card_drawn",
      "card_drawn",
      "card_drawn",
    ]);
    // Depot's text is only Build: the Borehole's text lies above it at once.
    expect(seen[1].stack.map(({ kind, card }) => [kind, card ?? null])).toEqual([
      ["turn", null],
      ["box", null],
      ["on_play", "h1"],
      ["on_play", "h2"],
    ]);
    // d5 is the box's Discard: no D7 was asked for the Borehole.
    expect(result.state.pending).toMatchObject({ id: "d5", seat: 0, kind: "discard" });
    expect(result.state.hands[0]).toEqual(start.deck.slice(0, 3));
  });

  it("R8.10: a text deferred inside a text above the box waits only for that text", () => {
    const start = game({ hand: [BOREHOLE, HABITAT], modules: [reactor] });
    const asked = chooseBox(start, REACTOR_BOX).state;
    // Take the box's own Build away, so the box has Draw, Discard left, and
    // put a text "Build, Draw" above it.
    const nested = push({ ...asked, pending: null, stack: asked.stack.slice(0, -1) }, "box", {
      seat: 0,
      actions: [
        { op: "build", n: 1 },
        { op: "draw", n: 1 },
      ],
      position: 0,
      repeated: 0,
      deferred: [],
    });
    const [outer, inner] = nested.stack.slice(-2).map(({ id }) => id);
    const building = run(nested, registry).state;
    const built = choose(building, buildOf(building, "h1")).state;
    expect(built.pending).toMatchObject({ seat: 0, kind: "defer" });

    const seen: GameState[] = [];
    const draws: string[] = [];
    const names: Record<string, string> = { [outer]: "box", [inner]: "text" };
    const spy: Registry = {
      ...registry,
      afterStep: (state, frame: Frame) => {
        seen.push(state);
        // A Draw has left the stack: the text that holds it is on top.
        const holder = state.stack.at(-1);
        if (holder && frame.kind === "action" && (frame.action as { op: string }).op === "draw") {
          draws.push(names[holder.id] ?? holder.kind);
        }
        return { state };
      },
    };
    const result = choose(built, "later", spy);
    // The entry is on the text that holds the Build, not on the box below it.
    expect(deferredLists(seen[0])).toEqual({ [outer]: [], [inner]: ["h1"] });
    expect(result.events).toEqual([
      deferredEvent(start, "h1"),
      ...start.deck.slice(0, 4).map((card) => drawn(start, card)),
    ]);
    // The text's own Draw, the Borehole's Draw 2, and only then the box's Draw.
    expect(draws).toEqual(["text", "on_play", "on_play", "box"]);
    expect(result.state.pending).toMatchObject({ seat: 0, kind: "discard" });
  });

  it("R8.3: a text deferred from the box's own Build is on the box, not on the Build's action frame", () => {
    const start = game({ hand: [BOREHOLE, HABITAT], modules: [reactor] });
    const built = buildFrom(start, REACTOR_BOX, "h1").state;
    expect(built.stack.map(({ kind }) => kind)).toEqual(["turn", "box", "action"]);
    expect(deferredLists(built)).toEqual({ [built.stack[1].id]: [] });
    const seen: GameState[] = [];
    choose(built, "later", watching(seen));
    expect(seen[0].stack.map(({ kind, deferred }) => [kind, deferred ?? null])).toEqual([
      ["turn", null],
      ["box", ["h1"]],
    ]);
    const actions = [built, ...seen].flatMap(({ stack }) =>
      stack.filter(({ kind }) => kind === "action"),
    );
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((frame) => !("deferred" in frame))).toBe(true);
  });
});
