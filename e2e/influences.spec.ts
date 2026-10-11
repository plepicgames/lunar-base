import { expect, test } from "./fixtures.ts";

for (const kickstarter of [false, true]) {
  test(`Influences game with Kickstarter=${String(kickstarter)} reaches a result or turn 40 with one non-human player`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Name" })
      .fill(kickstarter ? "Kickstarter tester" : "Influence tester");
    await page.getByRole("button", { name: "Enter the lobby" }).click();
    await page.getByRole("spinbutton", { name: "Non-human players" }).fill("1");
    await page.getByRole("checkbox", { name: "Influences" }).check();
    if (kickstarter) await page.getByRole("checkbox", { name: "Kickstarter cards" }).check();
    await page.getByRole("button", { name: "Create game" }).click();
    await expect(page.getByRole("region", { name: "Table" })).toBeVisible();

    let turn = 0;
    let result = false;
    let defencesDeclined = 0;
    for (let step = 0; step < 2000; step += 1) {
      const state = await page.evaluate(() => {
        const result = document.querySelector('section[aria-label="Result"]') !== null;
        const turns = [...document.querySelectorAll('section[aria-label="Log"] li div')]
          .map((element) => /^Turn (\d+)$/.exec(element.textContent.trim()))
          .filter((match) => match !== null)
          .map((match) => Number(match[1]));
        const turn = Math.max(0, ...turns);
        const bar = document.querySelector('section[aria-label="Your decision"]');
        if (result || turn >= 40 || bar === null)
          return { result, turn, acted: false, defence: false };

        const kind = bar.getAttribute("data-kind");
        const named = (root: ParentNode, text: string) =>
          [...root.querySelectorAll<HTMLButtonElement>("button")].find(
            (button) => button.textContent.trim() === text && !button.disabled,
          );
        const enabled = (root: ParentNode | null) =>
          [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
            (button) => !button.disabled,
          );
        const dialog = document.querySelector('[role="dialog"]');
        const defence = kind === "defence";
        let button: HTMLButtonElement | undefined;
        if (defence) button = named(dialog ?? bar, "Decline");
        else if (kind === "build") button = named(bar, "Do not Build");
        else if (kind === "main_action")
          button = named(bar, "Terran Outpost: Resell x2, Draw") ?? enabled(bar);
        else if (kind === "flip")
          button =
            named(bar, "Confirm Stations") ??
            enabled(document.querySelector('section[aria-label="Opponents"]'));
        else
          button =
            enabled(dialog) ??
            document.querySelector<HTMLButtonElement>(
              "button[data-decision-option]:not([disabled])",
            ) ??
            enabled(document.querySelector('section[aria-label="Opponents"]')) ??
            enabled(bar);
        if (!button) throw new Error(`No enabled control for ${String(kind)}`);
        button.click();
        return { result, turn, acted: true, defence };
      });
      turn = Math.max(turn, state.turn);
      result = state.result;
      if (state.defence) {
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        defencesDeclined += 1;
      }
      if (result || turn >= 40) break;
      await page.waitForTimeout(state.acted ? 2 : 10);
    }

    expect(result || turn >= 40, `Stopped at turn ${String(turn)}`).toBe(true);
    if (!kickstarter) expect(defencesDeclined).toBe(2);
    console.log(
      `Influences flow (Kickstarter=${String(kickstarter)}): ${result ? "result" : `turn ${String(turn)}`}; declined ${String(defencesDeclined)} defence dialogs`,
    );
  });
}
