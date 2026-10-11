import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "../src/server/http.ts";
import { expect, test } from "./fixtures.ts";

// This spec shuts a server down, so it starts its own in this process, as
// base-path.spec.ts does. It never touches the server the other specs share.
let server: RunningServer;
let logs: string;

test.beforeAll(async () => {
  logs = mkdtempSync(join(tmpdir(), "lunar-e2e-shutdown-"));
  server = await startServer({
    port: 0,
    host: "127.0.0.1",
    botDelayMs: 600_000,
    log: () => {},
    logs: { directory: logs },
  });
});

test.afterAll(async () => {
  await server.close();
  rmSync(logs, { recursive: true, force: true });
});

test("a player at the table is told that the server restarted and can start again", async ({
  page,
}) => {
  await page.goto(`http://127.0.0.1:${String(server.port)}/`);
  await page.getByRole("textbox", { name: "Name" }).fill("Ann");
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  await page.getByRole("spinbutton", { name: "Players", exact: true }).fill("2");
  await page.getByRole("spinbutton", { name: "Non-human players" }).fill("1");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.getByRole("region", { name: "Table" })).toBeVisible();

  expect(await server.shutdown({ signal: "test" })).toEqual({ deadlineHit: false });

  await expect(
    page.getByText("The server restarted. This game has ended. Start a new game from the lobby."),
  ).toBeVisible();
  await expect(page.getByText("Reconnecting")).toHaveCount(0);
  // The table stays on screen, locked, and the one control left has the focus.
  await expect(page.getByRole("region", { name: "Table" })).toBeVisible();
  const again = page.getByRole("button", { name: "Start again" });
  await expect(again).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
  await expect(again).toHaveCount(0);
});
