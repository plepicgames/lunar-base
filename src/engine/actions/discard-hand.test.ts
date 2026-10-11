import { describe, expect, it } from "vitest";
import { cardById, deckCards } from "../catalogue.ts";
import type { GameEvent } from "../events.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, run, type Registry, type Resolved } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { DecisionOption, GameState } from "../state.ts";
import { pushTurn } from "../turn.ts";
import { moveCard } from "../zones.ts";
import { pushAction } from "./index.ts";

const dealt = dealGame(
  { seats: 3, startingSeat: 0, influences: false, kickstarter: false },
  "discard-hand",
);

const LAIKA = "mod-laika-memorial";
const BOREHOLE = "mod-experimental-borehole";
const HABITAT = "mod-inflatable-habitat";
const EGREGORE = "mod-indigo-egregore";

const OUTPOST_BOX = "Terran Outpost: Build";
const SHACKLETON_BOX = "Shackleton: Build x2, Draw";

/**
 * The dealt game with seat 0's hand set by hand: instances h1, h2, ... Seat 0
 * is active. `station` is the named side its Station shows; default: Terran
 * Outpost.
 */
function game(hand: readonly string[], station?: string): GameState {
  const cards: Record<string, string> = { ...dealt.cards };
  const held = hand.map((id, index) => {
    const key = `h${String(index + 1)}`;
    cards[key] = id;
    return key;
  });
  const dealtStation = dealt.bases[0].station;
  if (station !== undefined) cards[dealtStation.card] = station;
  const shown: typeof dealtStation =
    station === undefined ? dealtStation : { ...dealtStation, side: "named", revealed: true };
  return {
    ...dealt,
    cards,
    deck: [...dealt.deck, ...dealt.hands[0]],
    hands: [held, ...dealt.hands.slice(1)],
    bases: [{ station: shown, modules: [] }, ...dealt.bases.slice(1)],
  };
}

