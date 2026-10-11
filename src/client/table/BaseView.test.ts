import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, test } from "vitest";
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
