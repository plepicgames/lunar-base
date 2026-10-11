import { resolve } from "node:path";

/**
 * The print files the images are made from are not in this repository. Each
 * build tool reads their location from an environment variable and stops with
 * a message that names the variable when it is not set.
 */
export function sourceLocation(variable: string, holds: string): string {
  const value = process.env[variable]?.trim();
  if (!value) throw new Error(`Set ${variable} to ${holds}.`);
  return resolve(value);
}
