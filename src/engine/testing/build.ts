// Test support: build Bases and a state by hand from catalogue ids. Engine
// tests use it; engine code does not.

import type { Base, BaseModule, CardOf, StationSide } from "../base.ts";
import { cardById } from "../catalogue.ts";
import type { Quarter } from "../geometry.ts";

/** A Module by catalogue id and its placement (R5.3). */
export type ModuleSpec = readonly [card: string, x: number, y: number, q: Quarter];

export interface BaseSpec {
  /** Catalogue id of the Station's named side. */
  readonly station: string;
  /** Default: Terran Outpost, as dealt (R3.3). */
  readonly side?: StationSide;
  /** Default: true exactly when the named side is up (R2.4). */
  readonly revealed?: boolean;
  readonly modules?: readonly ModuleSpec[];
}

/** The parts of the game state that exist so far (architecture, State). */
export interface BuiltState {
  /** Instance id to catalogue id. */
  readonly cards: Readonly<Record<string, string>>;
  /** One Base per seat. */
  readonly bases: readonly Base[];
}

/**
 * One Base per spec, in seat order. Instance ids are c1, c2, ... in the order
 * written: each Station, then its Modules.
 */
export function buildState(specs: readonly BaseSpec[]): BuiltState {
  const cards: Record<string, string> = {};
  const instance = (id: string): string => {
    const key = `c${String(Object.keys(cards).length + 1)}`;
    cards[key] = id;
    return key;
  };
  const bases = specs.map((spec): Base => {
    const station = cardById(spec.station);
    if (station.type !== "station" || !station.other_side) {
      throw new Error(`Card ${station.id} is not a named Station side`);
    }
    const side = spec.side ?? "terran_outpost";
    const card = instance(station.id);
    const modules = (spec.modules ?? []).map(([id, x, y, q]): BaseModule => {
      if (cardById(id).type !== "module") throw new Error(`Card ${id} is not a Module`);
      return { card: instance(id), x, y, q };
    });
    return { station: { card, side, revealed: spec.revealed ?? side === "named" }, modules };
  });
  return { cards, bases };
}

/** The resolver the Base functions take, for a table of instances. */
export function cardOfState(state: Pick<BuiltState, "cards">): CardOf {
  return (instance) => {
    if (!Object.hasOwn(state.cards, instance)) {
      throw new Error(`Unknown card instance: ${instance}`);
    }
    return cardById(state.cards[instance]);
  };
}

/** A single Base with its resolver. */
export function buildBase(spec: BaseSpec): { base: Base; cardOf: CardOf } {
  const state = buildState([spec]);
  return { base: state.bases[0], cardOf: cardOfState(state) };
}
