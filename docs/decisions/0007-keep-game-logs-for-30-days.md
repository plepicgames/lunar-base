# 0007. Keep game logs on a small volume for 30 days

- **Date:** 2026-10-11
- **Status:** accepted

## Context and problem statement

A player who reports a problem gives a game ID. To find the cause, a
maintainer must see what happened in that game. The server writes one log file
for each game.

## Considered options

- Keep no logs.
- Keep logs without a time limit.
- Keep logs on a small volume and delete each one after 30 days.

## Decision

Chose a small volume and deletion after 30 days.

## Rationale

With the log, `npm run replay` replays a reported game. A log holds the seed
and the choices. It holds no address and no account. A time limit keeps the
volume small and keeps the data no longer than a report needs.

## Consequences

- A report with a game ID can be replayed for 30 days after the game.
- A report about an older game cannot be replayed.
- The deployment needs a volume, and the server needs a sweep that deletes
  old files.
