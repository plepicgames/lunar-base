import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GameView } from "../../protocol/messages.ts";
import type { GameState } from "../connection.ts";
import { buildView } from "../testing/build-fixture.ts";
import { player, view } from "../testing/view-fixture.ts";
import { Table } from "./Table.tsx";

afterEach(() => {
  cleanup();
});

type Pending = NonNullable<GameView["pending"]>;

function mount(gameView: GameView) {
  const onDecide = vi.fn();
  const game: GameState = { game: "g1", seq: 1, view: gameView, events: [], log: [] };
  const result = render(createElement(Table, { game, onDecide, onLeave: vi.fn() }));
  return { onDecide, ...result };
}

/** Ann has a Depot in her hand and a Fusion Reactor and a Depot in her Base; two cards in Supply. */
function withPending(pending: Pending): GameView {
  return view({
    players: [
      player(0, {
        base: {
          ...player(0).base,
          modules: [
            { instance: "m-fr", cardId: "mod-fusion-reactor", x: 1, y: 0, q: 0 },
            { instance: "m-depot", cardId: "mod-depot", x: -1, y: 0, q: 0 },
          ],
        },
      }),
      player(1, {
        base: {
          ...player(1).base,
          modules: [{ instance: "theirs", cardId: "mod-depot", x: 1, y: 0, q: 0 }],
        },
      }),
      player(2, { name: "Cal" }),
    ],
    hand: [{ instance: "c-1", cardId: "mod-depot" }],
    supply: [{ instance: "s-1", cardId: "mod-fusion-reactor" }],
    pending,
  });
}

