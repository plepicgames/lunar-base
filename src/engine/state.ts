import type { Base } from "./base.ts";
import type { CatalogueConfig } from "./catalogue.ts";
import type { RngState } from "./rng.ts";

export type Seat = number;
export type CardInstanceId = string;

export interface GameConfig extends CatalogueConfig {
  readonly startingSeat?: Seat;
}

/** Extensible frame/option data must remain serializable without an adapter. */
export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** One unit of work on the resolution stack; `loop.ts` steps it by its kind. */
export interface Frame {
  readonly id: string;
  readonly kind: string;
  readonly [key: string]: JsonValue;
}

export interface DecisionOption {
  readonly id: string;
  readonly label: string;
  readonly [key: string]: JsonValue;
}

export interface PendingDecision {
  readonly id: string;
  readonly seat: Seat;
  readonly kind: string;
  readonly options: readonly DecisionOption[];
}

export interface Choice {
  readonly seat: Seat;
  readonly decision: string;
  readonly option: string;
}

export type TurnStep = "agent" | "main_action" | "shuttle";

export interface Turn {
  readonly number: number;
  readonly seat: Seat;
  readonly step: TurnStep;
  readonly work: number;
}

export interface GameResult {
  readonly reason: "victory" | "step_limit";
  readonly winners: readonly Seat[];
  /** Number of victory conditions met by each seat (R11.3). */
  readonly scores: readonly number[];
}

/** Authoritative private state. Only per-seat views may leave the server. */
export interface GameState {
  readonly config: GameConfig;
  readonly cards: Readonly<Record<CardInstanceId, string>>;
  /** Top of the Deck is index 0. */
  readonly deck: readonly CardInstanceId[];
  readonly discard: readonly CardInstanceId[];
  readonly supply: readonly CardInstanceId[];
  readonly hands: readonly (readonly CardInstanceId[])[];
  readonly play: readonly CardInstanceId[];
  readonly removedStations: readonly CardInstanceId[];
  readonly bases: readonly Base[];
  readonly credits: readonly number[];
  readonly turn: Turn;
  readonly stack: readonly Frame[];
  readonly pending: PendingDecision | null;
  /** Frames pushed and decisions asked so far: the source of their ids. */
  readonly counters: { readonly frames: number; readonly decisions: number };
  readonly rng: RngState;
  readonly influencesInGame: readonly string[];
  readonly result: GameResult | null;
}
