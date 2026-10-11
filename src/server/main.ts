import { pathToFileURL } from "node:url";
import { jevMaker } from "../bots/jev/adapter.ts";
import { normalizeBasePath } from "./base-path.ts";
import { gameLogSettings } from "./gamelog.ts";
import { startServer, type RunningServer } from "./http.ts";

export async function main(): Promise<RunningServer> {
  // Read once, before listening: a bad LUNAR_LOG_DAYS stops the start, and
  // the server's logs and its sweep use these same values from here on.
  const logs = gameLogSettings(process.env);
  const port = Number(process.env.PORT ?? 4780);
  const botDelayMs = Number(process.env.LUNAR_BOT_DELAY_MS ?? 700);
  const takeoverDelayMs = Number(process.env.LUNAR_TAKEOVER_DELAY_MS ?? 60_000);
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  const jev = apiKey
    ? jevMaker({ apiKey, fetch: globalThis.fetch, model: process.env.LUNAR_JEV_MODEL })
    : undefined;
  const basePath = normalizeBasePath(process.env.LUNAR_BASE_PATH ?? "/");
  const running = await startServer({
    port,
    host: process.env.HOST ?? "127.0.0.1",
    basePath,
    ...(process.env.LUNAR_SEED === undefined ? {} : { seed: process.env.LUNAR_SEED }),
    botDelayMs,
    takeoverDelayMs,
    jev,
    logs,
  });
  const path = basePath === "/" ? "" : `${basePath}/`;
  console.log(`Lunar Base is running at http://localhost:${String(running.port)}${path}`);
  console.log(`Jev is ${jev ? "on" : "off"}`);
  console.log(
    `Game logs go to ${logs.directory} and are kept for ${String(logs.days)} ${logs.days === 1 ? "day" : "days"}; build ${logs.build}`,
  );
  return running;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
