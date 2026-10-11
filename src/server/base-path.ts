// The URL path the game is served under (`LUNAR_BASE_PATH`). The normal form
// is `/` or `/a/b`: a leading slash and no trailing one.

const BASE_PATH = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*\/?)?$/;

/** The normal form of a base path. Throws on anything but a plain absolute path. */
export function normalizeBasePath(value: string): string {
  const segments = value.split("/").filter((segment) => segment !== "");
  if (!BASE_PATH.test(value) || segments.some((segment) => /^\.+$/.test(segment))) {
    throw new Error(
      `LUNAR_BASE_PATH must be "/" or an absolute path such as "/play/lunar-base", ` +
        `with segments of letters, digits, ".", "_", "~" and "-" only; got ${JSON.stringify(value)}.`,
    );
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/** What a request path starts with under a base: `""` at the root, else the base. */
export function basePrefix(basePath: string): string {
  return basePath === "/" ? "" : basePath;
}
