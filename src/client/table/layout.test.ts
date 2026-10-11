import { describe, expect, test } from "vitest";
import { layoutOf } from "./layout.ts";

describe("layoutOf", () => {
  test.each([
    [0, 0, 1, 0, 100, 200],
    [1, -1, 0, 90, 200, 100],
    [2, 0, -1, 180, 100, 200],
    [3, 1, 0, 270, 200, 100],
  ] as const)(
    "quarter turn %i puts the bottom cell at %i,%i",
    (q, dx, dy, rotation, width, height) => {
      const box = layoutOf({ x: 3, y: 4, q }, 100);
      expect(box.bottom).toEqual({ x: 3 + dx, y: 4 + dy });
      expect(box).toMatchObject({ rotation, width, height });
      expect(box.x).toBe(Math.min(3, 3 + dx) * 100);
      expect(box.y).toBe(Math.min(4, 4 + dy) * 100);
    },
  );
});
