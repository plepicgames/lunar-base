import type { Colour } from "./catalogue.ts";

export type OrbCounts = Readonly<Record<"red" | "blue" | "yellow" | "wild", number>>;

/** R6.2–R6.6: use the Base's current Orbs without consuming them. */
export function priceOf(cost: readonly Colour[], orbs: OrbCounts): number {
  const need = { red: 0, blue: 0, yellow: 0 };
  for (const colour of cost) {
    if (colour === "gray") throw new RangeError("Gray cost Orbs have no payment rule");
    need[colour] += 1;
  }
  const uncovered =
    Math.max(0, need.red - orbs.red) +
    Math.max(0, need.blue - orbs.blue) +
    Math.max(0, need.yellow - orbs.yellow);
  return Math.max(0, uncovered - orbs.wild);
}

/** R6.4: exact payment is affordable. */
export function canPay(price: number, credits: number): boolean {
  return price <= credits;
}
