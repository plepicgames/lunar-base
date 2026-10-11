import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);

/** The requests the guard aborted in one test. */
export interface Guard {
  /** Every URL aborted because its host is not the loopback. */
  readonly urls: string[];
  /** A spec that provokes an outside request on purpose says so; it then no longer fails. */
  acknowledge(): void;
  /** A second player's browser context, guarded like the first and closed after the test. */
  newContext(): Promise<BrowserContext>;
}

function isLocal(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return LOCAL_SCHEMES.has(protocol) || LOOPBACK.has(hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Every spec gets a context whose pages abort each HTTP request and each
 * WebSocket to a host other than the loopback, and cannot register a service
 * worker. An aborted request fails the test that made it, unless
 * the spec acknowledged it. The Vitest guard of T002 does not reach these
 * processes.
 */
export const test = base.extend<{ guard: Guard; newPlayer: () => Promise<Page> }>({
  guard: [
    async ({ context, browser }, use) => {
      const state = { acknowledged: false };
      const urls: string[] = [];
      const attach = async (target: BrowserContext): Promise<void> => {
        await target.route("**/*", async (route) => {
          const url = route.request().url();
          if (isLocal(url)) {
            await route.continue();
            return;
          }
          urls.push(url);
          await route.abort();
        });
        // BrowserContext.route does not see WebSockets; they need their own handler.
        await target.routeWebSocket(/.*/, (socket) => {
          const url = socket.url();
          if (isLocal(url)) {
            socket.connectToServer();
            return;
          }
          urls.push(url);
          void socket.close({ code: 1008, reason: "blocked by the loopback guard" });
        });
      };
      await attach(context);
      const extra: BrowserContext[] = [];
      await use({
        urls,
        acknowledge: () => {
          state.acknowledged = true;
        },
        newContext: async () => {
          // A service worker would answer requests before the route handler sees them.
          const made = await browser.newContext({ serviceWorkers: "block" });
          extra.push(made);
          await attach(made);
          return made;
        },
      });
      for (const made of extra) await made.close();
      if (!state.acknowledged) {
        expect(urls, "a page asked for a host other than the loopback").toEqual([]);
      }
    },
    { auto: true },
  ],
  newPlayer: async ({ guard }, use) => {
    await use(async () => await (await guard.newContext()).newPage());
  },
});

export { expect };
