import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GameView } from "../../protocol/messages.ts";
import type { GameState } from "../connection.ts";
import { player, view } from "../testing/view-fixture.ts";
import { Table } from "./Table.tsx";

afterEach(() => {
  cleanup();
});

type Pending = NonNullable<GameView["pending"]>;

/** Ann's Base: a Terran Outpost and a Fusion Reactor; a Depot in her hand. */
function withPending(pending: Pending): GameView {
  const base = {
    station: {
      instance: "station-0",
      cardId: "stn-terran-outpost",
      side: "terran_outpost" as const,
      named: null,
      revealed: false,
    },
    modules: [
      { instance: "m-fr", cardId: "mod-fusion-reactor", x: 1, y: 0, q: 0 as const },
      { instance: "m-depot", cardId: "mod-depot", x: -1, y: 0, q: 0 as const },
    ],
    orbs: { red: 0, blue: 0, yellow: 0, wild: 0 },
  };
  return view({
    players: [player(0, { base }), player(1)],
    hand: [{ instance: "c-1", cardId: "mod-depot" }],
    pending,
  });
}

function mount(gameView: GameView) {
  const onDecide = vi.fn();
  const game: GameState = { game: "g1", seq: 1, view: gameView, events: [], log: [] };
  render(createElement(Table, { game, onDecide, onLeave: vi.fn() }));
  return onDecide;
}

const mainAction: Pending = {
  id: "d2",
  seat: 0,
  kind: "main_action",
  options: [
    { id: "station-0:0", label: "Terran Outpost: Draft", card: "station-0", box: 0 },
    { id: "station-0:1", label: "Terran Outpost: Build", card: "station-0", box: 1 },
    { id: "station-0:2", label: "Terran Outpost: Resell x2, Draw", card: "station-0", box: 2 },
    { id: "m-fr:0", label: "Fusion Reactor: Build, Draw, Discard", card: "m-fr", box: 0 },
  ],
};

