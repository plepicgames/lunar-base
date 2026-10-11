import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The digest guard runs in the one job that can write to the GitOps
// repository. Each refusal is exercised against a real Git checkout shaped
// like `hannosirkel/deploys`.

const guard = join(import.meta.dirname, "..", "scripts", "update-gitops-digest.sh");
const IMAGE = "ghcr.io/plepicgames/lunar-base";
const OVERLAY = "lunar-base/overlays/live";
const SENTINEL = `sha256:${"0".repeat(64)}`;
const FIRST = `sha256:${"a".repeat(64)}`;
const SECOND = `sha256:${"0123456789abcdef".repeat(4)}`;

function entry(digest: string, name = IMAGE): string[] {
  return [`  - name: ${name}`, `    newName: ${name}`, `    digest: ${digest}`];
}

/** The overlay as `deploys` holds it, with other lines in place of the image entry on request. */
function kustomization(image: string[] = entry(SENTINEL)): string {
  return [
    "---",
    "apiVersion: kustomize.config.k8s.io/v1beta1",
    "kind: Kustomization",
    "namespace: lunar-base",
    "resources:",
    "  - ../../base",
    "# Only the release workflow rewrites the `digest:` line.",
    "images:",
    ...image,
    "patches:",
    "  - target:",
    "      kind: Service",
    "      name: lunar-base",
    "    patch: |-",
    "      - op: replace",
    "        path: /spec/ports/0/port",
    "        value: 8141",
    "",
  ].join("\n");
}

const roots: string[] = [];

