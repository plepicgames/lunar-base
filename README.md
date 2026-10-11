# Lunar Base

This repository holds the online version of the Lunar Base card game by
Plepic Games OÜ. Today it holds governance files and documents only. The game
code arrives in later pull requests.

The plan for the work is
[`docs/working/publication/plan.md`](./docs/working/publication/plan.md).

## What this repository owns

| Owns | Does not own |
| --- | --- |
| The game: rules engine, server, browser client, card data and artwork (planned imports) | The shop site and the "Play online" box: [`hannosirkel/plepic`](https://github.com/hannosirkel/plepic) |
| The container image of the game (planned) | Kubernetes manifests: [`hannosirkel/deploys`](https://github.com/hannosirkel/deploys) |
| Its own documents, decisions and plans | The Argo CD Application and the public route: [`hannosirkel/orange`](https://github.com/hannosirkel/orange) |
| Problem reports about the game, as GitHub issues (planned) | Cross-repository standards: [`hannosirkel/architecture`](https://github.com/hannosirkel/architecture) |

## Visibility

This repository is declared public. Every file in it must be safe to publish.
Do not commit a secret, a private path, a machine name or a personal address.

## Develop and test

The game code is not in this repository yet. When it arrives, the commands are:

```sh
npm ci
npm run check
```

Enable the secret scan once in each checkout:

```sh
git config --local core.hooksPath .githooks
```

The hook needs [`gitleaks`](https://github.com/gitleaks/gitleaks). The
`Validate` workflow runs on each pull request: a secret scan over the full
history, a workflow lint and a link check.

## Build and deploy

Planned, not done. Nothing is built or deployed from this repository today.

| Step | Place |
| --- | --- |
| Build the container image | this repository |
| Hold the Kubernetes state | `hannosirkel/deploys`, root `lunar-base/` |
| Run the Argo CD Application and the public route | `hannosirkel/orange` |

## Documents

| Path | Holds |
| --- | --- |
| [`docs/current/`](./docs/current/overview.md) | What exists today |
| [`docs/decisions/`](./docs/decisions/) | Why each durable choice was made |
| [`docs/working/`](./docs/working/publication/plan.md) | Active plans |
| [`AGENTS.md`](./AGENTS.md) | Rules for agents that work here |

Cross-repository standards and initiatives live in
[`hannosirkel/architecture`](https://github.com/hannosirkel/architecture).

## Copyright

Copyright © 2026 Plepic Games OÜ. All rights reserved. No licence is granted.
See [`LICENSE`](./LICENSE) and
[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md).
