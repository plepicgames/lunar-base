// Where the page is served from. The build uses relative URLs, so one build
// serves any base path: the client reads the base from the document's address.

/** The directory of the page, for example `https://host/play/lunar-base/`. */
function baseUrl(page: string): URL {
  return new URL(".", page);
}

/** The root-relative address of a file of the build, given without a leading slash. */
export function assetUrl(file: string, page: string = document.baseURI): string {
  return new URL(file, baseUrl(page)).pathname;
}

/** The game server's WebSocket: `ws` beside the page, over TLS when the page is. */
export function socketUrl(page: string = document.baseURI): string {
  const url = new URL("ws", baseUrl(page));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/**
 * The `sessionStorage` key of the session token. Two games under different
 * base paths of one origin keep separate tokens.
 */
export function tokenKey(page: string = document.baseURI): string {
  const { pathname } = baseUrl(page);
  return pathname === "/" ? "lunar-base.token" : `lunar-base.token:${pathname}`;
}
