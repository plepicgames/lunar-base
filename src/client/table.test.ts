import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App.tsx";
import { Result } from "./screens/Result.tsx";
import { PlainTable } from "./table/PlainTable.tsx";
import { FakeWebSocket } from "./testing/fake-socket.ts";
import { buildPending, player, view } from "./testing/view-fixture.ts";

const token = "0123456789abcdef0123456789abcdef";

let restore: () => void;
beforeEach(() => {
  restore = FakeWebSocket.install();
});
afterEach(() => {
  cleanup();
  restore();
  window.sessionStorage.clear();
});

function table(overrides: Parameters<typeof view>[0] = {}, log: readonly string[] = []) {
  const onDecide = vi.fn();
  render(createElement(PlainTable, { view: view(overrides), log, onDecide }));
  return onDecide;
}

describe("Plain table", () => {
  test("shows the turn, the active player and each player's counters and Base", () => {
    table();
    expect(screen.getByText(/Turn 3/).textContent).toContain("Ann");
    const ann = screen.getByRole("region", { name: "Ann" });
    expect(ann.textContent).toContain("Credits 3");
    expect(ann.textContent).toContain("colonists 0");
    expect(ann.textContent).toContain("achievements 0");
    expect(ann.textContent).toContain("hand 2");
    expect(within(ann).getByText("Depot at 1,0 turned right")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Bea" })).toBeTruthy();
  });

  test("shows each player's progress against the view's targets", () => {
    table({ targets: { credits: 27, colonists: 14, achievements: 6 } });
    for (const name of ["Ann", "Bea"]) {
      const text = screen.getByRole("region", { name }).textContent;
      expect(text).toContain("Credits 3 of 27");
      expect(text).toContain("colonists 0 of 14");
      expect(text).toContain("achievements 0 of 6");
    }
  });

  test("shows the Supply, the Deck, the Discard pile, the hand and the log", () => {
    table(
      {
        supply: [{ instance: "s-1", cardId: "mod-depot" }],
        discardCount: 1,
        discard: [{ instance: "d-1", cardId: "mod-depot" }],
      },
      ["Ann built a Depot.", "Bea drew a card."],
    );
    expect(screen.getByRole("region", { name: "Supply" }).textContent).toContain("Depot");
    expect(screen.getByText("Deck 40")).toBeTruthy();
    expect(screen.getByText("Discard 1")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Your hand" }).textContent).toContain("Depot");
    const log = screen.getByRole("region", { name: "Log" });
    expect(
      within(log)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ann built a Depot.", "Bea drew a card."]);
  });

  test("a pending Build decision of this seat has one button per option, named by its label", () => {
    const onDecide = table({ pending: buildPending });
    expect(screen.getByText(/build/i, { selector: "[data-decision-kind]" })).toBeTruthy();
    expect(buildPending).toHaveProperty("options");
    for (const option of "options" in buildPending ? buildPending.options : []) {
      expect(screen.getByRole("button", { name: option.label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Build Depot at 2,0 turned right, pay 1" }));
    expect(onDecide).toHaveBeenCalledWith("d7", "c-1:2,0,1");
  });

  test("another seat's decision has no option button and names that player and the kind", () => {
    table({ pending: { seat: 1, kind: "build" } });
    expect(screen.queryByRole("button")).toBeNull();
    const asked = screen.getByRole("status");
    expect(asked.textContent).toContain("Bea");
    expect(asked.textContent).toContain("build");
  });
});

describe("Result screen", () => {
  const ended = (
    reason: "victory" | "step_limit",
    winners: number[],
    scores: number[],
    players = [player(0, { credits: 20 }), player(1)],
  ) => view({ players, result: { reason, winners, scores } });

  test("a victory lists the winners and each player's conditions", () => {
    render(createElement(Result, { view: ended("victory", [0], [1, 0]), onBack: vi.fn() }));
    expect(screen.getByRole("heading", { name: /Ann wins/ })).toBeTruthy();
    const ann = screen.getByRole("region", { name: "Ann" });
    expect(ann.textContent).toContain("Credits 20 of 20: met");
    expect(ann.textContent).toContain("colonists 0 of 10: not met");
    expect(ann.textContent).toContain("score 1");
    expect(screen.getByRole("region", { name: "Bea" }).textContent).toContain("score 0");
  });

  test("a shared victory names every winner", () => {
    render(
      createElement(Result, {
        view: ended(
          "victory",
          [0, 1],
          [1, 1],
          [player(0, { credits: 20 }), player(1, { credits: 21 })],
        ),
        onBack: vi.fn(),
      }),
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Ann and Bea");
  });

  test("a shared victory marks each player's met conditions", () => {
    render(
      createElement(Result, {
        view: ended(
          "victory",
          [0, 1],
          [2, 1],
          [
            player(0, { credits: 20, colonists: 10 }),
            player(1, { credits: 2, achievements: ["a", "b", "c", "d", "e"] }),
          ],
        ),
        onBack: vi.fn(),
      }),
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Ann and Bea");
    const ann = screen.getByRole("region", { name: "Ann" });
    const bea = screen.getByRole("region", { name: "Bea" });
    expect(ann.textContent).toContain("Credits 20 of 20: met");
    expect(ann.textContent).toContain("colonists 10 of 10: met");
    expect(bea.textContent).toContain("Credits 2 of 20: not met");
    expect(bea.textContent).toContain("achievements 5 of 5: met");
  });

  test("a turn_limit result says the game was stopped without naming a winner", () => {
    const game = view({ result: { reason: "turn_limit", winners: [], scores: [0, 0] } });
    render(createElement(Result, { view: game, onBack: vi.fn() }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/stopped/i);
    expect(screen.queryByText(/wins|winner/i)).toBeNull();
  });

  test("a step_limit result says the game was stopped and names no winner", () => {
    render(createElement(Result, { view: ended("step_limit", [], [0, 0]), onBack: vi.fn() }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/stopped/i);
    expect(screen.queryByText(/wins|winner/i)).toBeNull();
  });

  test("Back to lobby calls onBack", () => {
    const onBack = vi.fn();
    render(createElement(Result, { view: ended("victory", [0], [1, 0]), onBack }));
    fireEvent.click(screen.getByRole("button", { name: "Back to lobby" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("Table in the app", () => {
  function enterGame(gameView = view({ pending: buildPending })): FakeWebSocket {
    render(createElement(App));
    const socket = FakeWebSocket.current;
    act(() => {
      socket.open();
      socket.receive({ type: "welcome", protocol: 1, token, name: "Ann", jev: false });
      socket.receive({ type: "game.update", game: "g1", seq: 1, view: gameView, events: [] });
    });
    return socket;
  }

  test("pressing an option sends game.decide with the game, decision and option ids", () => {
    const socket = enterGame();
    fireEvent.click(screen.getByRole("button", { name: "Do not Build" }));
    expect(socket.messages.at(-1)).toEqual({
      type: "game.decide",
      game: "g1",
      decision: "d7",
      option: "skip",
    });
  });

  test("the log keeps the sentences of every update", () => {
    const socket = enterGame();
    act(() => {
      socket.receive({
        type: "game.update",
        game: "g1",
        seq: 2,
        view: view(),
        events: [{ type: "card_drawn", text: "Ann drew a card." }],
      });
      socket.receive({
        type: "game.update",
        game: "g1",
        seq: 3,
        view: view(),
        events: [{ type: "card_drawn", text: "Bea drew a card." }],
      });
    });
    const log = screen.getByRole("region", { name: "Log" });
    expect(
      within(log)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Ann drew a card.", "Bea drew a card."]);
  });

  test("Leave game, confirmed, sends one game.leave and the lobby returns", () => {
    const socket = enterGame();
    const before = socket.messages.length;
    fireEvent.click(screen.getByRole("button", { name: "Leave game" }));
    const stay = screen.getByRole("dialog", { name: "Leave game?" });
    fireEvent.click(within(stay).getByRole("button", { name: "Stay" }));
    expect(socket.messages).toHaveLength(before);

    fireEvent.click(screen.getByRole("button", { name: "Leave game" }));
    const leave = screen.getByRole("dialog", { name: "Leave game?" });
    fireEvent.click(within(leave).getByRole("button", { name: "Leave game" }));
    expect(socket.messages.slice(before)).toEqual([{ type: "game.leave" }]);

    act(() => {
      socket.receive({ type: "lobby.state", games: [] });
    });
    expect(screen.getByRole("button", { name: "Create game" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Table" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Leave game" })).toBeNull();
  });

  test("a finished game shows the result; Back to lobby sends game.leave and the lobby returns", () => {
    const socket = enterGame(view({ result: { reason: "victory", winners: [0], scores: [1, 0] } }));
    fireEvent.click(screen.getByRole("button", { name: "Back to lobby" }));
    expect(socket.messages.at(-1)).toEqual({ type: "game.leave" });
    act(() => {
      socket.receive({ type: "lobby.state", games: [] });
    });
    expect(screen.getByRole("button", { name: "Create game" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to lobby" })).toBeNull();
  });
});
