# 0006. Keep Jev off in the public deployment

- **Date:** 2026-10-11
- **Status:** superseded by [0010](./0010-turn-jev-on-in-the-public-deployment.md)

## Context and problem statement

A non-human player can use the built-in player or Jev, a paid model that the
server calls through an API key. The public server has no sign-in, so any
visitor can start a game.

## Considered options

- Jev on for every visitor.
- Jev on behind a limit for each visitor.
- Jev off.

## Decision

Chose Jev off in the public deployment. The deployment sets no API key.

## Rationale

Every Jev move costs money, and no sign-in limits who can cause that cost. The
server already leaves Jev off when no key is present, so off needs no new
code. The built-in player stays available.

## Consequences

- A public game offers the built-in player only.
- The public deployment holds no API key.
- Turning Jev on later needs three things: a Secret with the key, the
  environment variable that reads it, and a network policy that lets the game
  reach the Jev service. The deployment allows no egress until then.
