import { describe, expect, it } from "vitest";
import { deckCards } from "../catalogue.ts";
import { eventFor } from "../events.ts";
import { gameRegistry } from "../game.ts";
import { applyChoice, run } from "../loop.ts";
import { dealGame } from "../setup.ts";
import type { GameState } from "../state.ts";
import { buildState } from "../testing/build.ts";
import { pushTurn } from "../turn.ts";
import { viewFor } from "../view.ts";

const config = { seats: 3, influences: false, kickstarter: false, startingSeat: 0 };
function game(seats = 3, empty = false): GameState {
  const bases = buildState(Array.from({ length: seats }, () => ({ station: "stn-shackleton" })));
  return run(
    pushTurn({
      ...dealGame({ ...config, seats }, "look-hand"),
      ...bases,
      cards: {
        ...bases.cards,
        spy: "agt-spybot-py",
        spy2: "agt-spybot-py",
        a: "mod-inflatable-habitat",
        b: "mod-bacon-printer",
        c: "mod-rover-1",
        d: "mod-fusion-reactor",
      },
      hands: [["spy", "spy2"], empty ? [] : ["a", "b"], ...(seats === 3 ? [["c"]] : [])],
      credits: Array.from({ length: seats }, () => 0),
      deck: ["d"],
      supply: [],
      discard: [],
      removedStations: [],
    }),
    gameRegistry,
  ).state;
}
function choose(state: GameState, option: string) {
  const pending = state.pending;
  if (!pending) throw new Error("Expected decision");
  const result = applyChoice(
    state,
    { seat: pending.seat, decision: pending.id, option },
    gameRegistry,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result;
}
const cards = [
  { instance: "a", cardId: "mod-inflatable-habitat" },
  { instance: "b", cardId: "mod-bacon-printer" },
];

describe("R7.15 Look at an opponent's hand", () => {
  it("admits Spybot.py to the Deck", () => {
    expect(deckCards(config).filter((id) => id === "agt-spybot-py")).toHaveLength(2);
  });

  it("offers only opponents and reveals identities only in the looker's event", () => {
    const start = game();
    const before = structuredClone(start);
    const targeting = choose(start, "spy").state;
    expect(targeting.pending).toMatchObject({ seat: 0, kind: "target" });
    expect(targeting.pending?.options.map(({ target }) => target)).toEqual([1, 2]);
    const looked = choose(targeting, "1");
    const event = looked.events.find((event) => event.type === "hand_seen");
    expect(event).toEqual({ type: "hand_seen", looker: 0, opponent: 1, cards });
    if (!event) throw new Error("Expected hand seen");
    expect(eventFor(event, 0)).toMatchObject({ type: "hand_seen", looker: 0, opponent: 1, cards });
    for (const seat of [1, 2, null]) {
      expect(eventFor(event, seat)).toEqual({
        type: "hand_seen",
        looker: 0,
        opponent: 1,
        text: "Player 1 looked at Player 2's hand.",
      });
    }
    const view = viewFor(looked.state, 0);
    expect(view.hand).toEqual([{ instance: "spy2", cardId: "agt-spybot-py" }]);
    expect(view.players[1].handSize).toBe(2);
    const swapped = { ...looked.state, hands: [["spy2"], ["c", "d"], ["a"]] };
    expect(viewFor(swapped, 0)).toEqual(view);
    expect(looked.state.stack.find((frame) => frame.kind === "agent")).toMatchObject({
      opponent: 1,
    });
    expect(looked.state.pending?.options.map(({ label }) => label)).toEqual([
      "Draw",
      "That opponent Discards",
    ]);
    expect(start).toEqual(before);
  });

  it("R7.16 makes the looked-at opponent choose the Discard and forgets the target on the next Agent", () => {
    const looked = choose(choose(game(), "spy").state, "1");
    const discarding = choose(looked.state, "1").state;
    expect(discarding.pending).toMatchObject({ seat: 1, kind: "discard" });
    expect(discarding.pending?.options.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(discarding.turn.seat).toBe(0);
    const done = choose(discarding, "b");
    expect(done.state.hands).toEqual([["spy2"], ["a"], ["c"]]);
    expect(done.events).toContainEqual({ type: "card_discarded", seat: 1, card: cards[1] });
    const second = choose(choose(done.state, "spy2").state, "2");
    expect(second.events).toContainEqual({
      type: "hand_seen",
      looker: 0,
      opponent: 2,
      cards: [{ instance: "c", cardId: "mod-rover-1" }],
    });
    const finished = choose(second.state, "1");
    expect(finished.state.hands).toEqual([[], ["a"], []]);
  });

  it("Draw adds one card to the looker's hand without discarding from the opponent", () => {
    const looked = choose(choose(game(), "spy").state, "1");
    const drawn = choose(looked.state, "0");
    expect(drawn.state.hands).toEqual([["spy2", "d"], ["a", "b"], ["c"]]);
    expect(drawn.events).toContainEqual({
      type: "card_drawn",
      seat: 0,
      card: { instance: "d", cardId: "mod-fusion-reactor" },
    });
  });

  it("automatically looks at the sole opponent even with an empty hand, then skips its Discard", () => {
    const looked = choose(game(2, true), "spy");
    expect(looked.events).toContainEqual({ type: "hand_seen", looker: 0, opponent: 1, cards: [] });
    expect(looked.state.pending?.kind).toBe("choose_one");
    const done = choose(looked.state, "1");
    expect(done.state.pending?.kind).toBe("agent");
    expect(done.events.some((event) => event.type === "card_discarded")).toBe(false);
  });
});
