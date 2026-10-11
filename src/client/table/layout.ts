// The client copy of rules 5.1 geometry. Keep this independent of the engine.
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly q: 0 | 1 | 2 | 3;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly bottom: { readonly x: number; readonly y: number };
}

/** Pixel box enclosing the card's two cells; y increases down the screen. */
export function layoutOf(placement: Placement, cell: number): Box {
  const steps = [
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 1, y: 0 },
  ] as const;
  const step = steps[placement.q];
  const bottom = { x: placement.x + step.x, y: placement.y + step.y };
  return {
    x: Math.min(placement.x, bottom.x) * cell,
    y: Math.min(placement.y, bottom.y) * cell,
    width: (Math.abs(step.x) + 1) * cell,
    height: (Math.abs(step.y) + 1) * cell,
    rotation: placement.q * 90,
    bottom,
  };
}
