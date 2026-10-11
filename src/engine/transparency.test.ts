import { describe, expect, test } from "vitest";
import { draft } from "./actions/draft.ts";
import { draw } from "./actions/draw.ts";
import { discardCard } from "./actions/discard.ts";
import { actionHandlers, handlerOf, pushAction, type ActionFrame } from "./actions/index.ts";
import { push, type Step } from "./loop.ts";
import { gameRegistry } from "./game.ts";
import { eventFor, type GameEvent } from "./events.ts";
import { shuffle } from "./rng.ts";
import { dealGame } from "./setup.ts";
import { shuttleDeal } from "./shuttle.ts";
import type { GameState } from "./state.ts";
import { buildState } from "./testing/build.ts";
import { viewFor } from "./view.ts";

const config = { seats: 3, influences: true, kickstarter: true, startingSeat: 0 };
const audiences = [0, 1, 2, null];

function fixture(): GameState {
  const bases = buildState([
    { station: "stn-shackleton" },
    { station: "stn-selene-labs" },
    { station: "stn-imbrium" },
  ]);
  return {
    ...dealGame(config, "transparency"),
    ...bases,
    cards: {
      ...bases.cards,
      c10: "ks-inf-transparency",
      c11: "mod-rover-1",
      c12: "mod-bacon-printer",
      c13: "mod-fusion-reactor",
      c14: "agt-investor",
      c15: "mod-rover-1",
      c16: "mod-bacon-printer",
      c17: "mod-fusion-reactor",
    },
    supply: ["c10"],
    deck: ["c11", "c12"],
    discard: ["c13"],
    hands: [["c14"], [], []],
    removedStations: [],
  };
}

function drawOne(state: GameState) {
  const started = pushAction(state, { op: "draw", n: 1 }, 0);
  return draw(started, started.stack.at(-1) as ActionFrame, null).state;
}

describe("Transparency views (R12.11–R12.16)", () => {
  test("reveals only the top Deck card to every audience without changing Deck order", () => {
    const state = fixture();
    const before = structuredClone(state);
    for (const seat of audiences) {
      const view = viewFor(state, seat);
      expect(view.deck).toBe(2);
      expect(view.deckTop).toEqual({ instance: "c11", cardId: "mod-rover-1" });
      expect(JSON.stringify(view)).not.toContain('"c12"');
    }
    expect(state).toStrictEqual(before);
    const next = drawOne(state);
    expect(next.hands[0]).toEqual(["c14", "c11"]);
    expect(next.deck).toEqual(["c12"]);
    for (const seat of audiences) {
      expect(viewFor(next, seat).deckTop).toEqual({ instance: "c12", cardId: "mod-bacon-printer" });
    }
  });

  test("closes the entire Discard pile for every audience, including its previous owner", () => {
    const state = discardCard(fixture(), 0, "c14").state;
    expect(state.discard).toEqual(["c13", "c14"]);
    for (const seat of audiences) {
      const view = viewFor(state, seat);
      expect(view.discardCount).toBe(2);
      expect(view.discard).toEqual([]);
      expect(JSON.stringify(view)).not.toMatch(/"c13"|"c14"/);
    }
  });

  test("Drafting Transparency opens old and newly Discarded cards and hides the Deck top", () => {
    const state = discardCard(fixture(), 0, "c14").state;
    const started = pushAction(state, { op: "draft", n: 1 }, 1);
    const frame = started.stack.at(-1) as ActionFrame;
    const asked = draft(started, frame, null).state;
    const decision = asked.pending;
    if (!decision) throw new Error("Expected Draft decision");
    const next = draft({ ...asked, pending: null }, frame, {
      decision,
      option: decision.options[0],
    }).state;
    expect(next.supply).toEqual([]);
    expect(next.hands[1]).toEqual(["c10"]);
    for (const seat of audiences) {
      const view = viewFor(next, seat);
      expect(view.deckTop).toBeNull();
      expect(JSON.stringify(view)).not.toMatch(/"c11"|"c12"/);
      expect(view.discardCount).toBe(2);
      expect(view.discard).toEqual([
        { instance: "c13", cardId: "mod-fusion-reactor" },
        { instance: "c14", cardId: "agt-investor" },
      ]);
    }
  });

  test("applies as soon as setup deals Transparency into Supply", () => {
    const state = dealGame(config, "transparency-61");
    expect(state.supply.map((id) => state.cards[id])).toContain("ks-inf-transparency");
    for (const seat of audiences) {
      expect(viewFor(state, seat).deckTop).toEqual({
        instance: state.deck[0],
        cardId: state.cards[state.deck[0]],
      });
    }
  });

  test("a Shuttle deal closes the existing pile immediately when Transparency enters Supply", () => {
    const initial = fixture();
    const state = push(
      {
        ...initial,
        supply: [],
        deck: ["c10", "c11", "c12", "c14", "c15", "c16", "c17"],
        hands: [[], [], []],
      },
      "shuttle_deal",
    );
    expect(viewFor(state, null).discard).toHaveLength(1);
    const frame = state.stack.at(-1);
    if (!frame) throw new Error("Expected Shuttle deal frame");
    const next = shuttleDeal(state, frame, null).state;
    expect(next.supply).toContain("c10");
    for (const seat of audiences) {
      expect(viewFor(next, seat).discard).toEqual([]);
      expect(viewFor(next, seat).discardCount).toBe(1);
      expect(viewFor(next, seat).deckTop).toEqual({
        instance: "c17",
        cardId: "mod-fusion-reactor",
      });
    }
  });

  test("reveals the new top after a reshuffle and Draw without revealing the rest", () => {
    const state = { ...fixture(), deck: [], discard: ["c11", "c12", "c13"] };
    const shuffled = shuffle(state.rng, state.discard).list;
    const next = drawOne(state);
    expect(next.deck).toEqual(shuffled.slice(1));
    for (const seat of audiences) {
      const view = viewFor(next, seat);
      expect(view.deckTop).toEqual({ instance: shuffled[1], cardId: state.cards[shuffled[1]] });
      expect(JSON.stringify(view)).not.toContain(`"${shuffled[2]}"`);
      expect(view.discardCount).toBe(0);
    }
  });

  test("an empty Deck has no top card, even under Transparency", () => {
    for (const seat of audiences) {
      const view = viewFor({ ...fixture(), deck: [], discard: [] }, seat);
      expect(view.deck).toBe(0);
      expect(view.deckTop).toBeNull();
      expect(view.discardCount).toBe(0);
    }
  });
});

