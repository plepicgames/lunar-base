import { describe, expect, it } from "vitest";
import { pushAction } from "../actions/index.ts";
import { achievementsOf, colonistsOf, orbsOf } from "../base.ts";
import { ask } from "../decisions.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, push, run, type Registry } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { buildState, cardOfState, type BaseSpec } from "../testing/build.ts";
import { checkVictory, thresholds } from "../victory.ts";
import { viewFor } from "../view.ts";

const outpost: BaseSpec = { station: "stn-shackleton" };
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
function fixture(supply: readonly string[], base: BaseSpec = outpost): GameState {
  const built = buildState([base, outpost]);
  return {
    ...dealGame({ seats: 2, influences: true, kickstarter: false, startingSeat: 0 }, "extra-cost"),
    ...built,
    cards: {
      ...built.cards,
      welfare: "ks-inf-welfare",
      market: "ks-inf-free-market",
      longevity: "ks-inf-longevity",
      alliance: "inf-lunar-alliance",
      quarantine: "inf-quarantine",
      module: "mod-rover-1",
      agent: "agt-investor",
    },
    supply,
    hands: [[], []],
    deck: [],
    discard: [],
    removedStations: [],
    credits: [9, 3],
  };
}
function draft(state: GameState, n = 1) {
  return run(
    push(push(state, "stop"), "box", {
      seat: 0,
      actions: [{ op: "draft", n }],
      position: 0,
      repeated: 0,
      deferred: [],
    }),
    registry,
  );
}
function choose(state: GameState, option: string) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected decision");
  const result = applyChoice(state, { seat: pending.seat, decision: pending.id, option }, registry);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe("R12.6: Influence Draft payment", () => {
  it("combines yellow x3 and red x3 and uses each wild Orb only once, including on itself", () => {
    const start = fixture(["market", "longevity", "alliance", "module"], {
      station: "stn-shackleton",
      modules: [["mod-laika-memorial", 1, 0, 3]],
    });
    expect(orbsOf(start.bases[0], cardOfState(start)).wild).toBe(1);
    const before = structuredClone(start);
    const asked = draft({ ...start, credits: [5, 3] }).state;
    expect(asked.pending?.options).toMatchObject([
      { id: "market", price: 5 },
      { id: "longevity", price: 5 },
      { id: "alliance", price: 5 },
      { id: "module" },
    ]);
    const visible = viewFor(asked, 0).pending;
    if (!visible || !("options" in visible)) throw new Error("Expected visible Draft options");
    expect(visible.options[0]).toMatchObject({ price: 5, label: "Draft Free Market, pay 5" });
    const done = choose(asked, "market");
    expect(done.state.credits).toEqual([0, 3]);
    expect(done.state.hands[0]).toEqual(["market"]);
    expect(done.events).toMatchObject([
      { type: "credits_changed", seat: 0, delta: -5, credits: 0 },
      { type: "card_drafted", card: { instance: "market" } },
    ]);
    expect(start).toEqual(before);
  });

  it("includes Welfare's blue cost and applies coloured Orbs from the current Base", () => {
    const start = fixture(["welfare", "market", "longevity", "module"], {
      station: "stn-shackleton",
      side: "named",
    });
    const asked = draft(start).state;
    expect(asked.pending?.options.slice(0, 3).map(({ price }) => price)).toEqual([7, 7, 7]);
    expect(choose(asked, "welfare").state.credits[0]).toBe(2);
  });

  it("excludes every unaffordable Influence, rejects its choice, and still drafts other cards for free", () => {
    const asked = draft({
      ...fixture(["market", "longevity", "alliance", "module", "agent"]),
      credits: [5, 3],
    }).state;
    expect(asked.pending?.options.map(({ id }) => id)).toEqual(["module", "agent"]);
    const pending = asked.pending;
    if (!pending) throw new Error("Expected Draft decision");
    expect(
      applyChoice(asked, { seat: 0, decision: pending.id, option: "market" }, registry),
    ).toMatchObject({ ok: false, error: { code: "unknown_option" } });
    const done = choose(asked, "agent");
    expect(done.state.credits).toEqual([5, 3]);
    expect(done.events.map(({ type }) => type)).toEqual(["card_drafted"]);
  });

  it("skips when only unaffordable Influences remain", () => {
    const done = draft({ ...fixture(["market", "longevity"]), credits: [5, 3] });
    expect(done.state.pending?.kind).toBe("finished");
    expect(done.state.hands[0]).toEqual([]);
  });

  it("recomputes the cost after each Draft and combines affordability with Quarantine", () => {
    const asked = draft({
      ...fixture(["market", "quarantine", "alliance", "module"]),
      credits: [2, 3],
    }).state;
    expect(asked.pending?.kind).toBe("finished"); // Only the Module is legal, so it is automatic.
    expect(asked.hands[0]).toEqual(["module"]);
    const first = draft(
      { ...fixture(["market", "longevity", "module"]), credits: [9, 3] },
      2,
    ).state;
    const next = choose(first, "market").state;
    expect(next.credits[0]).toBe(3);
    expect(next.pending?.options).toMatchObject([{ id: "longevity", price: 3 }, { id: "module" }]);
    const done = choose(next, "longevity");
    expect(done.state.credits[0]).toBe(0);
    expect(done.state.hands[0]).toEqual(["market", "longevity"]);
  });

  it("checks victory after payment and before moving the drafted Influence", () => {
    const start = { ...fixture(["market", "module"]), credits: [3, 20] };
    // Ask directly so the existing victory is first observed on the payment step.
    const framed = pushAction(start, { op: "draft", n: 1 }, 0);
    const action = framed.stack.at(-1);
    if (!action) throw new Error("Expected Draft action frame");
    const asked = registry.handlers.action(framed, action, null).state;
    const done = choose(asked, "market");
    expect(done.state.result?.winners).toEqual([1]);
    expect(done.state.credits[0]).toBe(0);
    expect(done.state.supply).toContain("market");
    expect(done.state.hands[0]).toEqual([]);
    expect(done.events.map(({ type }) => type)).toEqual(["credits_changed", "game_ended"]);
  });
});

