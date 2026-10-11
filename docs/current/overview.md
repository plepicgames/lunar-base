# Overview

This repository holds the online Lunar Base card game: one TypeScript code
base on Node.js 24.15 or newer, with its card data and artwork. A pure rules
engine decides everything. A small WebSocket server owns the games and sends
each player only what that player may see. A React client draws the table
from that view. Games live in the memory of one process.

| Document | Holds |
| --- | --- |
| [`rules.md`](./rules.md) | The rules the engine implements, with rule numbers |
| [`architecture.md`](./architecture.md) | The engine, the protocol, the server, the non-human players, the client and the tests |
| [`open-questions.md`](./open-questions.md) | The points where the rulebook is unclear, and the reading chosen |

No container image is built and nothing is deployed from this repository.
The [plan](../working/publication/plan.md) lists the work that remains.

## Layout

| Path | Holds |
| --- | --- |
| `src/engine/` | The rules: state, setup, actions, resolution, victory, per-seat views |
| `src/protocol/` | Message schemas (`zod`), view and event types, protocol version |
| `src/bots/` | The `DecisionMaker` interface, the built-in player, the Jev adapter |
| `src/server/` | HTTP, WebSocket, sessions, lobby, game rooms, game log |
| `src/client/` | The React application |
| `tools/` | Image pipeline, replay, soak run, scenario recorder, Jev probe |
| `assets/` | Derived images and their manifests |
| `docs/design/cards.json` | The card catalogue. The engine and the client load it |
| `e2e/` | Playwright browser tests |
| `test/` | Test setup: no network beyond the loopback address, no Jev key |
| `scripts/` | `validate` (the gate), `check.sh`, `start.sh`, `validate-cards.sh` |

Test files live next to the code as `*.test.ts` and `*.test.tsx`.

## Import boundaries

| Directory | May import | Must not use |
| --- | --- | --- |
| `src/engine` | Its own files and `docs/design/cards.json` | Anything else: no Node, DOM, timers, network, `Math.random`, `Date` |
| `src/protocol` | `src/engine` (types), `zod` | Node, DOM |
| `src/bots` | `src/engine`, `src/protocol`, `@typesafe-ai/sdk`, `zod` | `src/server`, `src/client`, DOM |
| `src/server` | `src/engine`, `src/protocol`, `src/bots`, Node, `ws`, `sirv` | `src/client` |
| `src/client` | `src/protocol`, React, CSS, `docs/design/cards.json` | `src/engine` code, `src/server`, `src/bots`, Node |

The boundaries are enforced twice, and both are part of the gate: each
directory has its own `tsconfig.json`, and ESLint `no-restricted-imports`
applies per directory.

Node runs the `.ts` files directly by type stripping. That sets the code
style: no `enum`, no parameter properties, no namespaces, `import type` for
types, and relative imports that end in `.ts`.

## Commands

| Command | Does |
| --- | --- |
| `npm ci` | Installs the locked dependencies |
| `bash scripts/validate` | The gate: format check, `shellcheck`, lint, types, card data and image manifests, unit and integration tests, client build. No browser, no network |
| `npm run check` | The gate, then the Playwright browser tests |
| `npm start` | Installs if needed, builds the client, serves the game on port 4780 |

The print files the images were made from are not in this repository. The
image build commands read their location from the environment; see
[`README.md`](../../README.md#rebuild-the-images).

## Checks and governance

| Path | Holds |
| --- | --- |
| `.github/workflows/validate.yml` | `scripts/validate`, the browser tests, secret scan over full history, workflow lint, link check |
| `.githooks/pre-commit` | Secret scan of staged changes |
| `.gitleaks.toml` | The default secret rules, with two fixed test values allowed |
| `renovate.json` | Dependency updates from the shared preset |
| `README.md` | Ownership, visibility, commands, settings |
| `AGENTS.md`, `CLAUDE.md`, `.habit-hooks/config.toml` | Rules and generated coaching configuration for agents |
| `LICENSE`, `THIRD-PARTY-NOTICES.md` | Copyright and third-party licences |
| `docs/decisions/` | Decisions 0001 to 0009 |
| `docs/working/publication/plan.md` | The plan to publish the game |
