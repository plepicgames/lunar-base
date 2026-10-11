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

## Problem reports

Problem reports are GitHub issues in this repository
([decision 0008](../decisions/0008-take-problem-reports-as-github-issues.md)).

| Part | Does |
| --- | --- |
| `src/client/ReportLink.tsx` | Shows "Report a problem" and "Version …" in the footer of every screen. The link opens the issue form in a new tab |
| `src/client/report.ts` | Builds the link. It fills the fields `game-id`, `turn`, `screen`, `build` and `browser`. Every value is percent-encoded, and the user agent is cut so the link stays below 2,000 characters |
| `.github/ISSUE_TEMPLATE/game-problem.yml` | The issue form. Its field `id`s are the names above. It adds the label `game-problem` and the title prefix `[game] ` |
| `.github/ISSUE_TEMPLATE/config.yml` | Allows blank issues. Sends questions about buying the board game to Plepic Games support |

- The game ID and the turn number are public: `game.update` carries both to
  every seat. Outside a game the link leaves both out. `screen` is `name`,
  `lobby`, `waiting`, `table` or `result`.
- The link never holds the seed, a hand, a session token or a player's name.
- The version is the value of `LUNAR_BUILD` when the client is built, or
  `dev`. The server writes its own `LUNAR_BUILD` in each game log's first
  line and in its startup output.
- A maintainer finds the game's log by its ID and replays it; see
  [`AGENTS.md`](../../AGENTS.md). The server deletes a log 30 days after its
  last write, or after `LUNAR_LOG_DAYS` days
  ([decision 0007](../decisions/0007-keep-game-logs-for-30-days.md)).

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

A running server answers `GET <base>/healthz` with `200`. `SIGTERM` or
`SIGINT` stops it: each player is told that the server restarts, and the
process exits with code 0 within 10 seconds; see
[`architecture.md`](./architecture.md#health-and-shutdown).

The print files the images were made from are not in this repository. The
image build commands read their location from the environment; see
[`README.md`](../../README.md#rebuild-the-images).

## Checks and governance

| Path | Holds |
| --- | --- |
| `.github/ISSUE_TEMPLATE/` | The problem-report form and its contact link |
| `.github/workflows/validate.yml` | `scripts/validate`, the browser tests, secret scan over full history, workflow lint, link check |
| `.githooks/pre-commit` | Secret scan of staged changes |
| `.gitleaks.toml` | The default secret rules, with two fixed test values allowed |
| `renovate.json` | Dependency updates from the shared preset |
| `README.md` | Ownership, visibility, commands, settings |
| `AGENTS.md`, `CLAUDE.md`, `.habit-hooks/config.toml` | Rules and generated coaching configuration for agents |
| `LICENSE`, `THIRD-PARTY-NOTICES.md` | Copyright and third-party licences |
| `docs/decisions/` | Decisions 0001 to 0009 |
| `docs/working/publication/plan.md` | The plan to publish the game |