describe("D2 Main Action box", () => {
  test("lists the boxes grouped by card with its image; a press sends the option", () => {
    const onDecide = mount(withPending(mainAction));
    const bar = screen.getByRole("region", { name: "Your decision" });
    expect(within(bar).getAllByRole("button")).toHaveLength(4);

    const station = within(bar).getByRole("group", { name: "Terran Outpost" });
    expect(within(station).getAllByRole("button")).toHaveLength(3);
    expect(within(station).getByRole("img", { name: "Terran Outpost" })).toBeTruthy();
    const reactor = within(bar).getByRole("group", { name: "Fusion Reactor" });
    expect(within(reactor).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(
      within(reactor).getByRole("button", { name: "Fusion Reactor: Build, Draw, Discard" }),
    );
    expect(onDecide).toHaveBeenCalledWith("d2", "m-fr:0");
  });

  test("highlights exactly the cards of your Base that have a box", () => {
    mount(withPending(mainAction));
    const cards = within(screen.getByRole("region", { name: "Base" })).getAllByTestId("base-card");
    const marked = cards.filter((card) => card.hasAttribute("data-highlighted"));
    expect(marked.map((card) => within(card).getByRole("img").getAttribute("alt"))).toEqual([
      "Terran Outpost",
      "Fusion Reactor",
    ]);
    expect(cards).toHaveLength(3);
  });

  test("nothing is highlighted while another seat decides", () => {
    mount(withPending({ seat: 1, kind: "main_action" }));
    expect(document.querySelectorAll("[data-highlighted]")).toHaveLength(0);
  });
});

describe("D3 do one", () => {
  const choose: Pending = {
    id: "d3",
    seat: 0,
    kind: "choose_one",
    options: [
      { id: "0", label: "Draw x2", card: "m-fr" },
      { id: "1", label: "Discard", card: "m-fr" },
    ],
  };

  test("a dialog shows the card and one button per option, with focus inside", () => {
    const onDecide = mount(withPending(choose));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "Fusion Reactor" })).toBeTruthy();
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(onDecide).toHaveBeenCalledWith("d3", "1");
  });

  test("a card in the hand is found too", () => {
    mount(
      withPending({
        id: "d3",
        seat: 0,
        kind: "choose_one",
        options: [{ id: "0", label: "Draw x2", card: "c-1" }],
      }),
    );
    expect(within(screen.getByRole("dialog")).getByRole("img", { name: "Depot" })).toBeTruthy();
  });

  test("with no card named, the dialog still has its buttons", () => {
    mount(
      withPending({
        id: "d3",
        seat: 0,
        kind: "choose_one",
        options: [{ id: "0", label: "Draw x2" }],
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("img")).toBeNull();
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
  });

  test("another seat's choice has no dialog", () => {
    mount(withPending({ seat: 1, kind: "choose_one" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("D7 resolve now or later", () => {
  const defer: Pending = {
    id: "d9",
    seat: 0,
    kind: "defer",
    options: [
      { id: "now", label: "Resolve the text of Depot now", card: "m-depot" },
      { id: "later", label: "Resolve the text of Depot after the current card", card: "m-depot" },
    ],
  };

  test("a dialog shows the built Module and two buttons, each sending its option", () => {
    const onDecide = mount(withPending(defer));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "Depot" })).toBeTruthy();
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Resolve the text of Depot now",
      "Resolve the text of Depot after the current card",
    ]);
    fireEvent.click(buttons[0]);
    expect(onDecide).toHaveBeenCalledWith("d9", "now");
    fireEvent.click(buttons[1]);
    expect(onDecide).toHaveBeenLastCalledWith("d9", "later");
  });
});

describe("Other decision kinds", () => {
  test("an unknown kind keeps the generic buttons and shows no dialog", () => {
    const onDecide = mount(
      withPending({
        id: "d5",
        seat: 0,
        kind: "something_new",
        options: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const bar = screen.getByRole("region", { name: "Your decision" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Alpha", "Beta"]);
    fireEvent.click(within(bar).getByRole("button", { name: "Beta" }));
    expect(onDecide).toHaveBeenCalledWith("d5", "b");
  });
});

describe("Target decisions", () => {
  test("D9 marks only offered players, including yourself, and sends the chosen option", () => {
    const onDecide = mount(
      view({
        players: [player(0), player(1), player(2, { name: "Cal" })],
        pending: {
          id: "target",
          seat: 0,
          kind: "target",
          options: [
            { id: "0", label: "Player 1 Discards", target: 0 },
            { id: "2", label: "Player 3 Discards", target: 2 },
          ],
        },
      }),
    );
    const strip = screen.getByRole("region", { name: "Opponents" });
    expect(within(strip).getByRole("button", { name: "Player 1 Discards" })).toBeTruthy();
    expect(within(strip).getByRole("button", { name: "Player 3 Discards" })).toBeTruthy();
    expect(within(strip).queryByRole("button", { name: "Player 2 Discards" })).toBeNull();
    fireEvent.click(within(strip).getByRole("button", { name: "Player 3 Discards" }));
    expect(onDecide).toHaveBeenCalledWith("target", "2");
  });

  test("D10 toggles two of three Stations and maps both that set and empty to options", () => {
    const options = Array.from({ length: 8 }, (_, mask) => ({
      id: String(mask),
      label:
        mask === 0
          ? "Flip no Stations"
          : `Flip ${[0, 1, 2]
              .filter((seat) => mask & (1 << seat))
              .map((seat) => `Player ${String(seat + 1)}'s Station`)
              .join(", ")}`,
      seats: [0, 1, 2].filter((seat) => mask & (1 << seat)),
    }));
    const onDecide = mount(
      view({
        players: [player(0), player(1), player(2, { name: "Cal" })],
        pending: { id: "flip", seat: 0, kind: "flip", options },
      }),
    );
    const bar = screen.getByRole("region", { name: "Your decision" });
    fireEvent.click(within(bar).getByRole("button", { name: "Confirm Stations" }));
    expect(onDecide).toHaveBeenLastCalledWith("flip", "0");
    fireEvent.click(screen.getByRole("button", { name: "Player 1's Station" }));
    fireEvent.click(screen.getByRole("button", { name: "Player 3's Station" }));
    expect(
      screen.getByRole("button", { name: "Player 3's Station" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Player 2's Station" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("region", { name: "Opponents" }).querySelectorAll("[data-targeted]"),
    ).toHaveLength(3);
    fireEvent.click(within(bar).getByRole("button", { name: "Confirm Stations" }));
    expect(onDecide).toHaveBeenLastCalledWith("flip", "5");
  });

  test("D10 one Station uses the engine label as the button name", () => {
    const onDecide = mount(
      view({
        players: [player(0), player(1)],
        pending: {
          id: "flip-one",
          seat: 0,
          kind: "flip",
          options: [
            { id: "1", label: "Flip Player 1's Station", seats: [0] },
            { id: "2", label: "Flip Player 2's Station", seats: [1] },
          ],
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Flip Player 2's Station" }));
    expect(onDecide).toHaveBeenCalledWith("flip-one", "2");
  });

  test("D11 focuses the first candidate Base and its Module sends its named option", () => {
    const onDecide = mount(
      view({
        players: [
          player(0),
          player(1, {
            base: {
              ...player(1).base,
              modules: [{ instance: "candidate", cardId: "mod-depot", x: 1, y: 0, q: 0 }],
            },
          }),
          player(2, { name: "Cal" }),
        ],
        pending: {
          id: "steal",
          seat: 0,
          kind: "steal_module",
          options: [
            {
              id: "candidate",
              label: "Steal Depot at 1,0 from Player 2",
              card: "candidate",
              target: 1,
            },
          ],
        },
      }),
    );
    expect(screen.getByRole("heading", { name: "Bea's Base" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Your Base" }));
    expect(screen.getByRole("heading", { name: "Your Base" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View Bea's Base" }));
    const base = screen.getByRole("region", { name: "Base" });
    fireEvent.click(within(base).getByRole("button", { name: "Steal Depot at 1,0 from Player 2" }));
    expect(onDecide).toHaveBeenCalledWith("steal", "candidate");
  });
});
