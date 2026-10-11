import { describe, expect, it } from "vitest";
import { pushAction } from "../actions/index.ts";
import { ask } from "../decisions.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";

const registry: Registry = {
  ...gameRegistry,
  handlers: {
    ...gameRegistry.handlers,
    stop: (state) => ({
      state: ask(state, {
        seat: 0,
        kind: "finished",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
    }),
  },
};

function fixture(supply: readonly string[], hand: readonly string[] = []): GameState {
  const dealt = dealGame(
    { seats: 3, influences: true, kickstarter: false, startingSeat: 0 },
    "influence-triggers",
  );
  return {
    ...dealt,
    cards: {
      ...dealt.cards,
      cowboy: "inf-space-cowboy-capitalism",
      bureaucracy: "inf-runaway-bureaucracy",
      paradise: "inf-laikas-paradise",
      alliance: "inf-lunar-alliance",
      embargo: "inf-terran-embargo",
      memorial: "mod-laika-memorial",
      satellite: "mod-satellite-1",
      X: "mod-inflatable-habitat",
      Y: "mod-inflatable-habitat",
      Z: "mod-inflatable-habitat",
      chandrasekhar: "mod-chandrasekhar-dome",
      hayashi: "mod-hayashi-dome",
      oort: "mod-oort-dome",
      struve: "mod-struve-dome",
    },
    supply,
    hands: [[], hand, []],
    deck: [],
    discard: [],
    credits: [6, 6, 6],
  };
}

function choose(state: GameState, option: string) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, registry);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function build(start: GameState, card: string) {
  const asked = run(pushAction(push(start, "stop"), { op: "build", n: 1 }, 1), registry);
  const option = asked.state.pending?.options.find((option) => option.card === card);
  if (!option) throw new Error(`Expected Build of ${card}`);
  return choose(asked.state, option.id);
}

function draft(start: GameState, card: string) {
  const asked = run(pushAction(push(start, "stop"), { op: "draft", n: 1 }, 1), registry);
  return choose(asked.state, card);
}

describe("R10.9: Influence Draft triggers", () => {
  it("Drafting Space Cowboy itself puts it in hand before the drafter Steals 2", () => {
    const start = fixture(["cowboy", "X"]);
    const before = structuredClone(start);
    const drafted = draft(start, "cowboy");
    expect(drafted.state.hands[1]).toEqual(["cowboy"]);
    expect(drafted.state.supply).toEqual(["X"]);
    expect(drafted.state.pending).toMatchObject({ seat: 1, kind: "target" });
    expect(drafted.events.map(({ type }) => type)).toEqual(["card_drafted"]);
    const done = choose(drafted.state, "2");
    expect(done.state.credits).toEqual([6, 8, 4]);
    expect(done.events).toEqual([{ type: "credits_stolen", thief: 1, victim: 2, amount: 2 }]);
    expect(done.state.pending?.kind).toBe("finished");
    expect(start).toEqual(before);
    expect(draft(structuredClone(start), "cowboy")).toEqual(drafted);
  });

  it.each(["cowboy", "bureaucracy"])(
    "D13: active player orders %s first, but the drafter resolves both effects once",
    (first) => {
      const drafted = draft(fixture(["cowboy", "bureaucracy", "embargo"], ["X", "Y"]), "embargo");
      expect(drafted.state.pending).toMatchObject({ seat: 0, kind: "order" });
      expect(drafted.state.hands[1]).toEqual(["X", "Y", "embargo"]);
      const option = drafted.state.pending?.options.find(({ card }) => card === first);
      if (!option) throw new Error("Expected effect option");
      let next = choose(drafted.state, option.id);
      if (first === "cowboy") {
        expect(next.state.pending).toMatchObject({ seat: 1, kind: "target" });
        next = choose(next.state, "2");
      }
      expect(next.state.pending).toMatchObject({ seat: 1, kind: "discard" });
      next = choose(next.state, "embargo");
      expect(next.state.pending).toMatchObject({ seat: 1, kind: "discard" });
      next = choose(next.state, "X");
      if (first === "bureaucracy") {
        expect(next.state.pending).toMatchObject({ seat: 1, kind: "target" });
        next = choose(next.state, "2");
      }
      expect(next.state.pending?.kind).toBe("finished");
      expect(next.state.hands[1]).toEqual(["Y"]);
      expect(next.state.discard).toEqual(["embargo", "X"]);
      expect(next.state.credits).toEqual([6, 8, 4]);
    },
  );

  it("Drafting Runaway Bureaucracy itself still Discards it from an otherwise empty hand", () => {
    const done = draft(fixture(["bureaucracy", "X"]), "bureaucracy");
    expect(done.events.map(({ type }) => type)).toEqual(["card_drafted", "card_discarded"]);
    expect(done.state.hands[1]).toEqual([]);
    expect(done.state.discard).toEqual(["bureaucracy"]);
    expect(done.state.pending?.kind).toBe("finished");
  });

  it("Lunar Alliance blocks the triggered Steal without a target decision", () => {
    const done = draft(fixture(["cowboy", "alliance", "X"]), "cowboy");
    expect(done.state.credits).toEqual([6, 6, 6]);
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.events).toMatchObject([
      { type: "card_drafted" },
      { type: "action_blocked", seat: 1, action: "steal_credits", card: { instance: "alliance" } },
    ]);
  });

  it("Drafting Lunar Alliance removes its prohibition before the triggered Steal", () => {
    const drafted = draft(fixture(["cowboy", "alliance", "X"]), "alliance");
    expect(drafted.state.pending).toMatchObject({ seat: 1, kind: "target" });
    expect(choose(drafted.state, "2").state.credits).toEqual([6, 8, 4]);
  });

  it("does not trigger for a Module Draft or an Influence Draw", () => {
    const start = fixture(["cowboy", "bureaucracy", "X"]);
    expect(draft(start, "X").state.pending?.kind).toBe("finished");
    const drawn = run(
      pushAction(push({ ...start, deck: ["embargo"] }, "stop"), { op: "draw", n: 1 }, 1),
      registry,
    );
    expect(drawn.state.hands[1]).toEqual(["embargo"]);
    expect(drawn.events.map(({ type }) => type)).toEqual(["card_drawn"]);
    expect(drawn.state.pending?.kind).toBe("finished");
  });
});

