import { pathToFileURL } from "node:url";
import { jevMaker } from "../bots/jev/adapter.ts";
import { startServer } from "./http.ts";

export async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4780);
  const botDelayMs = Number(process.env.LUNAR_BOT_DELAY_MS ?? 700);
  const takeoverDelayMs = Number(process.env.LUNAR_TAKEOVER_DELAY_MS ?? 60_000);
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  const jev = apiKey
    ? jevMaker({ apiKey, fetch: globalThis.fetch, model: process.env.LUNAR_JEV_MODEL })
    : undefined;
  const running = await startServer({
    port,
    host: process.env.HOST ?? "127.0.0.1",
    ...(process.env.LUNAR_SEED === undefined ? {} : { seed: process.env.LUNAR_SEED }),
    botDelayMs,
    takeoverDelayMs,
    jev,
  });
  console.log(`Lunar Base is running at http://localhost:${String(running.port)}`);
  console.log(`Jev is ${jev ? "on" : "off"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
