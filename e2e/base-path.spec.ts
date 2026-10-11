import { startServer, type RunningServer } from "../src/server/http.ts";
import { expect, test } from "./fixtures.ts";

// The one browser test of a base path in the default run: a second server in
// this process serves the client build that `npm start` made, under
// /play/lunar-base. `LUNAR_BASE_PATH=/play/lunar-base npx playwright test`
// runs every other spec under the same path.
const BASE = "/play/lunar-base";
let server: RunningServer;

test.beforeAll(async () => {
  server = await startServer({ port: 0, host: "127.0.0.1", basePath: BASE });
});

test.afterAll(async () => {
  await server.close();
});

test("under a base path the page, its files and its socket load, and the root is not found", async ({
  page,
}) => {
  const origin = `http://127.0.0.1:${String(server.port)}`;
  const refused: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) refused.push(`${String(response.status())} ${response.url()}`);
  });
  page.on("requestfailed", (request) => refused.push(`failed ${request.url()}`));
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));

  // The bare base redirects to its directory.
  await page.goto(`${origin}${BASE}`);
  expect(page.url()).toBe(`${origin}${BASE}/`);

  await page.getByRole("textbox", { name: "Name" }).fill("Ann");
  await page.getByRole("button", { name: "Enter the lobby" }).click();
  await expect(page.getByRole("heading", { name: "Create a game" })).toBeVisible();
  expect(sockets).toEqual([`ws://127.0.0.1:${String(server.port)}${BASE}/ws`]);

  // Every image on the page arrived, and so did the font.
  const logo = page.getByRole("img", { name: "Lunar Base" });
  await expect(logo).toHaveJSProperty("complete", true);
  expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(async () => (await document.fonts.ready).size)).toBeGreaterThan(0);
  expect((await page.request.get(`${origin}${BASE}/cards/w240/back-deck.webp`)).status()).toBe(200);
  expect(refused).toEqual([]);

  expect((await page.request.get(`${origin}/`)).status()).toBe(404);
  expect((await page.request.get(`${origin}/cards/w240/back-deck.webp`)).status()).toBe(404);
});
