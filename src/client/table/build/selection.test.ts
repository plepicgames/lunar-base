import { describe, expect, test } from "vitest";
import { buildOption, buildOptions } from "../../testing/build-fixture.ts";
import { buildSelection, plainOptions, type BuildAction, type Selection } from "./selection.ts";

const options = buildOptions;

/** Applies the actions in order, from a decision that was just asked. */
function after(...actions: BuildAction[]): Selection {
  return actions.reduce<Selection>(
    (selection, action) => buildSelection(options, action, selection),
    buildSelection(options, { type: "open" }),
  );
}

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

  test("selecting a Module lists exactly the cells its options name", () => {
    const depot = after({ type: "module", card: "c-1" });
    expect(depot.module).toBe("c-1");
    expect(depot.cells).toEqual([
      { x: 1, y: -1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(depot.cell).toBeNull();
    expect(depot.option).toBeNull();

    const reactor = after({ type: "module", card: "c-2" });
    expect(reactor.cells).toEqual([
      { x: -1, y: 0 },
      { x: 0, y: 2 },
    ]);
  });

  test("selecting a cell lists exactly the turns its options name and previews the first", () => {
    const selection = after({ type: "module", card: "c-1" }, { type: "cell", x: 1, y: 0 });
    expect(selection.cell).toEqual({ x: 1, y: 0 });
    expect(selection.turns).toEqual([0, 2, 3]);
    expect(selection.option?.id).toBe("c-1:1,0,0");
  });

  test("a cell that two Modules share keeps the turns of each Module apart", () => {
    const cell = { type: "cell", x: -1, y: 0 } as const;
    expect(after({ type: "module", card: "c-1" }, cell).turns).toEqual([0, 1]);
    expect(after({ type: "module", card: "c-2" }, cell).turns).toEqual([2]);
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

  test("a cell with one legal turn stays on it", () => {
    const selection = after(
      { type: "module", card: "c-1" },
      { type: "cell", x: 1, y: -1 },
      { type: "turn" },
    );
    expect(selection.option?.id).toBe("c-1:1,-1,3");
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
    expect(places.cells).toHaveLength(3);
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

  test("every placed option is reached by exactly one Module, cell and turn", () => {
    const reached: string[] = [];
    for (const card of after().modules) {
      const module = after({ type: "module", card });
      for (const cell of module.cells) {
        let selection = buildSelection(options, { type: "cell", ...cell }, module);
        for (let turn = 0; turn < selection.turns.length; turn += 1) {
          reached.push(selection.option?.id ?? "none");
          selection = buildSelection(options, { type: "turn" }, selection);
        }
      }
    }
    const placed = options.filter((option) => option.id !== "skip").map((option) => option.id);
    expect(reached).toEqual(placed);
  });
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
