# 0010. Turn Jev on in the public deployment

- **Date:** 2026-10-11
- **Status:** accepted
- **Supersedes:** [0006](./0006-keep-jev-off-in-the-public-deployment.md)

## Context and problem statement

Decision 0006 kept Jev off because every Jev move costs money and the public
server has no sign-in. The operator wants public games to offer Jev and has
provided an API key for this deployment.

## Considered options

- Jev off, as in decision 0006.
- Jev on, with the key in the deployment and the limits of row L6 as the cost
  control.

## Decision

Chose Jev on. The live deployment gets the key. The test deployment does not.

## Rationale

The operator owns the cost and made the choice. A game still makes no Jev
request unless its creator selects Jev, and the built-in player takes over
when a request fails.

## Consequences

- The key lives in the platform's secret store. No repository holds it. The
  cluster projects it into the game's namespace as a Kubernetes Secret, and
  the Deployment reads `TYPESAFE_API_KEY` from that Secret.
- The network policy allows one kind of egress: HTTPS to the Jev service, and
  the name lookup it needs. Everything else stays closed.
- The limits of row L6 are the cost control: a cap on games in total, and
  per visitor address a cap on open connections and on new games per hour.
  The public route does not open before they are in.
- The server already pauses Jev requests across all games after repeated
  failures, and keeps Jev off until restart after an authentication failure.
- The startup line says whether Jev is on. It never prints the key.
