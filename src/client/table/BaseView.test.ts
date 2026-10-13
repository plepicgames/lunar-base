import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import source from "../../../docs/design/cards.json" with { type: "json" };
import { player, view } from "../testing/view-fixture.ts";
import { PictureTable } from "./PictureTable.tsx";

afterEach(cleanup);

const cards = [
  { instance: "a", cardId: "mod-depot", x: 1, y: 0, q: 0 as const },
  { instance: "b", cardId: "mod-lab", x: -1, y: 0, q: 0 as const },
  { instance: "c", cardId: "mod-rover", x: 0, y: 2, q: 1 as const },
];

function mount() {
  const ann = player(0);
  const bea = player(1);
  render(
    createElement(PictureTable, {
      view: view({
        players: [
          { ...ann, base: { ...ann.base, modules: cards } },
          { ...bea, base: { ...bea.base, modules: [{ ...cards[0], instance: "other" }] } },
        ],
      }),
      log: [],
      onDecide: () => undefined,
    }),
  );
}

type Station = ReturnType<typeof player>["base"]["station"];

function withStation(seat: number, station: Partial<Station>) {
  const base = player(seat).base;
  return player(seat, { base: { ...base, station: { ...base.station, ...station } } });
}

/** Ann and Bea with these Stations; returns the mock that would send a decision. */
function mountStations(ann: Partial<Station>, bea: Partial<Station> = {}) {
  const onDecide = vi.fn();
  render(
    createElement(PictureTable, {
      view: view({ players: [withStation(0, ann), withStation(1, bea)] }),
      log: [],
      onDecide,
    }),
  );
  return onDecide;
}

const OTHER_SIDE = /other side/i;

describe("Base view", () => {
  test("draws the Station and three Modules on distinct grid boxes", () => {
    mount();
    const base = screen.getByRole("region", { name: "Base" });
    const boxes = within(base).getAllByTestId("base-card");
    expect(boxes).toHaveLength(4);
    expect(boxes.map((box) => [box.dataset.gridX, box.dataset.gridY])).toEqual([
      ["0", "0"],
      ["1", "0"],
      ["-1", "0"],
      ["-1", "2"],
    ]);
    const occupied = boxes
      .map((box) => {
        const x = Number(box.dataset.gridX);
        const y = Number(box.dataset.gridY);
        const w = Number(box.dataset.gridWidth);
        const h = Number(box.dataset.gridHeight);
        return Array.from(
          { length: w * h },
          (_, i) => `${String(x + (i % w))},${String(y + Math.floor(i / w))}`,
        );
      })
      .flat();
    expect(new Set(occupied).size).toBe(8);
  });

  test("selects an opponent and returns to your Base", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "View Bea's Base" }));
    const base = screen.getByRole("region", { name: "Base" });
    expect(within(base).getAllByTestId("base-card")).toHaveLength(2);
    fireEvent.click(within(base).getByRole("button", { name: "Your Base" }));
    expect(within(base).getAllByTestId("base-card")).toHaveLength(4);
  });

  test("zoom controls change scale and Fit includes every card", () => {
    mount();
    const base = screen.getByRole("region", { name: "Base" });
    const area = within(base).getByTestId("base-viewport");
    const initial = Number(area.dataset.scale);
    fireEvent.click(within(base).getByRole("button", { name: "Zoom in" }));
    expect(Number(area.dataset.scale)).toBeGreaterThan(initial);
    fireEvent.click(within(base).getByRole("button", { name: "Zoom out" }));
    expect(Number(area.dataset.scale)).toBeCloseTo(initial);
    fireEvent.click(within(base).getByRole("button", { name: "Fit Base" }));
    expect(area.dataset.fitted).toBe("true");
    const stage = area.firstElementChild as HTMLElement;
    const scale = Number(area.dataset.scale);
    expect(Number.parseFloat(stage.style.width) * scale).toBeLessThanOrEqual(600 - 36);
    expect(Number.parseFloat(stage.style.height) * scale).toBeLessThanOrEqual(360 - 36);
    fireEvent.keyDown(area, { key: "ArrowRight" });
    expect(stage.style.left).toContain("30px");
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -1 });
    act(() => {
      area.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(Number(area.dataset.scale)).toBeGreaterThan(scale);
    fireEvent.keyDown(area, { key: "+" });
    expect(Number(area.dataset.scale)).toBeGreaterThan(scale * 1.1);
    fireEvent.keyDown(area, { key: "-" });
    expect(Number(area.dataset.scale)).toBeCloseTo(scale * 1.1);
  });
});

describe("the other side of a Station", () => {
  test("an Outpost that carries its named side has a button to look at it", () => {
    mountStations({ named: "stn-shackleton" });
    const base = screen.getByRole("region", { name: "Base" });
    expect(
      within(base).getByRole("button", { name: "Look at the other side of your Station" }),
    ).toBeTruthy();
    expect(within(base).getByRole("img", { name: "Terran Outpost" })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("stn-shackleton");
    expect(document.body.innerHTML).not.toContain("Shackleton");
  });

  test("the button opens the named side in a modal dialog and Close closes it", () => {
    const onDecide = mountStations({ named: "stn-shackleton" });
    fireEvent.click(screen.getByRole("button", { name: "Look at the other side of your Station" }));
    const dialog = screen.getByRole("dialog", { name: "Shackleton" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onDecide).not.toHaveBeenCalled();
  });

  test("Escape closes the dialog and gives the focus back to the button", () => {
    mountStations({ named: "stn-shackleton" });
    const button = screen.getByRole("button", { name: "Look at the other side of your Station" });
    // jsdom does not move the focus on a click.
    button.focus();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Shackleton" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test("another player's Station that was Flipped up and down again is offered under their name", () => {
    mountStations({}, { named: "stn-imbrium", revealed: true });
    const opponents = screen.getByRole("region", { name: "Opponents" });
    expect(within(opponents).queryByRole("button", { name: OTHER_SIDE })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Bea's Base" }));
    const base = screen.getByRole("region", { name: "Base" });
    fireEvent.click(
      within(base).getByRole("button", { name: "Look at the other side of Bea's Station" }),
    );
    expect(screen.getByRole("dialog", { name: "Imbrium" })).toBeTruthy();
  });

  test("a Station with no named side in the view has no button and no trace of one", () => {
    mountStations({ named: null }, { named: null });
    const named = source.cards.filter(
      (card) => card.type === "station" && card.id !== "stn-terran-outpost",
    );
    expect(named.length).toBeGreaterThan(0);
    const expectNoTrace = () => {
      expect(screen.queryByRole("button", { name: OTHER_SIDE })).toBeNull();
      for (const card of named) {
        expect(document.body.innerHTML).not.toContain(card.id);
        expect(document.body.innerHTML).not.toContain(card.name);
      }
    };
    expectNoTrace();
    fireEvent.click(screen.getByRole("button", { name: "View Bea's Base" }));
    expectNoTrace();
  });

  test("a Station with its named side up has no button", () => {
    mountStations({
      side: "named",
      cardId: "stn-shackleton",
      named: "stn-shackleton",
      revealed: true,
    });
    expect(
      within(screen.getByRole("region", { name: "Base" })).getByRole("img", { name: "Shackleton" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: OTHER_SIDE })).toBeNull();
  });
});