describe("R12.7: live Supply thresholds", () => {
  it("Welfare prevents five achievements winning until its paid Draft lowers the target", () => {
    const start = fixture(["welfare", "module"], {
      station: "stn-selene-labs",
      side: "named",
      modules: [
        ["mod-laika-memorial", -5, 0, 0],
        ["mod-rover-1", -7, 0, 0],
        ["mod-satellite-1", -9, 0, 0],
      ],
    });
    expect(achievementsOf(start.bases[0], cardOfState(start)).size).toBe(5);
    expect(thresholds(start)).toEqual({ credits: 20, colonists: 10, achievements: 6 });
    expect(viewFor(start, null).targets.achievements).toBe(6);
    expect(checkVictory(start).state.result).toBeNull();
    const done = choose(draft(start).state, "welfare");
    expect(done.state.result).toEqual({ reason: "victory", winners: [0], scores: [1, 0] });
    expect(viewFor(done.state, 0).targets.achievements).toBe(5);
    expect(done.events.map(({ type }) => type)).toEqual([
      "credits_changed",
      "card_drafted",
      "game_ended",
    ]);
  });

  it("Longevity requires twelve colonists and stops affecting the target after leaving Supply", () => {
    const start = fixture(["longevity", "welfare"], {
      station: "stn-shackleton",
      side: "named",
      modules: [
        ["mod-indigo-egregore", -5, 0, 0],
        ["mod-underground-headquarters", -7, 0, 0],
        ["mod-inflatable-habitat", -9, 0, 0],
        ["mod-depot", -11, 0, 0],
      ],
    });
    expect(colonistsOf(start.bases[0], cardOfState(start))).toBe(10);
    expect(viewFor(start, null).targets).toEqual({ credits: 20, colonists: 12, achievements: 6 });
    expect(checkVictory(start).state.result).toBeNull();
    const moved = { ...start, supply: ["welfare"], hands: [["longevity"], []] };
    expect(thresholds(moved).colonists).toBe(10);
    expect(checkVictory(moved).state.result?.winners).toEqual([0]);
    const twelve = {
      ...start,
      cards: { ...start.cards, extra: "mod-inflatable-habitat" },
      bases: [
        {
          ...start.bases[0],
          modules: [...start.bases[0].modules, { card: "extra", x: -13, y: 0, q: 0 as const }],
        },
        start.bases[1],
      ],
    };
    expect(colonistsOf(twelve.bases[0], cardOfState(twelve))).toBe(12);
    expect(checkVictory(twelve).state.result?.winners).toEqual([0]);
  });
});
