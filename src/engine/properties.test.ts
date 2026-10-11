// Random legal games (architecture, Tests): whatever the players choose, the
// engine keeps the invariants below and replays to the same game.

import { isDeepStrictEqual } from "node:util";
import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";
import { halfOrb, placedCards, type CardOf } from "./base.ts";
import { cardById } from "./catalogue.ts";
import { cellsOf, jointsOf } from "./geometry.ts";
import { applyChoice, createGame, eventFor, type GameConfig, type GameState } from "./index.ts";
import { STEP_BUDGET } from "./loop.ts";
import { play, replay, seededPicker, TURN_CAP, type Played } from "./testing/play.ts";

const GAMES = 20;

function configOf(seats: number, influences = false, kickstarter = false): GameConfig {
  return { seats, influences, kickstarter };
}

/** Every place a card can be (R2.3), as one list of instance ids. */
function everywhere(state: GameState): string[] {
  return [
    ...state.deck,
    ...state.discard,
    ...state.supply,
    ...state.play,
    ...state.removedStations,
    ...state.hands.flat(),
    ...state.bases.flatMap((base) => [base.station.card, ...base.modules.map(({ card }) => card)]),
  ];
}

/** What is wrong with a state a game stopped in: nothing, for a legal game. */
function problemsOf(state: GameState): string[] {
  const problems: string[] = [];
  // Every instance id is in exactly one zone.
  const placedIds = everywhere(state).sort().join(" ");
  const dealtIds = Object.keys(state.cards).sort().join(" ");
  if (placedIds !== dealtIds) problems.push(`Zones hold ${placedIds}, the game ${dealtIds}`);

  state.credits.forEach((credits, seat) => {
    if (!Number.isInteger(credits) || credits < 0) {
      problems.push(`Seat ${String(seat)} has ${String(credits)} Credits`);
    }
  });

  const cardOf: CardOf = (instance) => cardById(state.cards[instance]);
  state.bases.forEach((base, seat) => {
    const placed = placedCards(base, cardOf);
    // R5.10: no two cards of a Base share a cell.
    const cells = placed.flatMap(({ placement }) => {
      const { top, bottom } = cellsOf(placement);
      return [top, bottom].map(({ x, y }) => `${String(x)},${String(y)}`);
    });
    if (new Set(cells).size !== cells.length) {
      problems.push(`Base ${String(seat)} covers a cell twice: ${cells.join(" ")}`);
    }
    // R5.11: a half-orb faces the same colour or a wild one; a blank edge faces a blank edge.
    placed.forEach((first, index) => {
      for (const second of placed.slice(index + 1)) {
        for (const joint of jointsOf(first.placement, second.placement)) {
          const a = halfOrb(first.card, joint.a);
          const b = halfOrb(second.card, joint.b);
          const legal =
            a === null || b === null ? a === b : a === b || a === "gray" || b === "gray";
          if (!legal) {
            problems.push(
              `Base ${String(seat)} joins ${first.card.id} ${joint.a} (${String(a)}) ` +
                `to ${second.card.id} ${joint.b} (${String(b)})`,
            );
          }
        }
      }
    });
  });

  // The game waits for a real choice, or it is over and waits for nothing.
  if (state.result === null) {
    if ((state.pending?.options.length ?? 0) < 2) problems.push("No choice is pending");
  } else if (state.pending !== null || state.stack.length > 0) {
    problems.push("A finished game still has a decision or a frame");
  }
  return problems;
}

/** Deep equality, with the full difference only when there is one: it is slow to build. */
function expectSame(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) expect(actual).toStrictEqual(expected);
}

/** The game ended, or reached the turn cap or the step budget. */
function checkEnding({ state }: Played): "victory" | "step_limit" | "turn_cap" {
  if (state.result === null) {
    expect(state.turn.number).toBe(TURN_CAP + 1);
    return "turn_cap";
  }
  const { reason, winners, scores } = state.result;
  expect(scores).toHaveLength(state.config.seats);
  if (reason === "step_limit") {
    expect(state.turn.work).toBe(STEP_BUDGET);
    expect(winners).toEqual([]);
  } else {
    const highest = Math.max(...scores);
    expect(highest).toBeGreaterThan(0);
    expect(winners).toEqual(scores.flatMap((score, seat) => (score === highest ? [seat] : [])));
  }
  return reason;
}

