import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import sirv from "sirv";
import { basePrefix } from "./base-path.ts";

/** The client build in the repository, regardless of cwd. */
const CLIENT_DIR = resolve(import.meta.dirname, "../../dist/client");

/**
 * Serve the client build below a normalised base path. The bare base
 * redirects to its directory; every path outside the base is 404.
 */
export function staticHandler(
  basePath: string,
  clientDir = CLIENT_DIR,
): (request: IncomingMessage, response: ServerResponse) => void {
  const prefix = basePrefix(basePath);
  let handler: ReturnType<typeof sirv> | undefined;
  return (request, response) => {
    const url = request.url ?? "/";
    const query = url.indexOf("?");
    const path = query === -1 ? url : url.slice(0, query);
    if (prefix !== "" && path === prefix) {
      response.writeHead(308, { Location: `${prefix}/${query === -1 ? "" : url.slice(query)}` });
      response.end();
      return;
    }
    if (!path.startsWith(`${prefix}/`)) {
      response.writeHead(404).end("Not found.");
      return;
    }
    request.url = url.slice(prefix.length);
    try {
      handler ??= sirv(clientDir);
      handler(request, response);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      response.writeHead(404).end("Client build not found.");
    }
  };
}
