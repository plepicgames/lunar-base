import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const port = 4791;
// `LUNAR_BASE_PATH=/play/lunar-base npx playwright test` runs the suite under
// that path. The specs open `./`, which is relative to this address.
const basePath = (process.env["LUNAR_BASE_PATH"] ?? "/").replace(/\/+$/, "");
const address = `http://127.0.0.1:${String(port)}${basePath}/`;

// The browser tests use the Chromium that is already installed and never
// download one. Playwright finds it in its own cache; when it is missing the
// run stops with a message that says so.
const chromium = (await import("@playwright/test")).chromium.executablePath();
if (!existsSync(chromium)) {
  console.error(
    `Browser step: the installed Chromium is missing (expected ${chromium}). ` +
      "Install it outside the check; the check never downloads a browser.",
  );
  process.exit(1);
}

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20_000,
  reporter: [["list"]],
  use: {
    baseURL: address,
    headless: true,
    serviceWorkers: "block",
    launchOptions: { executablePath: chromium },
  },
  webServer: {
    command: "npm start",
    url: address,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    env: {
      PORT: String(port),
      LUNAR_BASE_PATH: `${basePath}/`,
      LUNAR_SEED: "e2e-walking-skeleton",
      LUNAR_BOT_DELAY_MS: "0",
      LUNAR_TAKEOVER_DELAY_MS: "1000",
      // Every test comes from one address and most of them start a game.
      LUNAR_MAX_NEW_GAMES_PER_HOUR: "1000",
      // Empty counts as no credential: Jev stays off whatever the caller has.
      TYPESAFE_API_KEY: "",
    },
  },
});
