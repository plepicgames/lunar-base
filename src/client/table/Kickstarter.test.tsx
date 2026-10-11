import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { player, view } from "../testing/view-fixture.ts";
import { PictureTable } from "./PictureTable.tsx";

afterEach(cleanup);

function mount(gameView: ReturnType<typeof view>) {
  const onDecide = vi.fn();
  render(<PictureTable view={gameView} log={[]} onDecide={onDecide} />);
  return onDecide;
}

test("Transparency shows the public Deck top and a counted, face-down Discard", () => {
  mount(
    view({
      deck: 17,
      deckTop: { instance: "top", cardId: "mod-depot" },
      discardCount: 2,
      discard: [],
    }),
  );
  const deck = screen.getByLabelText("Deck 17 cards");
  const discard = screen.getByLabelText("Discard 2 cards");
  expect(within(deck).getByRole("img", { name: "Depot" })).toBeTruthy();
  expect(within(deck).getByRole("button", { name: "Depot" }).getAttribute("aria-haspopup")).toBe(
    "dialog",
  );
  expect(within(discard).getByRole("img", { name: "Deck back" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /View Discard/ })).toBeNull();
});

test("the normal Discard shows its top and opens the full pile", () => {
  mount(
    view({
      discardCount: 2,
      discard: [
        { instance: "d1", cardId: "mod-depot" },
        { instance: "d2", cardId: "agt-spybot-py" },
      ],
    }),
  );
  expect(
    within(screen.getByLabelText("Discard 2 cards")).getByRole("img", { name: "Spybot.py" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View Discard pile" }));
  const dialog = screen.getByRole("dialog", { name: "Discard pile" });
  expect(within(dialog).getByRole("img", { name: "Depot" })).toBeTruthy();
  expect(within(dialog).getByRole("img", { name: "Spybot.py" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Depot" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Spybot.py" })).toBeTruthy();
  fireEvent.keyDown(within(dialog).getByRole("button", { name: "Depot" }), { key: " " });
  expect(screen.getByRole("dialog", { name: "Depot" })).toBeTruthy();
});

test("a hidden Discard closes its dialog until the player opens it again", () => {
  const visible = view({
    discardCount: 1,
    discard: [{ instance: "d1", cardId: "mod-depot" }],
  });
  const { rerender } = render(<PictureTable view={visible} log={[]} onDecide={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "View Discard pile" }));
  expect(screen.getByRole("dialog", { name: "Discard pile" })).toBeTruthy();
  rerender(
    <PictureTable view={view({ discardCount: 1, discard: [] })} log={[]} onDecide={vi.fn()} />,
  );
  expect(screen.queryByRole("dialog", { name: "Discard pile" })).toBeNull();
  rerender(<PictureTable view={visible} log={[]} onDecide={vi.fn()} />);
  expect(screen.queryByRole("dialog", { name: "Discard pile" })).toBeNull();
});

test("Welfare and Longevity targets display as 6 and 12", () => {
  mount(view({ targets: { credits: 20, achievements: 6, colonists: 12 } }));
  const mine = screen.getByRole("group", { name: "Ann (you)" });
  expect(within(mine).getByLabelText("Achievements 0 of 6").textContent).toContain("0/6");
  expect(within(mine).getByLabelText("Colonists 0 of 12").textContent).toContain("0/12");
});

test("Kafka offers each other Station as a button", () => {
  const onDecide = mount(
    view({
      players: [player(0), player(1), player(2, { name: "Cy" })],
      pending: {
        id: "d14",
        seat: 0,
        kind: "exchange_station",
        options: [
          { id: "1", target: 1, label: "Exchange with player 2's Station" },
          { id: "2", target: 2, label: "Exchange with player 3's Station" },
        ],
      },
    }),
  );
  const strip = screen.getByRole("region", { name: "Opponents" });
  const buttons = within(strip).getAllByRole("button", { name: /Exchange with player/ });
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  expect(onDecide.mock.calls).toEqual([
    ["d14", "1"],
    ["d14", "2"],
  ]);
});

test("the next view shows the Stations in their exchanged Bases", () => {
  const before = view({
    players: [player(0), player(1)],
  });
  const { rerender } = render(<PictureTable view={before} log={[]} onDecide={vi.fn()} />);
  const ownStation = before.players[0].base.station;
  const otherStation = {
    ...before.players[1].base.station,
    cardId: "ks-stn-kafka",
    side: "named" as const,
    named: "ks-stn-kafka" as const,
  };
  rerender(
    <PictureTable
      view={view({
        players: [
          player(0, { base: { ...before.players[0].base, station: otherStation } }),
          player(1, { base: { ...before.players[1].base, station: ownStation } }),
        ],
      })}
      log={[]}
      onDecide={vi.fn()}
    />,
  );
  expect(
    within(screen.getByRole("region", { name: "Base" })).getByRole("img", { name: "Kafka" }),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("button", { name: "View Bea's Base" })).getByRole("img", {
      name: "Terran Outpost",
    }),
  ).toBeTruthy();
});

test("the table lists the eight selected Influences once the game starts", () => {
  const names = [
    "Welfare",
    "Free Market",
    "Longevity",
    "Transparency",
    "Quarantine",
    "Terran Embargo",
    "Runaway Bureaucracy",
    "Space Cowboy Capitalism",
  ];
  mount(view({ influencesInGame: names }));
  const list = screen.getByRole("region", { name: "Influences in this game" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(8);
  for (const name of names) expect(within(list).getByText(name)).toBeTruthy();
});

test("a Draft card button includes the engine's extra price", () => {
  const onDecide = mount(
    view({
      supply: [{ instance: "i1", cardId: "ks-inf-welfare" }],
      pending: {
        id: "d4",
        seat: 0,
        kind: "draft",
        options: [{ id: "i1", card: "i1", label: "Draft Welfare, pay 3", price: 3 }],
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Draft Welfare, pay 3" }));
  expect(onDecide).toHaveBeenCalledWith("d4", "i1");
});
