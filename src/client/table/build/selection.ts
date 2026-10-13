// The Build decision D6 as three choices (architecture, Behaviour): a Module,
// one of its places, one of the turns of that place. A place is a cell that a
// placement of the Module covers, its top cell or its bottom cell; a turn is
// one of the placements that cover the place. The engine lists every legal
// Build as one option; this groups those options and never adds one.

import type { GameView } from "../../../protocol/messages.ts";
import { layoutOf } from "../layout.ts";

type Pending = NonNullable<GameView["pending"]>;
export type Option = Extract<Pending, { options: unknown }>["options"][number];
type Quarter = 0 | 1 | 2 | 3;

/** An option that names a Module, where it goes and what that costs and forms. */
export interface BuildOption extends Option {
  /** The instance of the Module in the hand. */
  readonly card: string;
  /** The top cell and the clockwise quarter turns (R5.3). */
  readonly x: number;
  readonly y: number;
  readonly q: Quarter;
  /** The Credits the Build costs. */
  readonly price: number;
  /** The colour of each Orb the placement forms. */
  readonly orbs: readonly string[];
}

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export interface Selection {
  /** The Modules the options name, in the engine's order. */
  readonly modules: readonly string[];
  readonly module: string | null;
  /** Every cell a placement of the chosen Module covers, row by row. */
  readonly cells: readonly Cell[];
  readonly cell: Cell | null;
  /**
   * The placements of the chosen Module that cover the chosen cell: those
   * whose top cell it is, then those whose bottom cell it is, each in the
   * engine's order.
   */
  readonly turns: readonly BuildOption[];
  /** The engine's option for the chosen Module, cell and turn. */
  readonly option: BuildOption | null;
}

export type BuildAction =
  /** The decision was asked: nothing is chosen. */
  | { readonly type: "open" }
  | { readonly type: "module"; readonly card: string }
  | { readonly type: "cell"; readonly x: number; readonly y: number }
  /** The next placement that covers the chosen cell, the first after the last. */
  | { readonly type: "turn" }
  /** One choice back: from the turn to the places, from the places to the Modules. */
  | { readonly type: "back" };

function isBuild(option: Option): option is BuildOption {
  const { card, x, y, q, price, orbs } = option;
  return (
    typeof card === "string" &&
    typeof x === "number" &&
    typeof y === "number" &&
    (q === 0 || q === 1 || q === 2 || q === 3) &&
    typeof price === "number" &&
    Array.isArray(orbs) &&
    orbs.every((orb) => typeof orb === "string")
  );
}

/** The options that name no placement, such as skip: each stays a button of its own. */
export function plainOptions(options: readonly Option[]): readonly Option[] {
  return options.filter((option) => !isBuild(option));
}

/** Every placement the options name for a Module, in the engine's order. */
export function placementsOf(options: readonly Option[], card: string): readonly BuildOption[] {
  return options.filter(isBuild).filter((option) => option.card === card);
}

function at(cell: Cell, other: Cell): boolean {
  return other.x === cell.x && other.y === cell.y;
}

/** The two cells a placement covers: its top cell, then its bottom cell. */
function cellsOf(option: BuildOption): readonly [Cell, Cell] {
  return [{ x: option.x, y: option.y }, layoutOf(option, 1).bottom];
}

/** The placements that cover a cell: by their top cell first, then by their bottom cell. */
function covering(placements: readonly BuildOption[], cell: Cell): readonly BuildOption[] {
  return ([0, 1] as const).flatMap((end) =>
    placements.filter((option) => at(cell, cellsOf(option)[end])),
  );
}

function select(
  options: readonly Option[],
  module: string | null,
  cell: Cell | null,
  id: string | null,
): Selection {
  const builds = options.filter(isBuild);
  const mine = builds.filter((option) => option.card === module);
  const covered = mine.flatMap(cellsOf);
  const turns = cell === null ? [] : covering(mine, cell);
  return {
    modules: [...new Set(builds.map((option) => option.card))],
    module,
    cells: covered
      .filter((one, index) => covered.findIndex((other) => at(one, other)) === index)
      .sort((one, other) => one.y - other.y || one.x - other.x),
    cell,
    turns,
    option: turns.find((option) => option.id === id) ?? null,
  };
}

/**
 * The selection after `action`. `from` is the selection before it; without one
 * nothing is chosen yet. An action that no option stands behind returns `from`.
 */
export function buildSelection(
  options: readonly Option[],
  action: BuildAction,
  from: Selection = select(options, null, null, null),
): Selection {
  switch (action.type) {
    case "open":
      return select(options, null, null, null);
    case "module":
      return from.modules.includes(action.card) ? select(options, action.card, null, null) : from;
    case "cell": {
      const cell = from.cells.find((candidate) => at(candidate, action));
      if (cell === undefined) return from;
      const first = covering(placementsOf(options, from.module ?? ""), cell).at(0);
      return select(options, from.module, cell, first?.id ?? null);
    }
    case "turn": {
      if (from.option === null) return from;
      const next = from.turns[(from.turns.indexOf(from.option) + 1) % from.turns.length];
      return select(options, from.module, from.cell, next.id);
    }
    case "back":
      if (from.cell !== null) return select(options, from.module, null, null);
      return from.module === null ? from : select(options, null, null, null);
  }
}