function choose(state: GameState, option: string, using: Registry = gameRegistry): Resolved {
  const pending = state.pending;
  if (!pending) throw new Error("Expected a pending decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, using);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

/** Seat 0 chooses the Main Action box with this label. */
function chooseBox(state: GameState, label: string): GameState {
  const started = run(pushTurn(state), gameRegistry).state;
  const box = started.pending?.options.find((option) => option.label === label);
  if (!box) throw new Error(`Expected the box ${label}`);
  return choose(started, box.id).state;
}

/** Seat 0 Builds `card` at its first legal placement. */
function build(state: GameState, card: string): Resolved {
  if (state.pending?.kind !== "build") throw new Error("Expected a Build decision");
  const option = state.pending.options.find((offered) => offered.card === card);
  if (!option) throw new Error(`Expected a Build option for ${card}`);
  return choose(state, option.id);
}

function discardOption(state: GameState, card: string): DecisionOption {
  return { id: card, card, label: `Discard ${cardById(state.cards[card]).name}` };
}

function discarded(events: readonly GameEvent[]): string[] {
  return events.flatMap((event) => (event.type === "card_discarded" ? [event.card.instance] : []));
}

function drawn(events: readonly GameEvent[]): string[] {
  return events.flatMap((event) => (event.type === "card_drawn" ? [event.card.instance] : []));
}

/** What an effect that interrupts the action does: the frames it leaves are stepped again. */
function interrupt(state: GameState, change: (cleared: GameState) => GameState): Resolved {
  return run(change({ ...state, pending: null }), gameRegistry);
}

describe("R7.17: Discard all your cards", () => {
  it("both Laika Memorials enter the Deck", () => {
    const deck = deckCards({ seats: 2, influences: false, kickstarter: false });
    expect(deck.filter((id) => id === LAIKA)).toHaveLength(2);
  });

  it("Laika Memorial built with 3 other cards in hand Discards those 3 and the hand is empty", () => {
    const start = game([LAIKA, HABITAT, HABITAT, HABITAT]);
    const built = build(chooseBox(start, OUTPOST_BOX), "h1");
    expect(built.events.map(({ type }) => type)).toEqual(["module_built"]);
    // D5 over the set: the Laika Memorial has left the hand for the Base.
    expect(built.state.pending).toMatchObject({ seat: 0, kind: "discard" });
    expect(built.state.pending?.options).toStrictEqual(
      ["h2", "h3", "h4"].map((card) => discardOption(start, card)),
    );
    expect(built.state.pending?.options[0].label).toBe("Discard Inflatable Habitat");
    expect(built.state.stack.at(-1)).toMatchObject({
      kind: "action",
      action: { op: "discard_hand" },
      seat: 0,
      set: ["h2", "h3", "h4"],
    });

    const one = choose(built.state, "h3");
    expect(one.events).toEqual([
      { type: "card_discarded", seat: 0, card: { instance: "h3", cardId: HABITAT } },
    ]);
    expect(one.state.pending?.options).toStrictEqual(
      ["h2", "h4"].map((card) => discardOption(start, card)),
    );
    // The last card of the set is the only option, so nobody is asked.
    const done = choose(one.state, "h4");
    expect(discarded(done.events)).toEqual(["h4", "h2"]);
    expect(done.state.hands[0]).toEqual([]);
    expect(done.state.discard.slice(-3)).toEqual(["h3", "h4", "h2"]);
    expect(done.state.bases[0].modules.map(({ card }) => card)).toEqual(["h1"]);
    expect(done.state.turn).toMatchObject({ number: 2, seat: 1 });
  });

  it("R8.5: each Discard is a step of its own", () => {
    const built = build(chooseBox(game([LAIKA, HABITAT, HABITAT, HABITAT]), OUTPOST_BOX), "h1");
    const piles: number[] = [];
    const watching: Registry = {
      handlers: gameRegistry.handlers,
      afterStep: (state, frame) => {
        if (state.turn.number === 1) piles.push(state.hands[0].length);
        return gameRegistry.afterStep(state, frame);
      },
    };
    const one = choose(built.state, "h2", watching);
    choose(one.state, "h3", watching);
    expect([...new Set(piles)]).toEqual([2, 1, 0]);
  });

  it("with no other card in hand ends without a decision or an event", () => {
    const built = build(chooseBox(game([LAIKA]), OUTPOST_BOX), "h1");
    expect(discarded(built.events)).toEqual([]);
    expect(built.state.hands[0]).toEqual([]);
    expect(built.state.turn).toMatchObject({ number: 2, seat: 1 });
  });

  it("a card added to the hand while the action runs is still in hand at the end", () => {
    const start = game([LAIKA, HABITAT, HABITAT, HABITAT]);
    const one = choose(build(chooseBox(start, OUTPOST_BOX), "h1").state, "h2");
    const [top] = one.state.deck;
    // A Draw above the action, as an Influence Discarded by it will cause (R10.7).
    const interrupted = interrupt(one.state, (state) => pushAction(state, { op: "draw", n: 1 }, 0));
    expect(drawn(interrupted.events)).toEqual([top]);
    expect(interrupted.state.hands[0]).toEqual(["h3", "h4", top]);
    // The new card is not offered: it is not in the set.
    expect(interrupted.state.pending).toMatchObject({ seat: 0, kind: "discard" });
    expect(interrupted.state.pending?.options.map(({ id }) => id)).toEqual(["h3", "h4"]);
    const done = choose(interrupted.state, "h3");
    expect(discarded(done.events)).toEqual(["h3", "h4"]);
    expect(done.state.hands[0]).toEqual([top]);
    expect(done.state.turn).toMatchObject({ number: 2, seat: 1 });
  });

  it("a card of the set that has left the hand is skipped", () => {
    const start = game([LAIKA, HABITAT, HABITAT, HABITAT]);
    const asked = build(chooseBox(start, OUTPOST_BOX), "h1").state;
    const interrupted = interrupt(asked, (state) => moveCard(state, "h3", { hand: 0 }, "discard"));
    expect(interrupted.state.pending?.options.map(({ id }) => id)).toEqual(["h2", "h4"]);
    const done = choose(interrupted.state, "h2");
    expect(discarded(done.events)).toEqual(["h2", "h4"]);
    expect(done.state.hands[0]).toEqual([]);
  });

  it("ends when no card of the set is in hand, whatever else the hand holds", () => {
    const start = game([LAIKA, HABITAT, HABITAT]);
    const asked = build(chooseBox(start, OUTPOST_BOX), "h1").state;
    const [top] = asked.deck;
    const interrupted = interrupt(asked, (state) => {
      const emptied = ["h2", "h3"].reduce(
        (moved, card) => moveCard(moved, card, { hand: 0 }, "discard"),
        state,
      );
      return pushAction(emptied, { op: "draw", n: 1 }, 0);
    });
    expect(discarded(interrupted.events)).toEqual([]);
    expect(interrupted.state.hands[0]).toEqual([top]);
    expect(interrupted.state.turn).toMatchObject({ number: 2, seat: 1 });
  });
});

describe("E4: Shackleton's box Build x2, Draw with a Borehole and a Laika Memorial", () => {
  /** Seat 0 chooses the box, Builds the Borehole h1 and defers its text, then Builds h2. */
  function bothBuilt(start: GameState): GameState {
    const borehole = build(chooseBox(start, SHACKLETON_BOX), "h1");
    expect(borehole.state.pending).toMatchObject({ seat: 0, kind: "defer" });
    const deferred = choose(borehole.state, "later");
    expect(deferred.events.map(({ type }) => type)).toEqual(["text_deferred"]);
    const laika = build(deferred.state, "h2");
    expect(laika.state.pending).toMatchObject({ seat: 0, kind: "defer" });
    expect(laika.state.hands[0]).toEqual(start.hands[0].slice(2));
    return laika.state;
  }

  it("both deferred: Draw 1, then Draw 2, then Discard all, and the hand is empty", () => {
    const start = game([BOREHOLE, LAIKA, HABITAT], "stn-shackleton");
    const [first, second, third] = start.deck;
    const deferred = choose(bothBuilt(start), "later");
    // The box's Draw, the Borehole's Draw 2, and only then the Laika text.
    expect(deferred.events.map(({ type }) => type)).toEqual([
      "text_deferred",
      "card_drawn",
      "card_drawn",
      "card_drawn",
    ]);
    expect(drawn(deferred.events)).toEqual([first, second, third]);
    expect(deferred.state.pending).toMatchObject({ seat: 0, kind: "discard" });
    // The set is the hand when the text resolves: the drawn cards are in it.
    expect(deferred.state.pending?.options.map(({ id }) => id)).toEqual([
      "h3",
      first,
      second,
      third,
    ]);
    const one = choose(deferred.state, second);
    const two = choose(one.state, "h3");
    const done = choose(two.state, third);
    expect(discarded([...one.events, ...two.events, ...done.events])).toEqual([
      second,
      "h3",
      third,
      first,
    ]);
    expect(done.state.hands[0]).toEqual([]);
    expect(done.state.deck).toEqual(start.deck.slice(3));
    expect(done.state.turn).toMatchObject({ number: 2, seat: 1 });
  });

  it("Laika at once, Borehole deferred: Discard all, the box's Draw 1, the Borehole's Draw 2", () => {
    const start = game([BOREHOLE, LAIKA, HABITAT, EGREGORE], "stn-shackleton");
    expect(start.deck.length).toBeGreaterThanOrEqual(3);
    const [first, second, third] = start.deck;
    const now = choose(bothBuilt(start), "now");
    expect(now.events).toEqual([]);
    expect(now.state.pending?.options.map(({ id }) => id)).toEqual(["h3", "h4"]);
    const done = choose(now.state, "h4");
    expect(done.events.slice(0, 5).map(({ type }) => type)).toEqual([
      "card_discarded",
      "card_discarded",
      "card_drawn",
      "card_drawn",
      "card_drawn",
    ]);
    expect(discarded(done.events)).toEqual(["h4", "h3"]);
    expect(drawn(done.events)).toEqual([first, second, third]);
    expect(done.state.hands[0]).toEqual([first, second, third]);
    expect(done.state.turn).toMatchObject({ number: 2, seat: 1 });
  });
});
