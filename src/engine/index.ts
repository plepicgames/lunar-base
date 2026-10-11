// The engine's interface (architecture, Interface). Code outside
// `src/engine` imports here; bots may also reuse the pure RNG in rng.ts.

export { applyChoice, createGame, startGame } from "./game.ts";
export { eventFor } from "./events.ts";
export { viewFor } from "./view.ts";

export type {
  PlayerView,
  ViewBase,
  ViewCard,
  ViewPending,
  ViewPlayer,
  ViewStation,
} from "./view.ts";

export type { Base, BaseModule, BaseStation, StationSide } from "./base.ts";
export type { ChoiceError, ChoiceErrorCode } from "./decisions.ts";
export type { EventCard, GameEvent, ViewEvent } from "./events.ts";
export type { Placement, Quarter } from "./geometry.ts";
export type { ChoiceResult } from "./loop.ts";
export type { RngState } from "./rng.ts";
export type {
  CardInstanceId,
  Choice,
  DecisionOption,
  Frame,
  GameConfig,
  GameResult,
  GameState,
  JsonValue,
  PendingDecision,
  Seat,
  Turn,
  TurnStep,
} from "./state.ts";

// Public, pure rules for evaluating only the cards visible in a PlayerView.
export { catalogue, type CardDef, type ActionDef } from "./catalogue.ts";
export { legalPlacements } from "./placement.ts";
export { priceOf, type OrbCounts } from "./price.ts";