function action(state: GameState, op: "draw" | "draft" | "resell") {
  const started = pushAction(state, { op, n: 1 }, 0);
  return handlerOf(actionHandlers, { op, n: 1 })(
    started,
    started.stack.at(-1) as ActionFrame,
    null,
  );
}

function chooseCard(state: GameState, option: string) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected card decision");
  const frame = state.stack.at(-1) as ActionFrame;
  const selected = pending.options.find(({ id }) => id === option);
  if (!selected) throw new Error("Missing card option");
  return handlerOf(actionHandlers, frame.action)({ ...state, pending: null }, frame, {
    decision: pending,
    option: selected,
  });
}

function eventOf(step: Step, type: GameEvent["type"]): GameEvent {
  const event = step.events?.find((event) => event.type === type);
  if (!event) throw new Error(`Missing ${type}`);
  return event;
}

describe("Transparency events (T092)", () => {
  test("start: a Shuttle deal makes subsequent Draws public, preserving earlier private Draws", () => {
    const initial = fixture();
    const before = action({ ...initial, supply: [] }, "draw");
    const privateDraw = eventOf(before, "card_drawn");
    const dealing = push(
      {
        ...before.state,
        deck: ["c10", "c12", "c15", "c16", "c17", "c14", "c13"],
        hands: [["c11"], [], []],
        discard: [],
      },
      "shuttle_deal",
    );
    const dealFrame = dealing.stack.at(-1);
    if (!dealFrame) throw new Error("Expected Shuttle deal frame");
    const entered = shuttleDeal(dealing, dealFrame, null).state;
    expect(entered.supply).toContain("c10");
    const drawn = action(entered, "draw");
    for (const seat of audiences) {
      expect(eventFor(eventOf(drawn, "card_drawn"), seat)).toEqual({
        type: "card_drawn",
        seat: 0,
        card: { instance: "c13", cardId: "mod-fusion-reactor" },
        text: "Player 1 drew Fusion Reactor.",
      });
      if (seat !== 0) expect(eventFor(privateDraw, seat)).not.toHaveProperty("card");
    }
    const setup = dealGame(config, "transparency-61");
    expect(setup.supply.map((id) => setup.cards[id])).toContain("ks-inf-transparency");
    const fromSetup = eventOf(action(setup, "draw"), "card_drawn");
    for (const seat of audiences) expect(eventFor(fromSetup, seat)).toHaveProperty("card");
  });

  test("hand Discard: only its owner sees the card under Transparency (R12.13)", () => {
    const initial = fixture();
    for (const active of [false, true]) {
      const state = { ...initial, supply: active ? ["c10"] : [] };
      const discarded = discardCard(state, 0, "c14");
      const event = eventOf(discarded, "card_discarded");
      for (const seat of audiences) {
        expect(eventFor(event, seat)).toEqual(
          active && seat !== 0
            ? {
                type: "card_discarded",
                seat: 0,
                text: "Player 1 discarded a card.",
              }
            : {
                type: "card_discarded",
                seat: 0,
                card: { instance: "c14", cardId: "agt-investor" },
                text: "Player 1 discarded Investor.",
              },
        );
      }
    }
  });

  test("Influence Discard: shows the Influence to all even though the pile hides it", () => {
    const initial = fixture();
    const state = { ...initial, cards: { ...initial.cards, c14: "inf-lunar-alliance" } };
    const discarded = discardCard(state, 0, "c14");
    const event = eventOf(discarded, "card_discarded");
    for (const seat of audiences) {
      expect(eventFor(event, seat)).toMatchObject({
        card: { instance: "c14", cardId: "inf-lunar-alliance" },
        text: "Player 1 discarded Lunar Alliance.",
      });
      expect(viewFor(discarded.state, seat).discard).toEqual([]);
    }
  });

  test("Resell: Resold cards and resolved Agents stay public in events, hidden in the pile", () => {
    const initial = fixture();
    const offered = action({ ...initial, supply: ["c10", "c15"] }, "resell");
    const resold = chooseCard(offered.state, "c15");
    const resolving = push({ ...resold.state, hands: [[], [], []], play: ["c14"] }, "agent", {
      seat: 0,
      card: "c14",
      actions: [],
      position: 0,
      repeated: 0,
      deferred: [],
    });
    const agentFrame = resolving.stack.at(-1);
    if (!agentFrame) throw new Error("Expected Agent frame");
    const resolved = gameRegistry.handlers.agent(resolving, agentFrame, null);
    for (const seat of audiences) {
      expect(eventFor(eventOf(resold, "card_resold"), seat)).toMatchObject({
        card: { instance: "c15", cardId: "mod-rover-1" },
        credits: 1,
      });
      expect(eventFor(eventOf(resolved, "agent_discarded"), seat)).toMatchObject({
        card: { instance: "c14", cardId: "agt-investor" },
      });
      expect(viewFor(resolved.state, seat).discard).toEqual([]);
      expect(viewFor(resolved.state, seat).discardCount).toBe(3);
    }
  });

  test("reshuffle: Draw from the newly shuffled Deck is public without exposing its order", () => {
    const drawn = action({ ...fixture(), deck: [], discard: ["c11", "c12", "c13"] }, "draw");
    expect(drawn.events?.map(({ type }) => type)).toEqual(["deck_reshuffled", "card_drawn"]);
    const instance = drawn.state.hands[0].at(-1);
    if (!instance) throw new Error("Expected drawn card");
    for (const seat of audiences) {
      expect(eventFor(eventOf(drawn, "card_drawn"), seat)).toMatchObject({
        card: { instance, cardId: drawn.state.cards[instance] },
      });
      expect(eventFor(eventOf(drawn, "deck_reshuffled"), seat)).toEqual({
        type: "deck_reshuffled",
        count: 3,
        text: "The Deck was reshuffled with 3 cards.",
      });
      expect(viewFor(drawn.state, seat).deckTop?.instance).toBe(drawn.state.deck[0]);
      expect(JSON.stringify(viewFor(drawn.state, seat))).not.toContain(`"${drawn.state.deck[1]}"`);
    }
  });

  test("end: hidden Discard history stays hidden when the pile opens and Draws become private", () => {
    const discarded = discardCard(fixture(), 0, "c14");
    const hiddenDiscard = eventOf(discarded, "card_discarded");
    const publicDraw = action(discarded.state, "draw");
    const histories = audiences.map((seat) => [
      eventFor(hiddenDiscard, seat),
      eventFor(eventOf(publicDraw, "card_drawn"), seat),
    ]);
    const snapshot = structuredClone(histories);
    const drafted = chooseCard(action(publicDraw.state, "draft").state, "c10");
    expect(drafted.state.supply).toEqual([]);
    const privateDraw = eventOf(action(drafted.state, "draw"), "card_drawn");
    for (const [index, seat] of audiences.entries()) {
      expect(viewFor(drafted.state, seat).discard).toContainEqual({
        instance: "c14",
        cardId: "agt-investor",
      });
      expect(histories[index]).toEqual(snapshot[index]);
      expect(eventFor(hiddenDiscard, seat)).toEqual(histories[index][0]);
      expect(eventFor(eventOf(publicDraw, "card_drawn"), seat)).toEqual(histories[index][1]);
      if (seat !== 0) {
        expect(histories[index][0]).toEqual({
          type: "card_discarded",
          seat: 0,
          text: "Player 1 discarded a card.",
        });
        expect(eventFor(privateDraw, seat)).toEqual({
          type: "card_drawn",
          seat: 0,
          text: "Player 1 drew a card.",
        });
      }
    }
  });
});
