import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeClient,
  type EntryType,
  type Fetch,
} from "@typesafe-ai/sdk";
import { z } from "zod";
import { Declined } from "../fallback.ts";
import type { DecisionMaker } from "../maker.ts";
import { BREAKER_OFF_MS, createBreaker, type Breaker } from "./breaker.ts";
import { buildPrompt } from "./prompt.ts";

/** Time for one Jev attempt. */
export const JEV_ATTEMPT_MS = 4_000;

/** Retries of one decision, made by the SDK inside the decision's signal. */
export const JEV_RETRIES = 1;

export const JEV_MODEL = "jev-latest";

const BASE_URL = "https://api.typesafe.ai";

export type JevOptions = {
  /** The credential. It is held in memory by the SDK client and never logged. */
  apiKey: string;
  /** The transport. Tests pass a stub; nothing here reaches for the global `fetch`. */
  fetch: Fetch;
  model?: string;
  /** Receives one line per decision that was sent, and one when Jev goes off. */
  log?: (line: string) => void;
  /** The process's breaker. Makers that share it go off together. */
  breaker?: Breaker;
};

/**
 * The Jev decision maker: one `POST /v1/systemone` per decision. It is a
 * primary for `withFallback`: it rejects with `Declined` when it makes no
 * request and with a plain error when Jev gave no usable answer.
 * Client options and errors: `@typesafe-ai/sdk` 0.6.0 (read 2026-10-10).
 */
export function jevMaker(options: JevOptions): DecisionMaker {
  // Trimmed once: the same text is sent and is kept out of the log.
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("The Jev adapter needs a credential");
  const model = options.model ?? JEV_MODEL;
  const log = options.log ?? console.log;
  const breaker = options.breaker ?? createBreaker();
  // Every setting the SDK would otherwise read from the environment is given
  // here, so no variable can redirect the credential or turn on the SDK's own
  // request log, which prints headers.
  const client = new TypeSafeClient({
    apiKey,
    baseURL: BASE_URL,
    defaultModel: model,
    fetch: options.fetch,
    logLevel: "off",
    timeout: JEV_ATTEMPT_MS,
    retry: { maxRetries: JEV_RETRIES },
  });

  return {
    async decide(request, signal) {
      const prompt = buildPrompt(request);
      if (prompt === "too many") throw new Declined("too-many-options");
      // The budget is spent before a request was made: no failure of Jev.
      if (signal.aborted) throw new Error("Jev was not asked: the decision is aborted");
      const pass = breaker.admit();
      if (!pass) throw new Declined("off");

      const line = `jev decision=${request.decision.kind}`;
      // The SDK's error can quote the response, so neither its message nor the
      // error itself is logged or passed on: only a name for what went wrong.
      const fail = (detail: string) => {
        // The breaker hears of it first: a trial must report even if `log` throws.
        const opened = pass.failure();
        log(`${line} ${detail}`);
        if (opened) log(`jev breaker=open: Jev is off for ${String(BREAKER_OFF_MS / 1000)} s`);
        return new Error(`Jev gave no answer: ${detail}`);
      };

      let response: unknown;
      let failed: string | undefined;
      try {
        response = await client.systemOne(
          // The prompt is plain JSON; its view interfaces lack the SDK's index signature.
          { state: prompt.state as unknown as EntryType, questions: prompt.questions },
          { signal },
        );
      } catch (error) {
        failed = reasonOf(error);
      }
      if (failed === "status_401") {
        pass.disable();
        log(`${line} failed=${failed}: Jev is off until the server restarts`);
        throw new Error(`Jev gave no answer: failed=${failed}`);
      }
      if (failed) throw fail(`failed=${failed}`);

      const from = `model=${modelOf(response, apiKey)}`;
      const answer = z
        .object({
          model: z.string(),
          // Only an option id that was sent: narrowing may have left some out.
          answers: z.object({
            pick: z.object({ choice: z.enum(Object.keys(prompt.questions.pick.criteria)) }),
          }),
        })
        .safeParse(response);
      if (!answer.success) throw fail(`${from} failed=invalid_answer`);
      pass.success();
      log(`${line} ${from}`);
      return answer.data.answers.pick.choice;
    },
  };
}

/** Header text of the request. A response can repeat it, so no line holds it. */
const HEADER_TEXT = /authorization|bearer|api-key/i;

/**
 * The response's model id for the log and the error: a plain name that
 * repeats neither the credential nor header text. Anything else is unknown.
 */
function modelOf(response: unknown, apiKey: string): string {
  const named = z.object({ model: z.string().regex(/^[\w.:-]{1,64}$/) }).safeParse(response);
  if (!named.success) return "unknown";
  const model = named.data.model;
  const repeats = model.toLowerCase().includes(apiKey.toLowerCase()) || HEADER_TEXT.test(model);
  return repeats ? "unknown" : model;
}

/** A name for the log. Never the error's message: that can repeat the response. */
function reasonOf(error: unknown): string {
  if (error instanceof APIUserAbortError) return "aborted";
  if (error instanceof APITimeoutError) return "timeout";
  if (error instanceof APIConnectionError) return "connection";
  if (error instanceof APIError) return `status_${String(error.status)}`;
  return "error";
}
