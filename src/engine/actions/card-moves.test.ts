import { describe, expect, it } from "vitest";
import { cardById, type ActionDef } from "../catalogue.ts";
import { applyChoice, run, type Registry, type Resolved } from "../loop.ts";
import { eventFor } from "../events.ts";
import { shuffle } from "../rng.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { pushTurn, turnHandlers } from "../turn.ts";
import { actionHandlers, handlerOf, pushAction, type ActionFrame } from "./index.ts";

const dealt = dealGame(
  { seats: 3, startingSeat: 0, influences: false, kickstarter: false },
  "card-moves",
);
const registry: Registry = {
  handlers: turnHandlers(actionHandlers),
  afterStep: (state) => ({ state }),
};

function choose(state: GameState, index = 0, rules = registry): Resolved {
  const pending = state.pending;
  if (!pending) throw new Error("Expected a pending decision");
  const result = applyChoice(
    state,
    {
      seat: pending.seat,
      decision: pending.id,
      option: pending.options[index].id,
    },
    rules,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function step(state: GameState, action: ActionDef, seat = 1) {
  const started = pushAction(state, action, seat);
  const frame = started.stack.at(-1) as ActionFrame;
  const handler = handlerOf(actionHandlers, action);
  const asked = handler(started, frame, null);
  if (!asked.state.pending) return asked;
  const decision = asked.state.pending;
  return handler({ ...asked.state, pending: null }, frame, {
    decision,
    option: decision.options[1] ?? decision.options[0],
  });
}

function card(state: GameState, instance: string) {
  return { instance, cardId: state.cards[instance] };
}

describe("single card actions", () => {
  it.each([
    ["draft", "supply", "Draft"],
    ["discard", "hand", "Discard"],
    ["resell", "supply", "Resell"],
  ] as const)("%s asks its performing seat with stable card options", (op, zone, label) => {
    const started = pushAction(dealt, { op, n: 1 }, 1);
    const frame = started.stack.at(-1) as ActionFrame;
    const result = handlerOf(actionHandlers, frame.action)(started, frame, null);
    const cards = zone === "supply" ? dealt.supply : dealt.hands[1];
    expect(result.state.pending).toMatchObject({
      seat: 1,
      kind: op,
      options: cards.map((instance) => ({
        id: instance,
        card: instance,
        label: `${label} ${cardById(dealt.cards[instance]).name}`,
      })),
    });
    expect(result.state.supply).toEqual(dealt.supply);
    expect(result.state.hands).toEqual(dealt.hands);
    expect(result.events ?? []).toEqual([]);
  });

  it("R7.4: Draft moves exactly the selected Supply card to the acting hand", () => {
    const before = structuredClone(dealt);
    const picked = dealt.supply[1];
    const result = step(dealt, { op: "draft", n: 1 });
    expect(result.state.supply).toEqual(dealt.supply.filter((id) => id !== picked));
    expect(result.state.hands).toEqual([
      dealt.hands[0],
      [...dealt.hands[1], picked],
      dealt.hands[2],
    ]);
    expect(result.state.deck).toEqual(dealt.deck);
    expect(result.state.discard).toEqual([]);
    expect(result.events).toEqual([{ type: "card_drafted", seat: 1, card: card(dealt, picked) }]);
    expect(result.state.stack).toEqual([]);
    expect(dealt).toEqual(before);
  });

  it("R7.5: Discard moves the discarding seat's selected card to the pile", () => {
    const before = structuredClone(dealt);
    const picked = dealt.hands[1][1];
    const result = step(dealt, { op: "discard", n: 1 });
    expect(result.state.hands).toEqual([
      dealt.hands[0],
      dealt.hands[1].filter((id) => id !== picked),
      dealt.hands[2],
    ]);
    expect(result.state.discard).toEqual([picked]);
    expect(result.state.supply).toEqual(dealt.supply);
    expect(result.events).toEqual([{ type: "card_discarded", seat: 1, card: card(dealt, picked) }]);
    expect(result.state.stack).toEqual([]);
    expect(dealt).toEqual(before);
  });

  it("R7.6: Draw takes only the top Deck card and leaves the RNG unchanged", () => {
    const before = structuredClone(dealt);
    const result = step(dealt, { op: "draw", n: 1 });
    expect(result.state.deck).toEqual(dealt.deck.slice(1));
    expect(result.state.hands).toEqual([
      dealt.hands[0],
      [...dealt.hands[1], dealt.deck[0]],
      dealt.hands[2],
    ]);
    expect(result.state.rng).toEqual(dealt.rng);
    expect(result.events).toEqual([
      { type: "card_drawn", seat: 1, card: card(dealt, dealt.deck[0]) },
    ]);
    expect(result.state.stack).toEqual([]);
    expect(dealt).toEqual(before);
  });

  it("R7.9: Resell moves one Supply card and gains one Credit in the same step", () => {
    const before = structuredClone(dealt);
    const picked = dealt.supply[1];
    const result = step(dealt, { op: "resell", n: 1 });
    expect(result.state.supply).toEqual(dealt.supply.filter((id) => id !== picked));
    expect(result.state.discard).toEqual([picked]);
    expect(result.state.hands).toEqual(dealt.hands);
    expect(result.state.credits).toEqual([3, 4, 3]);
    expect(result.events).toEqual([
      { type: "card_resold", seat: 1, card: card(dealt, picked), credits: 1 },
    ]);
    expect(result.state.stack).toEqual([]);
    expect(dealt).toEqual(before);
  });

  it("Resell's public log reports the one Credit earned, not the new balance", () => {
    const result = step(dealt, { op: "resell", n: 1 });
    const event = result.events?.[0];
    if (!event) throw new Error("Expected a Resell event");
    expect(eventFor(event, null)?.text).toBe(
      `Player 2 resold ${cardById(dealt.cards[dealt.supply[1]]).name} for 1 Credits.`,
    );
  });

  it("R7.9: offers Agents and Modules but never Influences", () => {
    const state = {
      ...dealt,
      cards: { ...dealt.cards, agent: "agt-investor", influence: "inf-quarantine" },
      supply: ["influence", "agent", dealt.supply[0]],
    };
    const started = pushAction(state, { op: "resell", n: 1 }, 1);
    const frame = started.stack.at(-1) as ActionFrame;
    const asked = handlerOf(actionHandlers, frame.action)(started, frame, null);
    expect(asked.state.pending?.options.map((option) => option.id)).toEqual([
      "agent",
      dealt.supply[0],
    ]);
    const onlyInfluence = { ...state, supply: ["influence"] };
    const skipped = step(onlyInfluence, { op: "resell", n: 1 });
    expect(skipped.state).toEqual({ ...onlyInfluence, counters: { frames: 1, decisions: 0 } });
    expect(skipped.events ?? []).toEqual([]);
  });

  it("R10.1: with an Influence and a Module in the Supply, Draft offers both and Resell only the Module", () => {
    const state = {
      ...dealt,
      cards: { ...dealt.cards, module: "mod-depot", influence: "inf-quarantine" },
      supply: ["module", "influence"],
    };
    const offered = (op: "draft" | "resell") => {
      const started = pushAction(state, { op, n: 1 }, 1);
      const frame = started.stack.at(-1) as ActionFrame;
      return handlerOf(actionHandlers, frame.action)(started, frame, null).state.pending?.options;
    };
    expect(offered("draft")).toEqual([
      { id: "module", card: "module", label: "Draft Depot" },
      { id: "influence", card: "influence", label: "Draft Quarantine, pay 0", price: 0 },
    ]);
    expect(offered("resell")).toEqual([{ id: "module", card: "module", label: "Resell Depot" }]);
    // The second option is the Influence: Drafting it puts it into the hand.
    const drafted = step(state, { op: "draft", n: 1 });
    expect(drafted.state.supply).toEqual(["module"]);
    expect(drafted.state.hands[1]).toEqual([...dealt.hands[1], "influence"]);
    expect(drafted.events).toEqual([
      { type: "card_drafted", seat: 1, card: { instance: "influence", cardId: "inf-quarantine" } },
    ]);
  });

  it("R10.1: an Influence is Drawn like any card and D5 offers one held in hand", () => {
    const state = {
      ...dealt,
      cards: { ...dealt.cards, top: "inf-terran-crackdown", held: "inf-lunar-alliance" },
      deck: ["top", ...dealt.deck],
      hands: [dealt.hands[0], [dealt.hands[1][0], "held"], dealt.hands[2]],
    };
    const drawn = step(state, { op: "draw", n: 1 });
    expect(drawn.state.hands[1]).toEqual([dealt.hands[1][0], "held", "top"]);
    expect(drawn.state.deck).toEqual(dealt.deck);

    const started = pushAction(state, { op: "discard", n: 1 }, 1);
    const frame = started.stack.at(-1) as ActionFrame;
    const asked = handlerOf(actionHandlers, frame.action)(started, frame, null);
    expect(asked.state.pending?.options.at(1)).toEqual({
      id: "held",
      card: "held",
      label: "Discard Lunar Alliance",
    });
    // The second option is the Influence: it goes to the Discard pile.
    const discarded = step(state, { op: "discard", n: 1 });
    expect(discarded.state.hands[1]).toEqual([dealt.hands[1][0]]);
    expect(discarded.state.discard).toEqual(["held"]);
    expect(discarded.events).toEqual([
      { type: "card_discarded", seat: 1, card: { instance: "held", cardId: "inf-lunar-alliance" } },
    ]);
  });

  it.each(["draft", "discard", "draw", "resell"] as const)(
    "%s skips empty zones without a decision, event or game change",
    (op) => {
      const empty = { ...dealt, deck: [], supply: [], hands: [[], [], []] };
      const result = step(empty, { op, n: 1 });
      expect(result.state).toEqual({ ...empty, counters: { frames: 1, decisions: 0 } });
      expect(result.events ?? []).toEqual([]);
    },
  );

  it("R8.7, R8.8: reshuffles three Discards with the game RNG, emits before drawing, excludes play", () => {
    const state = { ...dealt, deck: [], discard: dealt.deck.slice(0, 3), play: [dealt.deck[3]] };
    const before = structuredClone(state);
    const shuffled = shuffle(state.rng, state.discard);
    const result = step(state, { op: "draw", n: 1 });
    expect(result.state.deck).toEqual(shuffled.list.slice(1));
    expect(result.state.discard).toEqual([]);
    expect(result.state.hands[1]).toEqual([...state.hands[1], shuffled.list[0]]);
    expect(result.state.rng).toEqual(shuffled.state);
    expect(result.state.rng).not.toEqual(state.rng);
    expect(result.state.play).toEqual(state.play);
    expect(result.events).toEqual([
      { type: "deck_reshuffled", count: 3 },
      { type: "card_drawn", seat: 1, card: card(state, shuffled.list[0]) },
    ]);
    expect(step(state, { op: "draw", n: 1 })).toEqual(result);
    expect(state).toEqual(before);
  });
});

describe("turn integration", () => {
  // The hands lie under the Deck: with no Agent in a hand, no Agent step asks (R4.3).
  const quiet: GameState = {
    ...dealt,
    hands: [[], [], []],
    deck: [...dealt.deck, ...dealt.hands.flat()],
  };

  it("Terran Outpost asks two D8 decisions, gains two Credits, then Draws one card", () => {
    const seen: number[] = [];
    const rules: Registry = {
      ...registry,
      afterStep: (state) => {
        const moved = quiet.supply.length - state.supply.length;
        if (moved > (seen.at(-1) ?? 0)) seen.push(moved);
        return { state };
      },
    };
    const main = run(pushTurn(quiet), rules);
    const first = choose(main.state, 2, rules);
    expect(first.state.pending).toMatchObject({ kind: "resell", seat: 0 });
    const second = choose(first.state, 0, rules);
    expect(second.state.pending).toMatchObject({ kind: "resell", seat: 0 });
    expect(second.state.pending?.id).not.toBe(first.state.pending?.id);
    expect(second.state.credits[0]).toBe(4);
    expect(second.state.hands[0]).toEqual(quiet.hands[0]);
    const done = choose(second.state, 0, rules);
    expect(done.state.credits).toEqual([5, 3, 3]);
    expect(done.state.hands[0]).toEqual([...quiet.hands[0], quiet.deck[0]]);
    expect(done.state.discard).toEqual(quiet.supply.slice(0, 2));
    expect(done.state.pending).toMatchObject({ kind: "main_action", seat: 1 });
    expect([...second.events, ...done.events].map((event) => event.type)).toEqual([
      "card_resold",
      "card_resold",
      "card_drawn",
      "turn_started",
    ]);
    expect(seen).toEqual([1, 2]);
  });

  it("Resell with one card automatically applies its option, then skips the second repetition", () => {
    const state = { ...quiet, supply: [quiet.supply[0]] };
    const first = run(pushTurn(state), registry);
    const done = choose(first.state, 2);
    expect(done.state.pending).toMatchObject({ kind: "main_action", seat: 1 });
    // Draw consumes the first Deck card; the later Shuttle deal refills the Supply.
    expect(done.state.supply).toEqual(state.deck.slice(1, 7));
    expect(done.events.map((event) => event.type)).toEqual([
      "box_chosen",
      "card_resold",
      "card_drawn",
      "shuttles_arrived",
      "supply_dealt",
      "turn_started",
    ]);
    expect(done.state.discard).toEqual(state.supply);
    expect(done.state.credits[0]).toBe(4);
    expect(done.state.hands[0]).toEqual([...state.hands[0], state.deck[0]]);
    expect(done.events.filter((event) => event.type === "card_resold")).toHaveLength(1);
  });
});
