import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GameState } from "../connection.ts";
import { player, view } from "../testing/view-fixture.ts";
import { fanStep, HAND_CARD_WIDTH } from "./Hand.tsx";
import { Table } from "./Table.tsx";

type View = ReturnType<typeof view>;
type Pending = NonNullable<View["pending"]>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(gameView: View) {
  const onDecide = vi.fn();
  const game: GameState = { game: "g1", seq: 1, view: gameView, events: [], log: [] };
  render(createElement(Table, { game, onDecide, onLeave: vi.fn() }));
  return onDecide;
}

const ann = player(0);
const bea = player(1);
const supply = [
  { instance: "s-1", cardId: "mod-depot" },
  { instance: "s-2", cardId: "mod-depot" },
  { instance: "s-3", cardId: "mod-depot" },
];
const hand = [
  { instance: "h-1", cardId: "mod-depot" },
  { instance: "h-2", cardId: "mod-depot" },
  { instance: "h-3", cardId: "mod-depot" },
];

describe("Card decisions in the Supply", () => {
  test("D4: each Supply card an option names is a button with its label and presses that option", () => {
    const pending: Pending = {
      id: "d4",
      seat: 0,
      kind: "draft",
      options: [
        { id: "s-1", card: "s-1", label: "Draft Depot (first)" },
        { id: "s-3", card: "s-3", label: "Draft Depot (third)" },
      ],
    };
    const onDecide = mount(view({ players: [ann, bea], hand, supply, pending }));
    const region = screen.getByRole("region", { name: "Supply" });
    const buttons = within(region).getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(within(region).getByRole("button", { name: "Draft Depot (first)" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Draft Depot (third)" })).toBeTruthy();
    // The third Supply card is not offered: it keeps its card name and does not glow.
    expect(buttons[1]?.hasAttribute("data-decision-option")).toBe(false);

    fireEvent.click(within(region).getByRole("button", { name: "Draft Depot (third)" }));
    expect(onDecide).toHaveBeenCalledExactlyOnceWith("d4", "s-3");
    // The offered cards are not in the decision bar as well.
    const bar = screen.getByRole("region", { name: "Your decision" });
    expect(within(bar).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("Card decisions in the hand", () => {
  test("D5: only your hand cards are buttons, and none while another seat decides", () => {
    const pending: Pending = {
      id: "d5",
      seat: 0,
      kind: "discard",
      options: hand.map((card) => ({
        id: card.instance,
        card: card.instance,
        label: `Discard ${card.instance}`,
      })),
    };
    const onDecide = mount(view({ players: [ann, bea], hand, supply, pending }));
    const mine = screen.getByRole("region", { name: "Your hand" });
    expect(within(mine).getByRole("button", { name: "Discard h-2" })).toBeTruthy();
    const supplyRegion = screen.getByRole("region", { name: "Supply" });
    expect(supplyRegion.querySelectorAll("[data-decision-option]")).toHaveLength(0);
    fireEvent.click(within(mine).getByRole("button", { name: "Discard h-2" }));
    expect(onDecide).toHaveBeenCalledExactlyOnceWith("d5", "h-2");
  });

  test("another seat's decision leaves no card an option button", () => {
    mount(view({ players: [ann, bea], hand, supply, pending: { seat: 1, kind: "discard" } }));
    expect(document.querySelectorAll("[data-decision-option]")).toHaveLength(0);
  });

  test("D1: playable Agents are buttons, other cards are not, and going on stays in the bar", () => {
    const pending: Pending = {
      id: "d1",
      seat: 0,
      kind: "agent",
      options: [
        { id: "h-2", card: "h-2", label: "Play Second, pay 2", price: 2 },
        { id: "go_on", label: "Go on to the Main Action" },
      ],
    };
    const onDecide = mount(view({ players: [ann, bea], hand, supply, pending }));
    const mine = screen.getByRole("region", { name: "Your hand" });
    expect(mine.querySelectorAll("[data-decision-option]")).toHaveLength(1);
    expect(within(mine).getByRole("button", { name: "Play Second, pay 2" })).toBeTruthy();
    expect(within(mine).queryByRole("button", { name: "Go on to the Main Action" })).toBeNull();

    const bar = screen.getByRole("region", { name: "Your decision" });
    expect(within(bar).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(bar).getByRole("button", { name: "Go on to the Main Action" }));
    expect(onDecide).toHaveBeenLastCalledWith("d1", "go_on");

    fireEvent.click(within(mine).getByRole("button", { name: "Play Second, pay 2" }));
    expect(onDecide).toHaveBeenLastCalledWith("d1", "h-2");
  });

  test("a Main Action box stays in the bar although its option names a card", () => {
    const pending: Pending = {
      id: "d2",
      seat: 0,
      kind: "main_action",
      options: [{ id: "station-0:0", card: "station-0", box: 0, label: "Terran Outpost: Draw" }],
    };
    mount(view({ players: [ann, bea], hand, pending }));
    const bar = screen.getByRole("region", { name: "Your decision" });
    expect(within(bar).getByRole("button", { name: "Terran Outpost: Draw" })).toBeTruthy();
    expect(document.querySelectorAll("[data-decision-option]")).toHaveLength(0);
  });
});

describe("Hand layout", () => {
  test("a hand of 12 stays inside the hand region at 1280 wide", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    const twelve = Array.from({ length: 12 }, (_, index) => ({
      instance: `h-${String(index)}`,
      cardId: "mod-depot",
    }));
    mount(view({ players: [ann, bea], hand: twelve }));
    const mine = screen.getByRole("region", { name: "Your hand" });
    const slots = [...mine.querySelectorAll("li")];
    expect(slots).toHaveLength(12);
    const lefts = slots.map((slot) => Number.parseFloat(slot.style.left));
    for (const left of lefts) {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + HAND_CARD_WIDTH).toBeLessThanOrEqual(1280);
    }
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
  });

  test("the fan overlaps only as much as it must", () => {
    expect(fanStep(1, 1280, 110)).toBe(0);
    expect(fanStep(3, 1280, 110)).toBe(118);
    expect(fanStep(12, 1280, 110)).toBeCloseTo((1280 - 110) / 11);
    expect(fanStep(12, 1280, 110)).toBeLessThan(110);
    expect(fanStep(12, 100, 110)).toBe(0);
  });
});
