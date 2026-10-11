import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../App.tsx";
import type { GameState } from "../connection.ts";
import { FakeWebSocket } from "../testing/fake-socket.ts";
import { buildPending, player, view } from "../testing/view-fixture.ts";
import { Table } from "./Table.tsx";

type View = ReturnType<typeof view>;

const token = "0123456789abcdef0123456789abcdef";

let restore: () => void;
beforeEach(() => {
  restore = FakeWebSocket.install();
});
afterEach(() => {
  cleanup();
  restore();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

/** Ann (you, seat 0), Bea and Cy. */
function threeSeats(overrides: Partial<View> = {}): View {
  return view({
    players: [
      player(0),
      player(1, { credits: 7, colonists: 4, achievements: ["atom", "dog"], handSize: 5 }),
      player(2, { name: "Cy", kind: "bot", credits: 12, colonists: 9, handSize: 1 }),
    ],
    config: { seats: 3, influences: false, kickstarter: false },
    ...overrides,
  });
}

function mount(gameView: View, log: readonly string[] = []) {
  const onDecide = vi.fn();
  const game: GameState = { game: "g1", seq: 1, view: gameView, events: [], log };
  const result = render(createElement(Table, { game, onDecide, onLeave: vi.fn() }));
  return { onDecide, result };
}

function opponent(name: string): HTMLElement {
  const strip = screen.getByRole("region", { name: "Opponents" });
  return within(strip).getByRole("group", { name });
}

describe("Opponents strip", () => {
  test("Credit dial announces its value and target and follows the next view", () => {
    const { result } = mount(threeSeats());
    const before = within(opponent("Bea")).getByRole("group", { name: "Credits 7 of 20" });
    expect(within(before).getByText("7")).toBeTruthy();
    expect(within(before).getByText("20", { selector: "span" })).toBeTruthy();
    expect(before.querySelector("svg")).toBeTruthy();
    expect(before.querySelectorAll("[data-credit-tick]")).toHaveLength(21);
    expect(before.querySelector('[data-credit-tick="7"]')?.getAttribute("data-current")).toBe(
      "true",
    );
    const markerBefore = before.querySelector("svg g")?.getAttribute("style");

    const game: GameState = {
      game: "g1",
      seq: 2,
      view: threeSeats({
        targets: { credits: 27, colonists: 10, achievements: 5 },
        players: [player(0), player(1, { credits: 12 }), player(2, { name: "Cy" })],
      }),
      events: [],
      log: [],
    };
    result.rerender(createElement(Table, { game, onDecide: vi.fn(), onLeave: vi.fn() }));
    const after = within(opponent("Bea")).getByRole("group", {
      name: "Credits 12 of 27",
    });
    expect(within(after).getByText("12")).toBeTruthy();
    expect(within(after).getByText("27", { selector: "span" })).toBeTruthy();
    expect(after.querySelector("svg g")?.getAttribute("style")).not.toBe(markerBefore);
    expect(after.querySelectorAll("[data-credit-tick]")).toHaveLength(28);
    expect(after.querySelector('[data-credit-tick="12"]')?.getAttribute("data-current")).toBe(
      "true",
    );
  });

  test("each opponent shows Credits, colonists and achievements against the targets and the hand size", () => {
    mount(threeSeats());
    const strip = screen.getByRole("region", { name: "Opponents" });
    expect(within(strip).queryByRole("group", { name: "Ann" })).toBeNull();

    const bea = opponent("Bea");
    expect(within(bea).getByLabelText("Credits 7 of 20").textContent).toContain("7/20");
    expect(within(bea).getByLabelText("Colonists 4 of 10").textContent).toContain("4/10");
    expect(within(bea).getByLabelText("Achievements 2 of 5").textContent).toContain("2/5");
    expect(within(bea).getByLabelText("Hand 5 cards").textContent).toContain("5");
    expect(within(bea).getByRole("img", { name: "Deck back" })).toBeTruthy();
    expect(bea.textContent).toContain("human");

    const cy = opponent("Cy");
    expect(within(cy).getByLabelText("Credits 12 of 20")).toBeTruthy();
    expect(within(cy).getByLabelText("Colonists 9 of 10")).toBeTruthy();
    expect(cy.textContent).toContain("non-human");
  });

  test("the targets change when the view's targets change", () => {
    const { result } = mount(threeSeats());
    expect(within(opponent("Bea")).getByLabelText("Credits 7 of 20")).toBeTruthy();
    const targets = { credits: 27, colonists: 14, achievements: 6 };
    const game: GameState = {
      game: "g1",
      seq: 2,
      view: threeSeats({ targets }),
      events: [],
      log: [],
    };
    result.rerender(createElement(Table, { game, onDecide: vi.fn(), onLeave: vi.fn() }));
    const bea = opponent("Bea");
    expect(within(bea).getByLabelText("Credits 7 of 27").textContent).toContain("7/27");
    expect(within(bea).getByLabelText("Colonists 4 of 14").textContent).toContain("4/14");
    expect(within(bea).getByLabelText("Achievements 2 of 6").textContent).toContain("2/6");
  });

  test("achievements show as their icons and a disconnected seat is marked", () => {
    mount(
      threeSeats({
        players: [
          player(0),
          player(1, { achievements: ["atom", "dog"], connected: false }),
          player(2, { name: "Cy", kind: "bot" }),
        ],
      }),
    );
    const bea = opponent("Bea");
    const icons = within(bea).getAllByRole("img", { name: /Achievement/ });
    expect(icons.map((icon) => icon.getAttribute("src"))).toEqual([
      "/brand/achievements/atom.webp",
      "/brand/achievements/dog.webp",
    ]);
    expect(bea.textContent).toContain("away");
  });

  test("two fixtures that differ only in an opponent's hand cards render the same markup", () => {
    // The wire format carries no opponent cards; a hand smuggled into the player
    // object must change nothing, so the markup can only depend on the size.
    const withHand = (cards: readonly { instance: string; cardId: string }[]) => {
      const gameView = threeSeats();
      const bea = { ...gameView.players[1], hand: cards } as unknown as View["players"][number];
      return { ...gameView, players: [gameView.players[0], bea, gameView.players[2]] } as View;
    };
    const markup = (gameView: View) => {
      const { result } = mount(gameView);
      const html = opponent("Bea").outerHTML;
      result.unmount();
      return html;
    };
    const first = markup(withHand([{ instance: "x1", cardId: "mod-depot" }]));
    const second = markup(withHand([{ instance: "y9", cardId: "mod-lab" }]));
    expect(first).toBe(second);
    expect(first).not.toMatch(/mod-depot|mod-lab|instance="x1"|instance="y9"/);
  });

  test("an opponent's markup says nothing about Influences", () => {
    mount(threeSeats({ config: { seats: 3, influences: true, kickstarter: false } }));
    for (const name of ["Bea", "Cy"]) {
      expect(opponent(name).textContent).not.toMatch(/influence/i);
    }
  });
});

describe("Your counters", () => {
  test("use the same counters, against the targets, below the hand", () => {
    mount(
      threeSeats({
        players: [
          player(0, { credits: 12, colonists: 6, achievements: ["atom", "dog", "dna"] }),
          player(1),
          player(2, { name: "Cy", kind: "bot" }),
        ],
      }),
    );
    const mine = screen.getByRole("group", { name: "Ann (you)" });
    expect(within(mine).getByLabelText("Credits 12 of 20").textContent).toContain("12/20");
    expect(within(mine).getByLabelText("Colonists 6 of 10").textContent).toContain("6/10");
    expect(within(mine).getByLabelText("Achievements 3 of 5").textContent).toContain("3/5");
  });
});

describe("Supply, Deck and Discard pile", () => {
  test("the plain table uses the public Discard count when Transparency hides cards", () => {
    window.history.replaceState(null, "", "/?plain=1");
    mount(threeSeats({ discardCount: 16, discard: [] }));
    expect(screen.getByText("Discard 16")).toBeTruthy();
  });
  test("shows one Card per Supply card and the counts of the Deck and the Discard pile", () => {
    mount(
      threeSeats({
        supply: [
          { instance: "s-1", cardId: "mod-depot" },
          { instance: "s-2", cardId: "mod-depot" },
          { instance: "s-3", cardId: "mod-depot" },
        ],
        deck: 31,
        discardCount: 2,
        discard: [
          { instance: "d-1", cardId: "mod-depot" },
          { instance: "d-2", cardId: "mod-depot" },
        ],
      }),
    );
    const supply = screen.getByRole("region", { name: "Supply" });
    expect(within(supply).getAllByRole("button")).toHaveLength(5);
    expect(within(supply).getAllByRole("img", { name: "Depot" })).toHaveLength(4);
    expect(within(supply).getByText("Deck 31")).toBeTruthy();
    expect(within(supply).getByText("Discard 2")).toBeTruthy();
  });
});

describe("Regions", () => {
  test("the Base area, the log, the decision bar and your hand are present", () => {
    mount(threeSeats(), ["Ann built a Depot."]);
    expect(screen.getByRole("region", { name: "Base" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Your hand" })).toBeTruthy();
    const log = screen.getByRole("region", { name: "Log" });
    expect(within(log).getByText("Ann built a Depot.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Decision" })).toBeTruthy();
  });
});

describe("Decision bar", () => {
  test("with your decision pending it has the kind and one button per option; a press decides", () => {
    const { onDecide } = mount(threeSeats({ pending: buildPending }));
    const bar = screen.getByRole("region", { name: "Your decision" });
    expect(bar.textContent).toContain("build");
    expect(within(bar).getAllByRole("button")).toHaveLength(3);
    fireEvent.click(
      within(bar).getByRole("button", { name: "Build Depot at 2,0 turned right, pay 1" }),
    );
    expect(onDecide).toHaveBeenCalledWith("d7", "c-1:2,0,1");
  });

  test("another seat's decision names that player and the kind and has no button", () => {
    mount(threeSeats({ pending: { seat: 1, kind: "build" } }));
    const bar = screen.getByRole("region", { name: "Decision" });
    expect(within(bar).queryByRole("button")).toBeNull();
    expect(bar.textContent).toContain("Bea");
    expect(bar.textContent).toContain("build");
  });

  test("nothing pending says so", () => {
    mount(threeSeats());
    expect(screen.getByRole("region", { name: "Decision" }).textContent).toContain("Nothing");
  });
});

describe("Plain table switch", () => {
  test("shows the picture table by default and the plain table at ?plain=1", () => {
    const first = mount(threeSeats());
    expect(screen.getByRole("region", { name: "Opponents" })).toBeTruthy();
    first.result.unmount();

    window.history.replaceState(null, "", "/?plain=1");
    mount(threeSeats());
    expect(screen.queryByRole("region", { name: "Opponents" })).toBeNull();
    expect(screen.getByText(/Turn 3/)).toBeTruthy();
    expect(screen.getByText("Deck 40")).toBeTruthy();
  });
});

describe("Rulebook help", () => {
  const defer = {
    id: "d7",
    seat: 0,
    kind: "defer" as const,
    options: [
      { id: "now", label: "Resolve now" },
      { id: "later", label: "Resolve later" },
    ],
  };

  test("Help opened over a choice holds focus and Escape returns to the choice", () => {
    const { onDecide } = mount(threeSeats({ pending: defer }));
    const choice = screen.getByRole("dialog", { name: "Resolve the text now or later" });
    const now = within(choice).getByRole("button", { name: "Resolve now" });
    expect(document.activeElement).toBe(now);

    fireEvent.keyDown(document, { key: "?" });
    const help = screen.getByRole("dialog", { name: "Rulebook help" });
    expect(help.contains(document.activeElement)).toBe(true);
    now.focus();
    expect(help.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(help.contains(document.activeElement)).toBe(true);
    expect(onDecide).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Rulebook help" })).toBeNull();
    expect(choice.contains(document.activeElement)).toBe(true);
  });

  test("a choice arriving while Help is open keeps focus in visible Help", () => {
    const { result } = mount(threeSeats());
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const help = screen.getByRole("dialog", { name: "Rulebook help" });
    const game: GameState = {
      game: "g1",
      seq: 2,
      view: threeSeats({ pending: defer }),
      events: [],
      log: [],
    };
    result.rerender(createElement(Table, { game, onDecide: vi.fn(), onLeave: vi.fn() }));
    expect(screen.getByRole("dialog", { name: "Resolve the text now or later" })).toBeTruthy();
    expect(help.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(help.contains(document.activeElement)).toBe(true);
  });

  test("opens with ?, changes pages with arrows, closes with Escape and restores focus", () => {
    mount(threeSeats());
    const help = screen.getByRole("button", { name: "Help" });
    help.focus();
    fireEvent.keyDown(document, { key: "?" });
    const dialog = screen.getByRole("dialog", { name: "Rulebook help" });
    expect(within(dialog).getByRole("img", { name: "Rulebook page 4" })).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    const outside = screen.getByRole("button", { name: "View Bea's Base" });
    outside.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(within(dialog).getByRole("img", { name: "Rulebook page 21" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(within(dialog).getByRole("img", { name: "Rulebook page 4" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Rulebook help" })).toBeNull();
    expect(document.activeElement).toBe(help);
  });

  test("all seven page images name their printed rulebook page", () => {
    mount(threeSeats());
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    for (const page of [4, 21, 22, 23, 24, 25, 26]) {
      expect(screen.getByRole("img", { name: `Rulebook page ${String(page)}` })).toBeTruthy();
      if (page !== 26) fireEvent.keyDown(document, { key: "ArrowRight" });
    }
  });
});

describe("Picture table in the app", () => {
  test("pressing an option sends game.decide", () => {
    render(createElement(App));
    const socket = FakeWebSocket.current;
    act(() => {
      socket.open();
      socket.receive({ type: "welcome", protocol: 1, token, name: "Ann", jev: false });
      socket.receive({
        type: "game.update",
        game: "g1",
        seq: 1,
        view: threeSeats({ pending: buildPending }),
        events: [],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Do not Build" }));
    expect(socket.messages.at(-1)).toEqual({
      type: "game.decide",
      game: "g1",
      decision: "d7",
      option: "skip",
    });
  });
});
