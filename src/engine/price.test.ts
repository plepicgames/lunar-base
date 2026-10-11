import { expect, test } from "vitest";
import { cardById } from "./catalogue.ts";
import { canPay, priceOf } from "./price.ts";

const none = { red: 0, blue: 0, yellow: 0, wild: 0 } as const;

test.each([
  ["agt-solicitor", { ...none, blue: 2 }, 2],
  ["agt-mormon-scientist", { ...none, blue: 2, red: 2 }, 0],
  ["mod-space-elevator", { ...none, blue: 2, red: 2 }, 2],
  ["agt-double-agent", none, 2],
] as const)("reproduces the rulebook price of %s", (id, orbs, expected) => {
  expect(priceOf(cardById(id).cost, orbs)).toBe(expected);
});

test("one wild Orb lowers a two-Credit price by exactly one", () => {
  const cost = cardById("agt-double-agent").cost;
  expect(priceOf(cost, none)).toBe(2);
  expect(priceOf(cost, { ...none, wild: 1 })).toBe(1);
});

test("two blue Orbs cannot cover three blue cost Orbs", () => {
  expect(priceOf(["blue", "blue", "blue"], { ...none, blue: 2 })).toBe(1);
});

test("surplus coloured Orbs cannot cover another colour", () => {
  expect(priceOf(["red", "blue", "yellow"], { ...none, blue: 8 })).toBe(2);
});

test("matches coloured Orbs before applying wild Orbs, regardless of cost order", () => {
  const orbs = { ...none, blue: 1, wild: 1 };
  expect(priceOf(["blue", "yellow"], orbs)).toBe(0);
  expect(priceOf(["yellow", "blue"], orbs)).toBe(0);
});

test("surplus wild Orbs never make the price negative", () => {
  expect(priceOf(["red"], { ...none, wild: 3 })).toBe(0);
});

test("a card with no cost is free with or without Base Orbs", () => {
  expect(priceOf([], none)).toBe(0);
  expect(priceOf([], { red: 2, blue: 2, yellow: 2, wild: 2 })).toBe(0);
});

test("Orbs count again for each card and neither input is changed", () => {
  const cost = Object.freeze(["blue", "blue", "yellow", "yellow"] as const);
  const orbs = Object.freeze({ ...none, blue: 2, wild: 1 });
  expect(priceOf(cost, orbs)).toBe(1);
  expect(priceOf(cost, orbs)).toBe(1);
  expect(cost).toEqual(["blue", "blue", "yellow", "yellow"]);
  expect(orbs).toEqual({ red: 0, blue: 2, yellow: 0, wild: 1 });
});

test("rejects gray cost Orbs, which have no defined payment rule", () => {
  expect(() => priceOf(["gray"], none)).toThrow(RangeError);
});

test.each([
  [2, 1, false],
  [2, 2, true],
  [2, 3, true],
  [0, 0, true],
])("canPay(%i, %i) is %s", (price, credits, expected) => {
  expect(canPay(price, credits)).toBe(expected);
});
