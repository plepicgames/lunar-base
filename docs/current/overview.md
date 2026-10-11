# Overview

This repository holds governance files and documents only. It holds no game
code, no card data and no artwork. Nothing is built or deployed from it.

| Path | Holds |
| --- | --- |
| `README.md` | Ownership, visibility, commands |
| `AGENTS.md`, `CLAUDE.md` | Rules for agents |
| `LICENSE`, `THIRD-PARTY-NOTICES.md` | Copyright and third-party licences |
| `.github/workflows/validate.yml` | Secret scan over full history, workflow lint, link check |
| `.githooks/pre-commit` | Secret scan of staged changes |
| `renovate.json` | Dependency updates from the shared preset |
| `.habit-hooks/config.toml` | Generated coaching configuration |
| `docs/decisions/` | Decisions 0001 to 0009 |
| `docs/working/publication/plan.md` | The plan to publish the game |

The game code arrives in the next rows of the
[plan](../working/publication/plan.md). Update this file in each of those pull
requests.
