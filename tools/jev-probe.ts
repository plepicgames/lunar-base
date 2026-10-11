// Manual live measurement. Keep outside npm run check and all tests.
import { performance } from "node:perf_hooks";
import type { Fetch } from "@typesafe-ai/sdk";
import { builtinMaker } from "../src/bots/builtin/index.ts";
import { withFallback } from "../src/bots/fallback.ts";
import { JEV_MODEL, jevMaker } from "../src/bots/jev/adapter.ts";
import { applyChoice, eventFor, startGame, viewFor, type ViewEvent } from "../src/engine/index.ts";

const SEED = "jev-probe-t068";
const TURN_CAP = 300;

async function main(): Promise<void> {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    process.stdout.write("Jev probe: TYPESAFE_API_KEY is missing; no request made.\n");
    return;
  }

  let requestChars = 0;
  const measuredFetch: Fetch = (url, init = {}) => {
    if (typeof init.body === "string") requestChars += init.body.length;
    return fetch(url, init);
  };
  let modelId: string;
  const jev = jevMaker({
    apiKey,
    model: process.env.LUNAR_JEV_MODEL || JEV_MODEL,
    fetch: measuredFetch,
    // The adapter emits only a sanitized model id. Never print other response text.
    log: (line) => {
      const match = /^jev decision=\S+ model=([\w.:-]+)(?: failed=invalid_answer)?$/.exec(line);
      if (match) modelId = match[1];
    },
  });
  const makers = [0, 1].map((seat) => withFallback(jev, builtinMaker(SEED, seat)));
  const histories: ViewEvent[][] = [[], []];
  const opened = startGame({ seats: 2, influences: false, kickstarter: false }, SEED);
  let state = opened.state;
  const addEvents = (events: typeof opened.events) => {
    for (const seat of [0, 1]) {
      histories[seat].push(
        ...events.map((event) => eventFor(event, seat)).filter((event) => event !== null),
      );
      if (histories[seat].length > 200) histories[seat].splice(0, histories[seat].length - 200);
    }
  };
  addEvents(opened.events);

  const latencies: number[] = [];
  let jevAnswers = 0;
  process.stdout.write(`Jev probe: seed=${SEED} seats=2\n`);
  while (state.result === null && state.turn.number <= TURN_CAP) {
    const decision = state.pending;
    if (!decision) throw new Error("Game stopped without a decision or result");
    const { seat, kind, id } = decision;
    const request = {
      seat,
      decision,
      view: viewFor(state, seat),
      events: histories[seat].slice(-200),
    };
    modelId = "none";
    const start = performance.now();
    const decided = await makers[seat].decideBy(request, new AbortController().signal);
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
    if (decided.by === "jev") jevAnswers++;
    process.stdout.write(
      `decision=${String(latencies.length)} kind=${kind} latency_ms=${elapsed.toFixed(1)} by=${decided.by} model=${modelId}\n`,
    );
    const applied = applyChoice(state, { seat, decision: id, option: decided.option });
    if (!applied.ok) throw new Error(`Game rejected decision ${String(latencies.length)}`);
    state = applied.state;
    addEvents(applied.events);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  process.stdout.write(
    `totals decisions=${String(latencies.length)} jev_answers=${String(jevAnswers)} ` +
      `fallbacks=${String(latencies.length - jevAnswers)} median_latency_ms=${median.toFixed(1)} ` +
      `largest_latency_ms=${sorted.at(-1)?.toFixed(1) ?? "0.0"} ` +
      `approx_input_tokens=${String(Math.ceil(requestChars / 4))} ` +
      `ending=${state.result?.reason ?? "turn_cap"}\n`,
  );
}

void main().catch(() => {
  // Errors from a live service can contain the credential. Print a fixed message.
  process.stderr.write("Jev probe failed; no error details printed.\n");
  process.exitCode = 1;
});
