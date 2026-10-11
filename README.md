# Lunar Base

This repository holds the online version of the Lunar Base card game by
Plepic Games OÜ: a web game for 2 to 6 players, any number of them non-human.
It holds the game code, the card data, the artwork and the design documents.
Nothing is deployed from it yet.

The plan for the work is
[`docs/working/publication/plan.md`](./docs/working/publication/plan.md).

## What this repository owns

| Owns | Does not own |
| --- | --- |
| The game: rules engine, server, browser client, card data and artwork | The shop site and the "Play online" box: [`hannosirkel/plepic`](https://github.com/hannosirkel/plepic) |
| The container image of the game (planned) | Kubernetes manifests: [`hannosirkel/deploys`](https://github.com/hannosirkel/deploys) |
| Its own documents, decisions and plans | The Argo CD Application and the public route: [`hannosirkel/orange`](https://github.com/hannosirkel/orange) |
| Problem reports about the game, as GitHub issues | Cross-repository standards: [`hannosirkel/architecture`](https://github.com/hannosirkel/architecture) |

## Visibility

This repository is declared public. Every file in it must be safe to publish.
Do not commit a secret, a private path, a machine name or a personal address.

## Play on your own machine

Install Node.js 24.15 or newer. Then run:

```sh
npm start
```

Open `http://localhost:4780`. The first start installs dependencies; every
start builds the client. No database, print file or credential is needed.

Enter a name to reach the lobby. Choose **Players** (2 to 6) and **Non-human
players** (0 to 6, at most the player count), then create a game. A game whose
other seats are all non-human starts at once. Otherwise another person enters
a name in their own browser tab or device and chooses **Join**. The table
offers each legal decision as a button.

The Create form offers **Influences** and **Kickstarter cards**, both off by
default. Kickstarter cards have no printed rules; the game follows its own
readings of them.

To let Jev play the non-human seats, set `TYPESAFE_API_KEY` in the environment
when starting. The key stays in memory; never put it in a file in this
repository. A Jev game falls back to the built-in player when a request fails.

### Settings

All are optional environment variables, for example `PORT=4800 npm start`.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4780` | HTTP and WebSocket port |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` to accept other devices on the local network |
| `LUNAR_BASE_PATH` | `/` | URL path the game is served under, for example `/play/lunar-base` |
| `TYPESAFE_API_KEY` | unset | Offers Jev as a choice for non-human players |
| `LUNAR_JEV_MODEL` | `jev-latest` | Jev model name |
| `LUNAR_SEED` | random per game | Fixed seed, to reproduce a game |
| `LUNAR_LOG_DIR` | `.data/games` | Directory the game logs are written to |
| `LUNAR_LOG_DAYS` | `30` | Days a game log is kept before the server deletes it: a whole number, 1 or more |
| `LUNAR_BOT_DELAY_MS` | `700` | Minimum delay of a non-human decision, in milliseconds |
| `LUNAR_TAKEOVER_DELAY_MS` | `60000` | Time before the built-in player takes over an absent human seat, in milliseconds |

## Report a problem

Use the **Report a problem** link at the bottom of the game, or open the
[issue form](https://github.com/plepicgames/lunar-base/issues/new?template=game-problem.yml)
yourself. You need a GitHub account.

- Say what happened and what you expected. A screenshot helps.
- The link fills in the game ID, the turn number, the screen, the game
  version and your browser. Leave them in. Without the link, copy the version
  from the bottom of the game.
- A report is public. Do not put a password, an e-mail address or other
  personal data in it.
- The link never sends the game's seed, your cards, your name or your session.

The game ID lets a developer find the server's log of that game and replay it.
The server keeps each log for 30 days and then deletes it
([decision 0007](./docs/decisions/0007-keep-game-logs-for-30-days.md)). A log
holds no name, session or address. Nothing is hosted yet.

The version is `dev` unless `LUNAR_BUILD` is set in the environment when the
client is built, for example `LUNAR_BUILD=1.4.0 npm start`.

For a question about buying the board game, write to
[Plepic Games support](https://plepicgames.com/support/lunar-base) instead.

## Develop and test

```sh
npm ci
bash scripts/validate
npm run check
```

| Command | Runs | Needs |
| --- | --- | --- |
| `bash scripts/validate` | Format check, `shellcheck`, lint, types, card data and image manifests, unit and integration tests, client build | `npm ci` done, `python3`, `shellcheck`, `zip` |
| `npm run check` | The same, then the browser tests | Also the Chromium of the pinned `@playwright/test`: `npx playwright install chromium` |

Neither command calls Jev, and the tests never download a browser.

Enable the secret scan once in each checkout:

```sh
git config --local core.hooksPath .githooks
```

The hook needs [`gitleaks`](https://github.com/gitleaks/gitleaks). The
`Validate` workflow runs on each pull request: `scripts/validate`, the browser
tests, a secret scan over the full history, a workflow lint and a link check.

### Reproduce a game

`npm run soak` plays 2,000 base games through the engine. Add `--influences`,
`--kickstarter`, or `--games N --seed S` for a shorter reproducible run:

```sh
npm run soak -- --games 100 --seed readme --influences --kickstarter
```

Game logs are written under `.data/games/`, or the directory in
`LUNAR_LOG_DIR`. Replay one with
`npm run replay -- .data/games/<game-id>.jsonl`; add `--at N` to see the public
view after N choices.

### Rebuild the images

The card, brand and help images are in `assets/`, so these commands are only
needed to make them again. The print files they are made from are not in this
repository. Each command stops with a message when its setting is missing.
Building needs `pdftoppm`; card building from an archive also needs `unzip`.

| Command | Input | Output |
| --- | --- | --- |
| `npm run assets:build` | `LUNAR_PRODUCTION_DIR`: the unpacked print files (default `.cache/production`). When that directory is absent, `LUNAR_PRODUCTION_ARCHIVE`: their zip archive, unpacked into it | `assets/cards/` |
| `npm run assets:brand` | `LUNAR_BRAND_DIR`: a directory with the brand source folders `LF`, `LS` and `PF`. `LUNAR_RULEBOOK_PDF`: the rulebook | `assets/brand/` |
| `npm run assets:help` | `LUNAR_RULEBOOK_PDF`: the rulebook | `assets/help/` |
| `npm run assets:verify` | The images and manifests in `assets/`; no print file | Checks every image against its manifest |

`npm run assets:build -- --only <card-id>` rebuilds one card. It replaces the
card manifest with that card's entries only, so rebuild the full set before
`assets:verify`.

## Build and deploy

Planned, not done. No container image is built and nothing is deployed from
this repository today.

| Step | Place |
| --- | --- |
| Build the container image | this repository |
| Hold the Kubernetes state | `hannosirkel/deploys`, root `lunar-base/` |
| Run the Argo CD Application and the public route | `hannosirkel/orange` |

## Documents

| Path | Holds |
| --- | --- |
| [`docs/current/overview.md`](./docs/current/overview.md) | What exists today: layout, import boundaries, commands |
| [`docs/current/rules.md`](./docs/current/rules.md) | The rules the engine implements, with rule numbers |
| [`docs/current/architecture.md`](./docs/current/architecture.md) | How the engine, the server, the client and the tests are built |
| [`docs/current/open-questions.md`](./docs/current/open-questions.md) | The points where the rulebook is unclear, and the reading chosen |
| [`docs/design/cards.json`](./docs/design/cards.json) | The card catalogue the engine and the client load |
| [`docs/decisions/`](./docs/decisions/) | Why each durable choice was made |
| [`docs/working/`](./docs/working/publication/plan.md) | Active plans |
| [`AGENTS.md`](./AGENTS.md) | Rules for agents that work here |

Cross-repository standards and initiatives live in
[`hannosirkel/architecture`](https://github.com/hannosirkel/architecture).

## Copyright

Copyright © 2026 Plepic Games OÜ. All rights reserved. No licence is granted.
See [`LICENSE`](./LICENSE) and
[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md).
