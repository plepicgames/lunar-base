import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App.tsx";
import { TOKEN_KEY } from "./connection.ts";
import { FakeWebSocket } from "./testing/fake-socket.ts";
import { buildPending, player, view } from "./testing/view-fixture.ts";

const token = "0123456789abcdef0123456789abcdef";
let restore: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  restore = FakeWebSocket.install();
  window.sessionStorage.setItem(TOKEN_KEY, token);
});
afterEach(() => {
  cleanup();
  restore();
  window.sessionStorage.clear();
  vi.useRealTimers();
});

function gameView() {
  return view({
    players: [player(0), player(1, { connected: false })],
    pending: buildPending,
  });
}

function startGame() {
  render(<App />);
  const socket = FakeWebSocket.current;
  act(() => {
    socket.open();
    socket.receive({ type: "welcome", protocol: 1, token, name: "Ann", jev: false });
    socket.receive({ type: "game.update", game: "g1", seq: 1, view: gameView(), events: [] });
  });
  return socket;
}

test("a drop keeps the table visible and disables its options until a resumed update", () => {
  const first = startGame();
  const option = screen.getByRole("button", { name: "Do not Build" });
  act(() => {
    first.drop();
  });
  expect(screen.getByText("Reconnecting")).toBeTruthy();
  expect(option.matches(":disabled")).toBe(true);
  expect(screen.getByText("Ann")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(FakeWebSocket.instances).toHaveLength(2);
  const resumed = FakeWebSocket.current;
  act(() => {
    resumed.open();
  });
  expect(resumed.messages).toEqual([{ type: "hello", protocol: 1, token }]);
  expect(option.matches(":disabled")).toBe(true);
  act(() => {
    resumed.receive({ type: "welcome", protocol: 1, token, name: "Ann", jev: false });
    resumed.receive({
      type: "game.update",
      game: "g1",
      seq: 2,
      view: view({ players: [player(0), player(1)], pending: buildPending }),
      events: [],
    });
  });
  expect(screen.queryByText("Reconnecting")).toBeNull();
  expect(option.matches(":disabled")).toBe(false);
  expect(within(screen.getByRole("region", { name: "Opponents" })).queryByText(/away/)).toBeNull();
});

test("a retry without a stored token returns to Name and clears the dead game", () => {
  const first = startGame();
  window.sessionStorage.removeItem(TOKEN_KEY);
  act(() => {
    first.drop();
  });
  expect(screen.getByText("Reconnecting")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(250);
  });
  act(() => {
    FakeWebSocket.current.open();
  });
  expect(FakeWebSocket.current.messages).toEqual([]);
  expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
  expect(screen.getByText(/game was lost/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Do not Build" })).toBeNull();
});

test("a replaced tab shows the other-tab notice and does not retry", () => {
  const first = startGame();
  act(() => {
    first.drop(4001);
  });
  expect(screen.getByText("This game is open in another tab")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(15000);
  });
  expect(FakeWebSocket.instances).toHaveLength(1);
});

const RESTART_NOTICE =
  "The server restarted. This game has ended. Start a new game from the lobby.";

test("the restart message shows the notice, stops the retries and offers a fresh start", () => {
  const first = startGame();
  const option = screen.getByRole("button", { name: "Do not Build" });
  act(() => {
    first.receive({ type: "server.restart" });
  });
  expect(screen.getByText(RESTART_NOTICE)).toBeTruthy();
  act(() => {
    first.drop(1012);
  });
  expect(screen.getByText(RESTART_NOTICE)).toBeTruthy();
  expect(screen.queryByText("Reconnecting")).toBeNull();
  expect(option.matches(":disabled")).toBe(true);
  expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(FakeWebSocket.instances).toHaveLength(1);

  const again = screen.getByRole("button", { name: "Start again" });
  expect(document.activeElement).toBe(again);
  fireEvent.click(again);
  expect(FakeWebSocket.instances).toHaveLength(2);
  act(() => {
    FakeWebSocket.current.open();
  });
  expect(FakeWebSocket.current.messages).toEqual([]);
  expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
  expect(screen.queryByText(RESTART_NOTICE)).toBeNull();
  expect(screen.queryByText(/game was lost/i)).toBeNull();
});

test("a close with code 1012 and no message shows the same notice and does not retry", () => {
  const first = startGame();
  act(() => {
    first.drop(1012);
  });
  expect(screen.getByText(RESTART_NOTICE)).toBeTruthy();
  expect(screen.queryByText("Reconnecting")).toBeNull();
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(FakeWebSocket.instances).toHaveLength(1);
});

test("the restart message stops the retries whatever close code follows; the lobby loses no game", () => {
  render(<App />);
  const socket = FakeWebSocket.current;
  act(() => {
    socket.open();
    socket.receive({ type: "welcome", protocol: 1, token, name: "Ann", jev: false });
    socket.receive({ type: "lobby.state", games: [] });
    socket.receive({ type: "server.restart" });
    socket.drop();
  });
  expect(screen.getByText("The server restarted. Start a new game from the lobby.")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(FakeWebSocket.instances).toHaveLength(1);
});

test("before a session exists a restart is an ordinary drop: the client retries", () => {
  window.sessionStorage.clear();
  render(<App />);
  const socket = FakeWebSocket.current;
  act(() => {
    socket.open();
    socket.receive({ type: "server.restart" });
    socket.drop(1012);
  });
  expect(screen.queryByText(/server restarted/i)).toBeNull();
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(FakeWebSocket.instances).toHaveLength(2);
});

test("a lost stored session clears the game and explains the return to Name", () => {
  const first = startGame();
  act(() => {
    first.drop();
  });
  act(() => {
    vi.advanceTimersByTime(250);
  });
  act(() => {
    FakeWebSocket.current.open();
  });
  act(() => {
    FakeWebSocket.current.receive({
      type: "error",
      code: "name_invalid",
      message: "Choose a name.",
    });
  });
  expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
  expect(screen.getByText(/game was lost/i)).toBeTruthy();
  expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
});

test("stale_decision shows a temporary notice and leaves the decision usable", () => {
  startGame();
  act(() => {
    FakeWebSocket.current.receive({
      type: "error",
      code: "stale_decision",
      message: "That choice is stale.",
    });
  });
  expect(screen.getByText("That choice is stale.")).toBeTruthy();
  const option = screen.getByRole("button", { name: "Do not Build" });
  expect(option).toHaveProperty("disabled", false);
  fireEvent.click(option);
  expect(FakeWebSocket.current.messages.at(-1)?.type).toBe("game.decide");
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.queryByText("That choice is stale.")).toBeNull();
});
