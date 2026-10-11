import { pathToFileURL } from "node:url";
import { jevMaker } from "../bots/jev/adapter.ts";
import { normalizeBasePath } from "./base-path.ts";
import { gameLogSettings } from "./gamelog.ts";
import { startServer, type RunningServer } from "./http.ts";
import { describeJev, describeLimits, jevBudgetSetting, limitSettings } from "./limits.ts";

export async function main(): Promise<RunningServer> {
  // Read once, before listening: a bad LUNAR_LOG_DAYS stops the start, and
  // the server's logs and its sweep use these same values from here on.
  const logs = gameLogSettings(process.env);
  // Likewise: a bad limit stops the start, and the server keeps these values.
  const limits = limitSettings(process.env);
  // Likewise: a bad Jev budget stops the start, and the server keeps this value.
  const jevDecisionsPerHour = jevBudgetSetting(process.env);
  const port = Number(process.env.PORT ?? 4780);
  const botDelayMs = Number(process.env.LUNAR_BOT_DELAY_MS ?? 700);
  const takeoverDelayMs = Number(process.env.LUNAR_TAKEOVER_DELAY_MS ?? 60_000);
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  // With a budget of 0 no maker is built: the lobby then offers no Jev.
  const jev =
    apiKey && jevDecisionsPerHour > 0
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
    jevDecisionsPerHour,
    logs,
    limits,
  });
  const path = basePath === "/" ? "" : `${basePath}/`;
  console.log(`Lunar Base is running at http://localhost:${String(running.port)}${path}`);
  console.log(describeJev(Boolean(apiKey), jevDecisionsPerHour));
  console.log(
    `Game logs go to ${logs.directory} and are kept for ${String(logs.days)} ${logs.days === 1 ? "day" : "days"}; build ${logs.build}`,
  );
  console.log(describeLimits(limits));
  return running;
}

/** The part of `process` the signal handlers use. */
export interface SignalSource {
  on(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  exit(code: number): void;
}

/**
 * On SIGTERM or SIGINT shut the server down and exit with 0, also when the
 * shutdown hit its deadline. A second signal during shutdown exits at once
 * with 1.
 */
export function shutdownOnSignals(running: RunningServer, source: SignalSource = process): void {
  let begun = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    source.on(signal, () => {
      if (begun) {
        source.exit(1);
        return;
      }
      begun = true;
      void running.shutdown({ signal }).then(
        () => {
          source.exit(0);
        },
        (error: unknown) => {
          console.error(error);
          source.exit(1);
        },
      );
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
    .then((running) => {
      shutdownOnSignals(running);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