function git(repository: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** A committed, clean checkout whose live overlay holds `content`, or no file at all. */
function checkout(content: string | null = kustomization(), overlay = OVERLAY): string {
  const repository = mkdtempSync(join(tmpdir(), "lunar-gitops-guard-"));
  roots.push(repository);
  mkdirSync(join(repository, overlay), { recursive: true });
  writeFileSync(join(repository, "README.md"), "fixture\n");
  if (content !== null) writeFileSync(join(repository, overlay, "kustomization.yaml"), content);
  git(repository, "init", "--quiet", "--initial-branch=main");
  git(repository, "config", "user.name", "fixture");
  git(repository, "config", "user.email", "fixture@example.invalid");
  git(repository, "config", "commit.gpgsign", "false");
  git(repository, "add", "--all");
  git(repository, "commit", "--quiet", "--no-verify", "-m", "fixture");
  return repository;
}

function run(digest: string, repository: string, overlay = OVERLAY) {
  return spawnSync("sh", [guard, digest, join(repository, overlay)], { encoding: "utf8" });
}

function file(repository: string): string {
  return readFileSync(join(repository, OVERLAY, "kustomization.yaml"), "utf8");
}

function expectRefused(content: string | null, message: string, digest = FIRST): void {
  const repository = checkout(content);
  const result = run(digest, repository);
  expect(result.stderr).toContain(`digest update rejected: ${message}`);
  expect(result.status).toBe(1);
  expect(git(repository, "status", "--porcelain")).toBe("");
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("update-gitops-digest.sh", () => {
  it.each([
    ["the sentinel", SENTINEL],
    ["a promoted digest", SECOND],
  ])("replaces %s and leaves every other byte alone", (_name, current) => {
    const repository = checkout(kustomization(entry(current)));
    const path = join(repository, OVERLAY, "kustomization.yaml");
    const before = statSync(path);
    const result = run(FIRST, repository);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(file(repository)).toBe(kustomization(entry(FIRST)));
    expect(git(repository, "diff", "--numstat").trim()).toBe(`1\t1\t${OVERLAY}/kustomization.yaml`);
    expect(git(repository, "status", "--porcelain").trim()).toBe(`M ${OVERLAY}/kustomization.yaml`);
    const after = statSync(path);
    expect([after.ino, after.mode]).toEqual([before.ino, before.mode]);
  });

  it("keeps a file that does not end in a line break as it is", () => {
    const content = kustomization().trimEnd();
    const repository = checkout(content);
    expect(run(FIRST, repository).status).toBe(0);
    expect(file(repository)).toBe(content.replace(SENTINEL, FIRST));
  });

  it("changes nothing when the overlay already records the digest", () => {
    const repository = checkout(kustomization(entry(FIRST)));
    const result = run(FIRST, repository);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already records this digest");
    expect(git(repository, "status", "--porcelain")).toBe("");
  });

  it.each([
    ["no prefix", "a".repeat(64)],
    ["63 digits", `sha256:${"a".repeat(63)}`],
    ["65 digits", `sha256:${"a".repeat(65)}`],
    ["upper case", `sha256:${"A".repeat(64)}`],
    ["another algorithm", `sha512:${"a".repeat(64)}`],
    ["a second line", `${FIRST}\n    newTag: latest`],
    ["a tag", "latest"],
    ["nothing", ""],
  ])("refuses a malformed digest: %s", (_name, digest) => {
    expectRefused(kustomization(), "malformed digest", digest);
  });

  it("refuses the all-zero digest as the new value", () => {
    expectRefused(kustomization(entry(FIRST)), "the all-zero digest names no image", SENTINEL);
  });

  const NO_ENTRY = "unexpected image entry";
  const NO_DIGEST = "expected one digest";
  const other = "ghcr.io/example/other";
  const [name = "", newName = "", digestLine = ""] = entry(SENTINEL);

  it.each([
    ["a second image", [...entry(SENTINEL), ...entry(SECOND, other)], NO_DIGEST],
    ["a second entry without a digest", [...entry(SENTINEL), "  - name: other"], NO_ENTRY],
    ["a different image name", entry(SENTINEL, `${IMAGE}-x`), NO_ENTRY],
    ["a different new name", [name, `    newName: ${other}`, digestLine], NO_ENTRY],
    ["a newTag", [...entry(SENTINEL), "    newTag: latest"], NO_ENTRY],
    ["a newTag in place of the digest", [name, newName, "    newTag: latest"], NO_DIGEST],
    ["an entry after a comment", [...entry(SENTINEL), "# note", "  - name: other"], NO_ENTRY],
    ["a digest that is a tag", [name, newName, "    digest: latest"], NO_ENTRY],
    [
      "keys in another order",
      [`  - newName: ${IMAGE}`, `    name: ${IMAGE}`, digestLine],
      NO_ENTRY,
    ],
    ["an empty images block", [], NO_DIGEST],
  ])("refuses %s", (_name, image, message) => {
    expectRefused(kustomization(image), message);
  });

  it("refuses a file without an images block", () => {
    expectRefused(kustomization().replace("images:\n", "entries:\n"), "expected one images block");
  });

  it("refuses a second images block", () => {
    expectRefused(`${kustomization()}images:\n${entry(SECOND).join("\n")}\n`, "expected one");
  });

  it("refuses a missing file", () => {
    expectRefused(null, "kustomization is unavailable");
  });

  it("refuses a missing overlay directory", () => {
    const result = run(FIRST, checkout(), "lunar-base/overlays/none");
    expect(result.stderr).toContain("digest update rejected: overlay is unavailable");
    expect(result.status).toBe(1);
  });

  it("refuses another overlay of the same checkout", () => {
    const repository = checkout(kustomization(), "plepic/overlays/live");
    const result = run(FIRST, repository, "plepic/overlays/live");
    expect(result.stderr).toContain("digest update rejected: overlay is not permitted");
    expect(result.status).toBe(1);
    expect(git(repository, "status", "--porcelain")).toBe("");
  });

  it("refuses a checkout with another change in it", () => {
    const repository = checkout();
    writeFileSync(join(repository, "README.md"), "changed\n");
    const result = run(FIRST, repository);
    expect(result.stderr).toContain("digest update rejected: checkout is not clean");
    expect(file(repository)).toBe(kustomization());
  });

  it("refuses a wrong number of arguments", () => {
    const result = spawnSync("sh", [guard, FIRST], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });
});
