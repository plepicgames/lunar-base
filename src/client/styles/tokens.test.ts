import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const tokens = readFileSync("src/client/styles/tokens.css", "utf8");

function color(name: string): number[] {
  const hex = tokens.match(new RegExp(`${name}:\\s*#([0-9a-f]{6})`, "i"))?.[1];
  if (!hex) throw new Error(`Missing ${name}`);
  return [0, 2, 4].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
}

function luminance(rgb: number[]): number {
  const [red, green, blue] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

test.each(["--space-900", "--space-800", "--space-700"])(
  "paper body text has at least 4.5:1 contrast on %s",
  (space) => {
    const light = luminance(color("--paper"));
    const dark = luminance(color(space));
    expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
  },
);