describe("R10.8: Influence Build triggers", () => {
  it.each(["chandrasekhar", "hayashi", "oort", "struve"])(
    "building %s Drafts before the opponent Resells twice",
    (dome) => {
      const built = build(fixture(["paradise", "X", "Y", "Z"], [dome]), dome);
      expect(built.state.bases[1].modules.map(({ card }) => card)).toEqual([dome]);
      expect(built.state.pending).toMatchObject({ seat: 1, kind: "draft" });
      expect(built.events.map(({ type }) => type)).toEqual(["credits_changed", "module_built"]);
      const drafted = choose(built.state, "X");
      expect(drafted.state.hands[1]).toEqual(["X"]);
      expect(drafted.state.pending).toMatchObject({ seat: 1, kind: "target" });
      const opponent = choose(drafted.state, "2");
      expect(opponent.state.pending).toMatchObject({ seat: 2, kind: "resell" });
      const done = choose(opponent.state, "Y");
      expect(done.events.map(({ type }) => type)).toEqual(["card_resold", "card_resold"]);
      expect(done.state.credits).toEqual([6, 3, 8]);
      expect(done.state.supply).toEqual(["paradise"]);
      expect(done.state.pending?.kind).toBe("finished");
    },
  );

  it("Memorial Drafts before its Discard-all snapshot, including the newly Drafted card", () => {
    const built = build(fixture(["paradise", "X"], ["memorial"]), "memorial");
    expect(built.state.pending).toMatchObject({ seat: 1, kind: "draft" });
    const done = choose(built.state, "X");
    expect(done.events.map(({ type }) => type)).toEqual(["card_drafted", "card_discarded"]);
    expect(done.state.hands[1]).toEqual([]);
    expect(done.state.discard).toEqual(["X"]);
    expect(done.state.pending?.kind).toBe("finished");
  });

  it("Laika's Draft and its Influence trigger finish before D7 can defer the Dome text", () => {
    const start = fixture(["paradise", "cowboy", "X"], ["oort"]);
    const asked = run(
      push(push(start, "stop"), "box", {
        seat: 1,
        actions: [
          { op: "build", n: 1 },
          { op: "draw", n: 1 },
        ],
        position: 0,
        repeated: 0,
        deferred: [],
      }),
      registry,
    );
    const option = asked.state.pending?.options.find(({ card }) => card === "oort");
    if (!option) throw new Error("Expected Dome Build");
    const built = choose(asked.state, option.id);
    expect(built.state.pending?.kind).toBe("draft");
    const drafted = choose(built.state, "cowboy");
    expect(drafted.state.pending).toMatchObject({ seat: 1, kind: "target" });
    const stolen = choose(drafted.state, "2");
    expect(stolen.state.pending).toMatchObject({ seat: 1, kind: "defer" });
    const deferred = choose(stolen.state, "later");
    expect(deferred.state.pending).toMatchObject({ seat: 1, kind: "target" });
    expect(deferred.events.map(({ type }) => type)).toEqual(["text_deferred"]);
  });

  it("does not Draft for another Module or a Paradise held in hand", () => {
    const other = build(fixture(["paradise", "X"], ["Y"]), "Y");
    expect(other.state.pending?.kind).toBe("finished");
    const held = build(fixture(["X", "Y"], ["paradise", "oort"]), "oort");
    expect(held.state.pending).toMatchObject({ seat: 1, kind: "target" });
  });

  it("R7.18: a Satellite with two Supply Influences Resells twice", () => {
    const built = build(
      fixture(["paradise", "embargo", "X", "Y", "Z"], ["satellite"]),
      "satellite",
    );
    expect(built.state.pending).toMatchObject({ seat: 1, kind: "resell" });
    const first = choose(built.state, "X");
    expect(first.state.pending).toMatchObject({ seat: 1, kind: "resell" });
    const done = choose(first.state, "Y");
    expect(done.state.supply).toEqual(["paradise", "embargo", "Z"]);
    expect(done.state.credits).toEqual([6, 6, 6]);
    expect(done.state.pending?.kind).toBe("finished");
  });
});
