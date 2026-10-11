import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { replayScenario, type Scenario } from "../../../tools/scenario.ts";

const directory = fileURLToPath(new URL(".", import.meta.url));
const files = readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => ({
    name,
    scenario: JSON.parse(readFileSync(`${directory}/${name}`, "utf8")) as Scenario,
  }));

test("pins at least eight games across the required seat counts and options", () => {
  expect(files.length).toBeGreaterThanOrEqual(8);
  const baseSeats = files
    .filter(({ scenario }) => !scenario.config.influences && !scenario.config.kickstarter)
    .map(({ scenario }) => scenario.config.seats);
  for (const seats of [2, 4, 6]) expect(baseSeats).toContain(seats);
  expect(
    files.filter(({ scenario }) => scenario.config.influences && !scenario.config.kickstarter)
      .length,
  ).toBeGreaterThanOrEqual(2);
  expect(
    files.filter(({ scenario }) => !scenario.config.influences && scenario.config.kickstarter)
      .length,
  ).toBeGreaterThanOrEqual(1);
  expect(
    files.filter(({ scenario }) => scenario.config.influences && scenario.config.kickstarter)
      .length,
  ).toBeGreaterThanOrEqual(2);
  const conditions = new Set(files.flatMap(({ scenario }) => scenario.expected.conditions));
  for (const condition of ["credits", "colonists", "achievements"] as const)
    expect(conditions.has(condition), `${condition} ending is missing`).toBe(true);
});

test.each(files.map(({ name, scenario }) => [name, scenario] as const))(
  "%s: replays to the pinned result",
  (name, scenario) => {
    let actual: Scenario["expected"];
    try {
      actual = replayScenario(scenario);
    } catch (error) {
      throw new Error(
        `${name}: ${error instanceof Error ? error.message : String(error)}. Record again with npm run scenario:record -- '<config-json>' '<seed>'`,
        { cause: error },
      );
    }
    expect(
      actual,
      `${name}: replay changed; record again with npm run scenario:record -- '<config-json>' '<seed>'`,
    ).toEqual(scenario.expected);
    process.stdout.write(
      `${name}: ${actual.result.reason}, ${actual.conditions.join("+")}, turn ${String(actual.turns)}\n`,
    );
  },
);
