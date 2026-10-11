import { expect, test } from "vitest";
import { actionHandlers } from "./actions/index.ts";
import { actionKey, actionsOf, catalogue } from "./catalogue.ts";

test("every action of the base Modules, Agents and Station faces has a handler", () => {
  const missing = catalogue
    .filter((card) => card.set === "base" && ["module", "agent", "station"].includes(card.type))
    .flatMap((card) =>
      actionsOf(card)
        .filter((action) => !Object.hasOwn(actionHandlers, actionKey(action)))
        .map((action) => `${card.id}: ${actionKey(action)}`),
    );
  expect(missing).toEqual([]);
});
