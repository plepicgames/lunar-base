// Hand-built views for the component tests. No test needs an engine run.

import type { GameView } from "../../protocol/messages.ts";

type FixturePlayer = GameView["players"][number];

export function player(seat: number, overrides: Partial<FixturePlayer> = {}): FixturePlayer {
  return {
    seat,
    credits: 3,
    colonists: 0,
    achievements: [],
    handSize: 2,
    base: {
      station: {
        instance: `station-${String(seat)}`,
        cardId: "stn-terran-outpost",
        side: "terran_outpost",
        named: null,
        revealed: false,
      },
      modules: [],
      orbs: { red: 0, blue: 0, yellow: 0, wild: 0 },
    },
    name: seat === 0 ? "Ann" : "Bea",
    kind: "human",
    connected: true,
    ...overrides,
  };
}

/** Ann (seat 0) and Bea (seat 1); Ann is the seat the view is for. */
export function view(overrides: Partial<GameView> = {}): GameView {
  return {
    you: 0,
    players: [
      player(0, {
        base: {
          station: {
            instance: "station-0",
            cardId: "stn-terran-outpost",
            side: "terran_outpost",
            named: null,
            revealed: false,
          },
          modules: [{ instance: "m-depot", cardId: "mod-depot", x: 1, y: 0, q: 1 }],
          orbs: { red: 0, blue: 0, yellow: 0, wild: 0 },
        },
      }),
      player(1),
    ],
    hand: [{ instance: "c-1", cardId: "mod-depot" }],
    supply: [],
    deck: 40,
    deckTop: null,
    discardCount: 0,
    discard: [],
    play: [],
    turn: { number: 3, seat: 0, step: "main_action" },
    targets: { credits: 20, colonists: 10, achievements: 5 },
    config: { seats: 2, influences: false, kickstarter: false },
    influencesInGame: [],
    result: null,
    pending: null,
    ...overrides,
  };
}

export const buildPending: NonNullable<GameView["pending"]> = {
  id: "d7",
  seat: 0,
  kind: "build",
  options: [
    { id: "skip", label: "Do not Build" },
    { id: "c-1:0,1,0", label: "Build Depot at 0,1 upright, pay 1" },
    { id: "c-1:2,0,1", label: "Build Depot at 2,0 turned right, pay 1" },
  ],
};