describe.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])("random legal games (influences=%s, kickstarter=%s)", (influences, kickstarter) => {
  let largestWork = 0;
  const seatsPlayed = new Set<number>();
  const endings = { victory: 0, step_limit: 0, turn_cap: 0 };

  test("never throw, keep every card, Credit and Base legal, end, and replay to the same game", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 2, max: 6 }),
        fc.string(),
        (seed, seats, pickerSeed) => {
          seatsPlayed.add(seats);
          const config = configOf(seats, influences, kickstarter);
          const played = play(config, seed, seededPicker(pickerSeed));
          expect([...new Set(played.states.flatMap(problemsOf))]).toEqual([]);
          const ending = checkEnding(played);
          expect(played.largestWork).toBeLessThanOrEqual(STEP_BUDGET);

          // Every event can be told to every audience.
          for (const event of played.events.flat()) {
            for (let seat = 0; seat < seats; seat += 1) eventFor(event, seat);
            eventFor(event, null);
          }

          const again = replay(config, seed, played.choices);
          expectSame(again.states, played.states);
          expectSame(again.events, played.events);

          endings[ending] += 1;
          largestWork = Math.max(largestWork, played.largestWork);
        },
      ),
      // A fixed seed: the check plays the same games on every run.
      { numRuns: GAMES, seed: 20261010, endOnFailure: true },
    );
  }, 20_000);

  test("use far fewer loop steps in a turn than the step budget", () => {
    const games = endings.victory + endings.step_limit + endings.turn_cap;
    // Written to the process itself: a reporter may hide the console of a passing test.
    process.stdout.write(
      `properties (influences=${String(influences)}, kickstarter=${String(kickstarter)}): largest turn.work ${String(largestWork)} of STEP_BUDGET ${String(STEP_BUDGET)} ` +
        `in ${String(games)} games: ${String(endings.victory)} victory, ` +
        `${String(endings.turn_cap)} turn cap, ${String(endings.step_limit)} step budget\n`,
    );
    expect(games).toBeGreaterThanOrEqual(GAMES);
    expect([...seatsPlayed].sort()).toEqual([2, 3, 4, 5, 6]);
    expect(largestWork).toBeGreaterThan(0);
    expect(largestWork).toBeLessThan(STEP_BUDGET);
  });
});

describe("one fixed game", () => {
  const config = configOf(2);
  let played: Played;
  beforeAll(() => {
    played = play(config, "lunar-base", seededPicker("picker"));
  });

  test("is played to a victory with the same winner in the same number of turns", () => {
    // Seat 1's Solicitor Flips seat 0 to Dark Side for its fifth achievement.
    // Victory interrupts before the Steal Module and Agent discard (R11.2).
    expect(played.state.result).toEqual({ reason: "victory", winners: [0], scores: [1, 0] });
    expect(played.state.turn).toMatchObject({ number: 37, seat: 1 });
    expect(played.choices).toHaveLength(107);
    expect(played.events.flat().slice(-2)).toMatchObject([
      { type: "station_flipped", flips: [{ seat: 0, card: { cardId: "stn-dark-side" } }] },
      { type: "game_ended", reason: "victory", winners: [0] },
    ]);
    const types = played.events.flat().map((event) => event.type);
    expect(types.filter((type) => type === "agent_played")).toHaveLength(12);
    expect(types.filter((type) => type === "agent_discarded")).toHaveLength(11);
    expect(played.state.play.map((id) => played.state.cards[id])).toEqual(["agt-solicitor"]);
    expect(types.filter((type) => type === "station_flipped")).toHaveLength(12);
  });

  test("is the same game through createGame and applyChoice", () => {
    let state = createGame(config, "lunar-base");
    expect(state).toStrictEqual(played.states[0]);
    played.choices.forEach((choice, index) => {
      const result = applyChoice(state, choice);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.events).toStrictEqual(played.events[index + 1]);
      state = result.state;
    });
    expect(state).toStrictEqual(played.state);
  });

  test("stops at the turn cap it is given, at that turn's first decision", () => {
    const short = play(config, "lunar-base", seededPicker("picker"), 3);
    expect(short.state.turn.number).toBe(4);
    expect(short.state.pending?.kind).toBe("main_action");
    expect(short.states).toStrictEqual(played.states.slice(0, short.states.length));
  });

  test("rejects a replay whose choice the game does not offer", () => {
    const [first] = played.choices;
    expect(() => replay(config, "lunar-base", [{ ...first, option: "none" }])).toThrow(
      "Choice 1 was rejected: Decision d1 has no option none.",
    );
  });
});
