import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { GameState } from "../connection.ts";
import { Log } from "./Log.tsx";
import { player } from "../testing/view-fixture.ts";
type ViewEvent = GameState["events"][number];

afterEach(cleanup);

const turn = (number: number): ViewEvent => ({
  type: "turn_started",
  seat: 0,
  turn: number,
  text: `Ann started turn ${String(number)}.`,
});
const seen: ViewEvent = {
  type: "hand_seen",
  looker: 0,
  opponent: 1,
  cards: [
    { instance: "c1", cardId: "mod-depot" },
    { instance: "c2", cardId: "mod-lab" },
  ],
  text: "Ann looked at Bea's hand: Depot, Laboratory.",
};

test("appends three updates in order, separates turns and follows the newest line", () => {
  const events = [
    turn(1),
    { type: "card_drawn", seat: 0, text: "Ann drew a card." } as ViewEvent,
    turn(2),
  ];
  const { rerender } = render(<Log lines={[events[0].text]} events={events.slice(0, 1)} />);
  const region = screen.getByRole("region", { name: "Log" });
  expect(region.getAttribute("aria-live")).toBe("polite");
  Object.defineProperties(region, {
    scrollHeight: { configurable: true, value: 300 },
    clientHeight: { configurable: true, value: 100 },
  });
  rerender(
    <Log lines={events.slice(0, 2).map((event) => event.text)} events={events.slice(0, 2)} />,
  );
  expect(region.scrollTop).toBe(300);
  rerender(<Log lines={events.map((event) => event.text)} events={events} />);
  expect(
    within(region)
      .getAllByRole("listitem")
      .map((item, index) => item.textContent.endsWith(events[index].text)),
  ).toEqual([true, true, true]);
  expect(within(region).getByText("Turn 2")).toBeTruthy();
  expect(region.scrollTop).toBe(300);
});

test("private look opens once with every seen card and retains its sentence after closing", () => {
  const players = [player(0), player(1)];
  const { rerender } = render(<Log lines={[]} events={[]} players={players} />);
  rerender(<Log lines={[seen.text]} events={[seen]} players={players} />);
  const dialog = screen.getByRole("dialog", { name: "Bea's hand" });
  expect(within(dialog).getAllByRole("img")).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Bea's hand" })).toBeNull();
  expect(screen.getByText(/Ann looked at Bea's hand:/)).toBeTruthy();
  rerender(<Log lines={[seen.text]} events={[seen]} players={players} />);
  expect(screen.queryByRole("dialog", { name: "Bea's hand" })).toBeNull();
});

test("a private look in restored history stays in the log without reopening its dialog", () => {
  const players = [player(0), player(1)];
  const { rerender } = render(<Log lines={[seen.text]} events={[seen]} players={players} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(/Ann looked at Bea's hand:/)).toBeTruthy();

  const next: ViewEvent = {
    ...seen,
    cards: [{ instance: "c3", cardId: "mod-depot" }],
    text: "Ann looked at Bea's hand: Depot.",
  };
  rerender(<Log lines={[seen.text, next.text]} events={[seen, next]} players={players} />);
  expect(
    within(screen.getByRole("dialog", { name: "Bea's hand" })).getAllByRole("img"),
  ).toHaveLength(1);
});

test("public look adds a sentence without opening a dialog", () => {
  const event: ViewEvent = {
    type: "hand_seen",
    looker: 1,
    opponent: 0,
    text: "Bea looked at Ann's hand.",
  };
  render(<Log lines={[event.text]} events={[event]} />);
  expect(screen.getByText(event.text)).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a named card in a sentence opens the zoom view", () => {
  render(<Log lines={[seen.text]} events={[seen]} players={[player(0), player(1)]} />);
  fireEvent.click(
    within(screen.getByRole("region", { name: "Log" })).getByRole("button", { name: "Depot" }),
  );
  expect(screen.getByRole("dialog", { name: "Depot" })).toBeTruthy();
});

test("reading older lines prevents automatic scrolling until the reader reaches the bottom", () => {
  const first = turn(1);
  const second = turn(2);
  const third = turn(3);
  const { rerender } = render(<Log lines={[first.text]} events={[first]} />);
  const region = screen.getByRole("region", { name: "Log" });
  Object.defineProperties(region, {
    scrollHeight: { configurable: true, value: 300 },
    clientHeight: { configurable: true, value: 100 },
  });
  region.scrollTop = 20;
  fireEvent.scroll(region);
  rerender(<Log lines={[first.text, second.text]} events={[first, second]} />);
  expect(region.scrollTop).toBe(20);
  region.scrollTop = 200;
  fireEvent.scroll(region);
  rerender(<Log lines={[first.text, second.text, third.text]} events={[first, second, third]} />);
  expect(region.scrollTop).toBe(300);
});
