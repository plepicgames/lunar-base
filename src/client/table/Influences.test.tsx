import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { GameState } from "../connection.ts";
import { player, view } from "../testing/view-fixture.ts";
import { Table } from "./Table.tsx";

afterEach(cleanup);

const held = [
  { instance: "i1", cardId: "inf-quarantine" },
  { instance: "i2", cardId: "inf-lunar-alliance" },
];

function mount(gameView: ReturnType<typeof view>, events: GameState["events"] = []) {
  const onDecide = vi.fn();
  render(
    <Table
      game={{
        game: "g1",
        seq: 1,
        view: gameView,
        events,
        history: events,
        log: events.map((e) => e.text),
      }}
      onDecide={onDecide}
      onLeave={vi.fn()}
    />,
  );
  return onDecide;
}

test("D12 names the Agent and action and sends each defence choice", () => {
  const onDecide = mount(
    view({
      config: { seats: 2, influences: true, kickstarter: false },
      hand: held,
      play: [{ instance: "a1", cardId: "agt-spybot-py" }],
      pending: {
        id: "d12",
        seat: 0,
        kind: "defence",
        options: [
          { id: "decline", label: "Do not defend" },
          { id: "i1", card: "i1", label: "Discard Quarantine to defend" },
          { id: "i2", card: "i2", label: "Discard Lunar Alliance to defend" },
        ],
      },
    }),
    [
      {
        type: "agent_played",
        seat: 1,
        card: { instance: "a1", cardId: "agt-spybot-py" },
        cost: 0,
        text: "Bea played Spybot.py.",
      },
    ],
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toMatch(/Spybot.py/);
  expect(dialog.textContent).toMatch(/Look at an opponent's hand/);
  expect(dialog.textContent).toMatch(/that opponent Discards a card/);
  for (const [label, id] of [
    ["Decline", "decline"],
    ["Discard Quarantine to defend", "i1"],
    ["Discard Lunar Alliance to defend", "i2"],
  ]) {
    fireEvent.click(within(dialog).getByRole("button", { name: label }));
    expect(onDecide).toHaveBeenLastCalledWith("d12", id);
  }
});

test("D13 shows one button per immediate effect order", () => {
  const onDecide = mount(
    view({
      hand: held,
      pending: {
        id: "d13",
        seat: 0,
        kind: "order",
        options: [
          { id: "0", card: "i1", label: "Resolve Quarantine next" },
          { id: "1", card: "i2", label: "Resolve Lunar Alliance next" },
        ],
      },
    }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("heading").textContent).toBe("Order immediate effects");
  expect(within(dialog).queryByRole("img")).toBeNull();
  expect(within(dialog).getAllByRole("button")).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole("button", { name: "Resolve Lunar Alliance next" }));
  expect(onDecide).toHaveBeenCalledWith("d13", "1");
});

test("only your counters show Influence progress from your hand", () => {
  mount(
    view({
      config: { seats: 2, influences: true, kickstarter: false },
      hand: [...held, { instance: "m1", cardId: "mod-depot" }],
      players: [
        player(0, { handSize: 3 }),
        {
          ...player(1, { handSize: 4 }),
          hand: [{ instance: "secret", cardId: "inf-quarantine" }],
        } as ReturnType<typeof player>,
      ],
    }),
  );
  expect(
    within(screen.getByRole("group", { name: "Ann (you)" })).getByLabelText("Influences 2 of 4")
      .textContent,
  ).toContain("2/4");
  const opponent = within(screen.getByRole("region", { name: "Opponents" })).getByRole("group", {
    name: "Bea",
  });
  expect(opponent.textContent).not.toMatch(/influence|2\/4/i);
  expect(opponent.querySelector('[aria-label*="Influence"]')).toBeNull();
});

test("a public reveal appears in the log and winner's result cards", () => {
  const cards = [
    ...held,
    { instance: "i3", cardId: "inf-terran-embargo" },
    { instance: "i4", cardId: "inf-laikas-paradise" },
  ];
  const reveal = {
    type: "influences_revealed",
    seat: 1,
    cards,
    text: "Bea revealed 4 Influences: Quarantine, Lunar Alliance, Terran Embargo, Laika's Paradise.",
  } as const;
  mount(
    view({
      config: { seats: 2, influences: true, kickstarter: false },
      result: { reason: "victory", winners: [1], scores: [0, 1] },
    }),
    [reveal],
  );
  const winner = screen.getByRole("region", { name: "Bea" });
  expect(within(winner).getByRole("img", { name: "Quarantine" })).toBeTruthy();
  expect(within(winner).getByRole("img", { name: "Lunar Alliance" })).toBeTruthy();
  expect(
    within(winner).getAllByRole("img", {
      name: /Quarantine|Lunar Alliance|Terran Embargo|Laika's Paradise/,
    }),
  ).toHaveLength(4);
});

test("the public reveal is written in the table log", () => {
  const reveal = {
    type: "influences_revealed",
    seat: 1,
    cards: held,
    text: "Bea revealed 2 Influences: Quarantine, Lunar Alliance.",
  } as const;
  mount(view(), [reveal]);
  expect(
    within(screen.getByRole("region", { name: "Log" })).getByText(/Bea revealed 2 Influences/),
  ).toBeTruthy();
});

test("Supply Influence shows its card and active effect", () => {
  mount(view({ supply: [{ instance: "s1", cardId: "inf-quarantine" }] }));
  const supply = screen.getByRole("region", { name: "Supply" });
  expect(within(supply).getByRole("img", { name: "Quarantine" })).toBeTruthy();
  expect(supply.textContent).toMatch(/Drafting other Influences.*FORBIDDEN/);
});
