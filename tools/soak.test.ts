import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "the soak CLI reports limits and work (Influences=%s, Kickstarter=%s)",
  (influences, kickstarter) => {
    const output = execFileSync(
      process.execPath,
      [
        "tools/soak.ts",
        ...(influences ? ["--influences"] : []),
        ...(kickstarter ? ["--kickstarter"] : []),
        "--games",
        "5",
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(output).toContain(
      `seats 2–6, influences ${String(influences)}, kickstarter ${String(kickstarter)}`,
    );
    const endings = /Endings: (\d+) victory, (\d+) turn cap, (\d+) step budget/.exec(output);
    if (!endings) throw new Error(`Missing ending counts: ${output}`);
    expect(
      endings
        .slice(1)
        .map(Number)
        .reduce((sum, count) => sum + count, 0),
    ).toBe(5);
    const work = /Largest turn.work: (\d+)/.exec(output);
    expect(Number(work?.[1])).toBeGreaterThan(0);
  },
  15_000,
);