describe("tab order", () => {
  test("the decision comes first, then hand, Base, Supply, opponents and log", () => {
    mount(withPending({ id: "d5", seat: 0, kind: "something_new", options: [] }));
    const regions = ["Your decision", "Your hand", "Base", "Supply", "Opponents", "Log"].map(
      (name) => screen.getByRole("region", { name }),
    );
    for (let index = 1; index < regions.length; index += 1) {
      const before = regions[index - 1];
      const after = regions[index];
      expect(
        before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${before.getAttribute("aria-label") ?? ""} before ${after.getAttribute("aria-label") ?? ""}`,
      ).toBeTruthy();
    }
  });
});

describe("every option is reachable and named", () => {
  const decisions: [string, Pending][] = [
    [
      "D1 agent",
      {
        id: "d1",
        seat: 0,
        kind: "agent",
        options: [
          { id: "skip", label: "Play no Agent" },
          { id: "a", label: "Play Depot", card: "c-1" },
          { id: "b", label: "Play the card in Play", card: "gone" },
        ],
      },
    ],
    [
      "D2 main action",
      {
        id: "d2",
        seat: 0,
        kind: "main_action",
        options: [
          { id: "station-0:0", label: "Terran Outpost: Draft", card: "station-0", box: 0 },
          { id: "m-fr:0", label: "Fusion Reactor: Build, Draw", card: "m-fr", box: 0 },
        ],
      },
    ],
    [
      "D3 do one",
      {
        id: "d3",
        seat: 0,
        kind: "choose_one",
        options: [
          { id: "0", label: "Draw x2", card: "m-fr" },
          { id: "1", label: "Discard", card: "m-fr" },
        ],
      },
    ],
    [
      "D4 draft",
      {
        id: "d4",
        seat: 0,
        kind: "draft",
        options: [{ id: "s-1", label: "Draft Fusion Reactor", card: "s-1" }],
      },
    ],
    [
      "D5 discard",
      {
        id: "d5",
        seat: 0,
        kind: "discard",
        options: [{ id: "c-1", label: "Discard Depot", card: "c-1" }],
      },
    ],
    [
      "D7 defer",
      {
        id: "d7",
        seat: 0,
        kind: "defer",
        options: [
          { id: "now", label: "Resolve now", card: "m-depot" },
          { id: "later", label: "Resolve later", card: "m-depot" },
        ],
      },
    ],
    [
      "D8 resell",
      {
        id: "d8",
        seat: 0,
        kind: "resell",
        options: [{ id: "s-1", label: "Resell Fusion Reactor", card: "s-1" }],
      },
    ],
    [
      "D9 target",
      {
        id: "d9",
        seat: 0,
        kind: "target",
        options: [
          { id: "0", label: "Player 1 Discards", target: 0 },
          { id: "2", label: "Player 3 Discards", target: 2 },
        ],
      },
    ],
    [
      "D10 flip",
      {
        id: "d10",
        seat: 0,
        kind: "flip",
        options: [
          { id: "0", label: "Flip no Stations", seats: [] },
          { id: "1", label: "Flip Player 2's Station", seats: [1] },
          { id: "2", label: "Flip Player 3's Station", seats: [2] },
        ],
      },
    ],
    [
      "D11 steal Module",
      {
        id: "d11",
        seat: 0,
        kind: "steal_module",
        options: [{ id: "theirs", label: "Steal Depot at 1,0", card: "theirs", target: 1 }],
      },
    ],
  ];

  test.each(decisions)("%s: every button has an accessible name", (_name, pending) => {
    mount(withPending(pending));
    const buttons = screen.getAllByRole("button");
    const named = screen.getAllByRole("button", { name: /\S/ });
    expect(named).toHaveLength(buttons.length);
  });

  test("the Build decision names every button, with a Module and a place picked", () => {
    mount(buildView());
    fireEvent.click(screen.getByRole("button", { name: "Build Depot" }));
    fireEvent.click(screen.getByRole("button", { name: "Place Depot at 1,0" }));
    expect(screen.getAllByRole("button", { name: /\S/ })).toHaveLength(
      screen.getAllByRole("button").length,
    );
  });

  test("an option that no card or player on the table can carry still has a button", () => {
    const { onDecide } = mount(
      withPending({
        id: "d1",
        seat: 0,
        kind: "agent",
        options: [{ id: "x", label: "Play the card in Play", card: "gone" }],
      }),
    );
    const bar = screen.getByRole("region", { name: "Your decision" });
    fireEvent.click(within(bar).getByRole("button", { name: "Play the card in Play" }));
    expect(onDecide).toHaveBeenCalledWith("d1", "x");
  });

  test("a target option without a seat is a button in the bar", () => {
    const { onDecide } = mount(
      withPending({
        id: "d9",
        seat: 0,
        kind: "target",
        options: [{ id: "any", label: "Every player Discards" }],
      }),
    );
    const bar = screen.getByRole("region", { name: "Your decision" });
    fireEvent.click(within(bar).getByRole("button", { name: "Every player Discards" }));
    expect(onDecide).toHaveBeenCalledWith("d9", "any");
  });

  test("an option that is carried elsewhere has no second button in the bar", () => {
    mount(
      withPending({
        id: "d1",
        seat: 0,
        kind: "agent",
        options: [{ id: "a", label: "Play Depot", card: "c-1" }],
      }),
    );
    const bar = screen.getByRole("region", { name: "Your decision" });
    expect(within(bar).queryByRole("button", { name: "Play Depot" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Play Depot" })).toHaveLength(1);
  });
});

describe("dialog focus", () => {
  const choose: Pending = {
    id: "d3",
    seat: 0,
    kind: "choose_one",
    options: [
      { id: "0", label: "Draw x2", card: "m-fr" },
      { id: "1", label: "Discard", card: "m-fr" },
    ],
  };

  test("focus moves in, stays in, and goes back to where it was", () => {
    const before = withPending({ id: "d5", seat: 0, kind: "something_new", options: [] });
    const { rerender } = mount(before);
    const handCard = screen.getByRole("button", { name: "Depot" });
    handCard.focus();
    const asking = (view: GameView): GameState => ({
      game: "g1",
      seq: 2,
      view,
      events: [],
      log: [],
    });
    rerender(
      createElement(Table, {
        game: asking(withPending(choose)),
        onDecide: vi.fn(),
        onLeave: vi.fn(),
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Focus that lands outside, by any means, is pulled back in.
    handCard.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);

    rerender(
      createElement(Table, {
        game: asking(withPending({ id: "d6", seat: 0, kind: "something_new", options: [] })),
        onDecide: vi.fn(),
        onLeave: vi.fn(),
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Depot" }));
  });
});
