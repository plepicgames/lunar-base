import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import sirv from "sirv";

/** Serve the client build from the repository, regardless of cwd. */
let handler: ReturnType<typeof sirv> | undefined;
export function serveStatic(request: IncomingMessage, response: ServerResponse): void {
  try {
    handler ??= sirv(resolve(import.meta.dirname, "../../dist/client"), { single: true });
    handler(request, response);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    response.writeHead(404).end("Client build not found.");
  }
}
