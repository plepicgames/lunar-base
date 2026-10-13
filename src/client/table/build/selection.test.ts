import { describe, expect, test } from "vitest";
import { buildOption, buildOptions, capitalOptions } from "../../testing/build-fixture.ts";
import {
  buildSelection,
  plainOptions,
  type BuildAction,
  type Option,
  type Selection,
} from "./selection.ts";

const options = buildOptions;

/** Applies the actions in order, from a decision of `asked` that was just asked. */
function afterOf(asked: readonly Option[], ...actions: BuildAction[]): Selection {
  return actions.reduce<Selection>(
    (selection, action) => buildSelection(asked, action, selection),
    buildSelection(asked, { type: "open" }),
  );
}

function after(...actions: BuildAction[]): Selection {
  return afterOf(options, ...actions);
}

const ids = (selection: Selection) => selection.turns.map((option) => option.id);
const key = (x: number, y: number) => `${String(x)},${String(y)}`;
const cells = (selection: Selection) => selection.cells.map(({ x, y }) => key(x, y));
const capital = { type: "module", card: "c-4" } as const;

describe("buildSelection", () => {
  test("a decision just asked lists the Modules its options name, in the engine's order", () => {
    const selection = after();
    expect(selection.modules).toEqual(["c-1", "c-2"]);
    expect(selection.module).toBeNull();
    expect(selection.cells).toEqual([]);
    expect(selection.cell).toBeNull();
    expect(selection.turns).toEqual([]);
    expect(selection.option).toBeNull();
  });

  test("selecting a Module lists every cell a placement of it covers, and no other", () => {
    const depot = after({ type: "module", card: "c-1" });
    expect(depot.module).toBe("c-1");
    // Row by row: the top cell and the bottom cell of each placement, once.
    expect(cells(depot)).toEqual(["1,-1", "2,-1", "-2,0", "-1,0", "1,0", "2,0", "-1,1", "1,1"]);
    expect(depot.cell).toBeNull();
    expect(depot.option).toBeNull();

    const reactor = after({ type: "module", card: "c-2" });
    expect(cells(reactor)).toEqual(["-1,-1", "-1,0", "0,2", "0,3"]);
    const lunar = afterOf(capitalOptions, capital);
    expect(cells(lunar)).toEqual(["-1,-2", "-2,-1", "-1,-1", "0,-1", "1,-1", "1,0", "2,0", "1,1"]);
  });

  test("picking a place previews the first placement whose top cell it is, and else the first whose bottom cell it is", () => {
    const top = after({ type: "module", card: "c-1" }, { type: "cell", x: 1, y: 0 });
    expect(top.cell).toEqual({ x: 1, y: 0 });
    expect(top.option?.id).toBe("c-1:1,0,0");

    const bottom = after({ type: "module", card: "c-1" }, { type: "cell", x: 2, y: -1 });
    expect(bottom.cell).toEqual({ x: 2, y: -1 });
    expect(bottom.option?.id).toBe("c-1:1,-1,3");
  });

  test("the turns of a place are the placements that cover it", () => {
    const depot = { type: "module", card: "c-1" } as const;
    expect(ids(after(depot, { type: "cell", x: 1, y: 0 }))).toEqual([
      "c-1:1,0,0",
      "c-1:1,0,2",
      "c-1:1,0,3",
    ]);
    // Its own placement first, then the one that reaches up into it from 1,0.
    expect(ids(after(depot, { type: "cell", x: 1, y: -1 }))).toEqual(["c-1:1,-1,3", "c-1:1,0,2"]);
  });

  test("a cell that two Modules share keeps the turns of each Module apart", () => {
    const cell = { type: "cell", x: -1, y: 0 } as const;
    expect(ids(after({ type: "module", card: "c-1" }, cell))).toEqual(["c-1:-1,0,0", "c-1:-1,0,1"]);
    expect(ids(after({ type: "module", card: "c-2" }, cell))).toEqual(["c-2:-1,0,2"]);
  });

  test("turning steps through the legal turns of the cell and comes round again", () => {
    const steps: BuildAction[] = [
      { type: "module", card: "c-1" },
      { type: "cell", x: 1, y: 0 },
    ];
    const ids = [];
    for (let turn = 0; turn < 4; turn += 1) {
      ids.push(after(...steps).option?.id);
      steps.push({ type: "turn" });
    }
    expect(ids).toEqual(["c-1:1,0,0", "c-1:1,0,2", "c-1:1,0,3", "c-1:1,0,0"]);
  });

  test("turning steps through every placement that covers the place, each once, and comes round", () => {
    // Two of the five are turned left: a turn is a placement, not a quarter.
    let selection = afterOf(capitalOptions, capital, { type: "cell", x: -1, y: -1 });
    const seen = [];
    for (let turn = 0; turn < 6; turn += 1) {
      seen.push(selection.option?.id);
      selection = buildSelection(capitalOptions, { type: "turn" }, selection);
    }
    expect(seen).toEqual([
      "c-4:-1,-1,1",
      "c-4:-1,-1,2",
      "c-4:-1,-1,3",
      "c-4:-1,-2,0",
      "c-4:-2,-1,3",
      "c-4:-1,-1,1",
    ]);
  });

  test("a place that one placement covers stays on it", () => {
    const selection = after(
      { type: "module", card: "c-1" },
      { type: "cell", x: 2, y: -1 },
      { type: "turn" },
    );
    expect(selection.option?.id).toBe("c-1:1,-1,3");
  });

  test("the report's position: the cell above the Station is a place of Lunar Capital", () => {
    const places = afterOf(capitalOptions, capital);
    expect(places.cells).toContainEqual({ x: 0, y: -1 });

    const across = buildSelection(capitalOptions, { type: "cell", x: 0, y: -1 }, places);
    expect(across.option?.id).toBe("c-4:-1,-1,3");
    expect(across.option?.orbs).toEqual(["red", "blue"]);
    expect(across.turns).toHaveLength(1);

    expect(afterOf(capitalOptions, capital, { type: "cell", x: -1, y: -1 }).turns).toHaveLength(5);
    expect(ids(afterOf(capitalOptions, capital, { type: "cell", x: -1, y: -2 }))).toEqual([
      "c-4:-1,-2,0",
      "c-4:-1,-1,2",
    ]);
  });

  test("the selected option is the engine's own option: its id, price and Orbs", () => {
    const selection = after(
      { type: "module", card: "c-1" },
      { type: "cell", x: -1, y: 0 },
      { type: "turn" },
    );
    const engine = options.find((option) => option.id === "c-1:-1,0,1");
    expect(selection.option).toEqual(engine);
    expect(selection.option?.price).toBe(1);
    expect(selection.option?.orbs).toEqual(["blue", "wild"]);
  });

  test("a Module, a cell or a turn the options do not name changes nothing", () => {
    const open = after();
    expect(buildSelection(options, { type: "module", card: "c-3" }, open)).toBe(open);
    expect(buildSelection(options, { type: "cell", x: 1, y: 0 }, open)).toBe(open);
    expect(buildSelection(options, { type: "turn" }, open)).toBe(open);

    const depot = after({ type: "module", card: "c-1" });
    // 0,2 is a place of the Fusion Reactor only.
    expect(buildSelection(options, { type: "cell", x: 0, y: 2 }, depot)).toBe(depot);
    expect(buildSelection(options, { type: "turn" }, depot)).toBe(depot);
  });

  test("picking another Module drops the place of the first", () => {
    const selection = after(
      { type: "module", card: "c-1" },
      { type: "cell", x: 1, y: 0 },
      { type: "module", card: "c-2" },
    );
    expect(selection.module).toBe("c-2");
    expect(selection.cell).toBeNull();
    expect(selection.turns).toEqual([]);
    expect(selection.option).toBeNull();
  });

  test("back steps from the turn to the places, then to the Modules, and stops there", () => {
    const placed = after({ type: "module", card: "c-1" }, { type: "cell", x: 1, y: 0 });
    const places = buildSelection(options, { type: "back" }, placed);
    expect(places.module).toBe("c-1");
    expect(places.cells).toHaveLength(8);
    expect(places.cell).toBeNull();
    expect(places.option).toBeNull();

    const modules = buildSelection(options, { type: "back" }, places);
    expect(modules).toEqual(after());
    expect(buildSelection(options, { type: "back" }, modules)).toBe(modules);
  });

  test("open forgets what was chosen", () => {
    const placed = after({ type: "module", card: "c-1" }, { type: "cell", x: 1, y: 0 });
    expect(buildSelection(options, { type: "open" }, placed)).toEqual(after());
  });

  test.each([
    ["the Depot and the Fusion Reactor", buildOptions],
    ["Lunar Capital", capitalOptions],
  ])(
    "every placed option is reached from each of its two cells, once, and from no other: %s",
    (_, asked) => {
      // Where the bottom cell lies from the top cell, by quarter turn (R5.3).
      const below = [
        [0, 1],
        [-1, 0],
        [0, -1],
        [1, 0],
      ] as const;
      const reached = new Map<string, string[]>();
      let total = 0;
      for (const card of afterOf(asked).modules) {
        const module = afterOf(asked, { type: "module", card });
        for (const cell of module.cells) {
          let selection = buildSelection(asked, { type: "cell", ...cell }, module);
          for (let turn = 0; turn < selection.turns.length; turn += 1) {
            const { option } = selection;
            if (option === null) throw new Error("a place with no placement");
            // The engine's own object, not a copy of it.
            expect(asked).toContain(option);
            reached.set(option.id, [...(reached.get(option.id) ?? []), key(cell.x, cell.y)]);
            total += 1;
            selection = buildSelection(asked, { type: "turn" }, selection);
          }
        }
      }
      const placed = asked.filter((option) => "card" in option);
      expect([...reached.keys()].sort()).toEqual(placed.map((option) => option.id).sort());
      expect(total).toBe(placed.length * 2);
      for (const { id, x, y, q } of placed) {
        const [dx, dy] = below[q];
        expect(reached.get(id)?.toSorted()).toEqual([key(x, y), key(x + dx, y + dy)].toSorted());
      }
    },
  );
});

describe("plainOptions", () => {
  test("keeps the options that name no placement: skip", () => {
    expect(plainOptions(options).map((option) => option.id)).toEqual(["skip"]);
  });

  test("an option whose placement is incomplete stays a plain option and names no Module", () => {
    const broken = { id: "c-9:0,1,0", label: "Build Lab at 0,1 upright, pay 0", card: "c-9" };
    const mixed = [...options, broken, { ...buildOption("c-8", 0, 3, 0, 0, ["red"]), q: 4 }];
    expect(plainOptions(mixed).map((option) => option.id)).toEqual([
      "skip",
      "c-9:0,1,0",
      "c-8:0,3,0",
    ]);
    expect(buildSelection(mixed, { type: "open" }).modules).toEqual(["c-1", "c-2"]);
  });
});
