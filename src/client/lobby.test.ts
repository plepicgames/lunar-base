import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LobbyGame } from "../protocol/messages.ts";
import { App } from "./App.tsx";
import { Lobby } from "./screens/Lobby.tsx";
import { Waiting } from "./screens/Waiting.tsx";
import { FakeWebSocket } from "./testing/fake-socket.ts";

const token = "0123456789abcdef0123456789abcdef";

function game(overrides: Partial<LobbyGame> = {}): LobbyGame {
  return {
    id: "g1",
    creator: "Bea",
    seats: 4,
    bots: 1,
    humans: ["Bea"],
    humansWanted: 3,
    options: { influences: false, kickstarter: false, botBrain: "builtin" },
    ...overrides,
  };
}

let restore: () => void;
beforeEach(() => {
  restore = FakeWebSocket.install();
});
afterEach(() => {
  cleanup();
  restore();
  window.sessionStorage.clear();
});

function lobbyProps(games: readonly LobbyGame[] = []) {
  return { games, error: null, onCreate: vi.fn(), onJoin: vi.fn() };
}

describe("Lobby screen", () => {
  test("lists each open game with creator, seats, humans and non-human players", () => {
    render(
      createElement(
        Lobby,
        lobbyProps([
          game({ options: { influences: true, kickstarter: false, botBrain: "builtin" } }),
        ]),
      ),
    );
    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/Bea/)).toBeTruthy();
    expect(row.textContent).toContain("4 players");
    expect(row.textContent).toContain("1 of 3 humans joined");
    expect(row.textContent).toContain("1 non-human");
    expect(row.textContent).toContain("Influences: on");
    expect(within(row).getByRole("button", { name: "Join" })).toBeTruthy();
  });

  test("choosing 3 players and 1 non-human and pressing Create sends the create message", () => {
    const props = lobbyProps();
    render(createElement(Lobby, props));
    fireEvent.change(screen.getByLabelText("Players"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Non-human players"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create game" }));
    expect(props.onCreate).toHaveBeenCalledWith({
      seats: 3,
      bots: 1,
      influences: false,
      kickstarter: false,
    });
  });

  test("the non-human field cannot exceed the number of players", () => {
    render(createElement(Lobby, lobbyProps()));
    const players = screen.getByLabelText("Players");
    const bots = screen.getByLabelText("Non-human players");
    expect(bots).toHaveProperty("max", "2");
    fireEvent.change(bots, { target: { value: "2" } });
    fireEvent.change(players, { target: { value: "2" } });
    expect(bots).toHaveProperty("value", "2");
    fireEvent.change(bots, { target: { value: "5" } });
    expect(bots).toHaveProperty("value", "2");
    fireEvent.change(players, { target: { value: "6" } });
    expect(bots).toHaveProperty("max", "6");
    fireEvent.change(bots, { target: { value: "6" } });
    fireEvent.change(players, { target: { value: "3" } });
    expect(bots).toHaveProperty("value", "3");
  });

  test("players stay between 2 and 6", () => {
    render(createElement(Lobby, lobbyProps()));
    const players = screen.getByLabelText("Players");
    fireEvent.change(players, { target: { value: "9" } });
    expect(players).toHaveProperty("value", "6");
    fireEvent.change(players, { target: { value: "1" } });
    expect(players).toHaveProperty("value", "2");
  });

  test("Influences and Kickstarter cards are enabled", () => {
    render(createElement(Lobby, lobbyProps()));
    expect(screen.getByRole("checkbox", { name: "Influences" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("checkbox", { name: "Kickstarter cards" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(
      screen.getByText(/no printed rules and follow the readings of the specification/i),
    ).toBeTruthy();
  });

  test("ticking Kickstarter cards sends kickstarter: true", () => {
    openApp();
    welcome("Ann");
    lobbyState([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Kickstarter cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Create game" }));
    expect(FakeWebSocket.current.messages.at(-1)).toMatchObject({
      type: "lobby.create",
      kickstarter: true,
    });
  });

  test("ticking Influences sends influences: true", () => {
    openApp();
    welcome("Ann");
    lobbyState([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Influences" }));
    fireEvent.click(screen.getByRole("button", { name: "Create game" }));
    expect(FakeWebSocket.current.messages.at(-1)).toMatchObject({
      type: "lobby.create",
      influences: true,
    });
  });

  test("Join sends the id of its game", () => {
    const props = lobbyProps([game({ id: "g1" }), game({ id: "g2", creator: "Cy" })]);
    render(createElement(Lobby, props));
    const rows = screen.getAllByRole("listitem");
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Join" }));
    expect(props.onJoin).toHaveBeenCalledWith("g2");
  });

  test("a refusal in the lobby is shown as a message", () => {
    const error = { type: "error", code: "game_full", message: "That game is full." } as const;
    render(createElement(Lobby, { ...lobbyProps([game()]), error }));
    expect(screen.getByRole("alert").textContent).toBe("That game is full.");
  });
});

describe("Waiting screen", () => {
  test("shows that Influences is on", () => {
    render(
      createElement(Waiting, {
        game: game({ options: { influences: true, kickstarter: false, botBrain: "builtin" } }),
        onLeave: vi.fn(),
      }),
    );
    expect(screen.getByText(/Influences: on/)).toBeTruthy();
  });
  test("lists each seat as taken, free or non-human", () => {
    render(createElement(Waiting, { game: game(), onLeave: vi.fn() }));
    const seats = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(seats).toEqual(["Bea: taken", "Non-human", "Free", "Free"]);
  });

  test("Leave calls onLeave", () => {
    const onLeave = vi.fn();
    render(createElement(Waiting, { game: game(), onLeave }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});

function welcome(name: string, jev = false): void {
  act(() => {
    FakeWebSocket.current.receive({ type: "welcome", protocol: 1, token, name, jev });
  });
}

function lobbyState(games: readonly LobbyGame[]): void {
  act(() => {
    FakeWebSocket.current.receive({ type: "lobby.state", games });
  });
}

function openApp(): void {
  render(createElement(App));
  act(() => {
    FakeWebSocket.current.open();
  });
}

describe("App flow", () => {
  test("after welcome and lobby.state the lobby shows", () => {
    openApp();
    welcome("Ann");
    lobbyState([game()]);
    expect(screen.getByRole("button", { name: "Create game" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
  });

  test("pressing Create sends exactly the pinned message, with no botBrain", () => {
    openApp();
    welcome("Ann");
    lobbyState([]);
    fireEvent.change(screen.getByLabelText("Players"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Non-human players"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create game" }));
    expect(FakeWebSocket.current.messages.at(-1)).toStrictEqual({
      type: "lobby.create",
      seats: 3,
      bots: 1,
      influences: false,
      kickstarter: false,
    });
  });

  test("pressing Join sends lobby.join; game_full is shown", () => {
    openApp();
    welcome("Ann");
    lobbyState([game({ id: "g7" })]);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(FakeWebSocket.current.messages.at(-1)).toStrictEqual({ type: "lobby.join", game: "g7" });
    act(() => {
      FakeWebSocket.current.receive({
        type: "error",
        code: "game_full",
        message: "That game is full.",
      });
    });
    expect(screen.getByRole("alert").textContent).toBe("That game is full.");
  });

  test("a lobby.state with the player's open game shows the waiting screen", () => {
    openApp();
    welcome("Ann");
    lobbyState([game({ creator: "Ann", humans: ["Ann", "Cy"], humansWanted: 3 })]);
    expect(screen.queryByRole("button", { name: "Create game" })).toBeNull();
    const seats = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(seats).toEqual(["Ann: taken", "Non-human", "Cy: taken", "Free"]);
  });

  test("Leave sends game.leave", () => {
    openApp();
    welcome("Ann");
    lobbyState([game({ creator: "Ann", humans: ["Ann"] })]);
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(FakeWebSocket.current.messages.at(-1)).toStrictEqual({ type: "game.leave" });
  });

  test("the waiting screen gives way to the lobby when the game closes", () => {
    openApp();
    welcome("Ann");
    lobbyState([game({ creator: "Bea", humans: ["Bea", "Ann"] })]);
    expect(screen.getByRole("button", { name: "Leave" })).toBeTruthy();
    lobbyState([]);
    expect(screen.getByRole("button", { name: "Create game" })).toBeTruthy();
  });
});

test.each([false, true])("the welcome Jev flag %s controls the brain choice", (jev) => {
  openApp();
  welcome("Ann", jev);
  lobbyState([]);
  const choice = screen.queryByRole("combobox", { name: "Non-human brain" });
  if (!jev) {
    expect(choice).toBeNull();
    expect(screen.getByText("Non-human players use the built-in player.")).toBeTruthy();
    return;
  }
  if (!choice) throw new Error("Missing brain selector");
  expect(choice).toHaveProperty("value", "builtin");
  fireEvent.change(choice, { target: { value: "jev" } });
  fireEvent.click(screen.getByRole("button", { name: "Create game" }));
  expect(FakeWebSocket.current.messages.at(-1)).toMatchObject({
    type: "lobby.create",
    botBrain: "jev",
  });
  fireEvent.change(choice, { target: { value: "builtin" } });
  fireEvent.click(screen.getByRole("button", { name: "Create game" }));
  expect(FakeWebSocket.current.messages.at(-1)).not.toHaveProperty("botBrain");
});
