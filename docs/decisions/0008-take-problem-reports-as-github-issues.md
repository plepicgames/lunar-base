# 0008. Take problem reports as GitHub issues

- **Date:** 2026-10-11
- **Status:** accepted

## Context and problem statement

Players need a way to report a problem with the game. Maintainers need the
game ID with each report.

## Considered options

- A report form inside the game that stores reports on the server.
- Reports by e-mail.
- GitHub issues in this repository, opened from a link in the game.

## Decision

Chose GitHub issues. The game links to a pre-filled issue form.

## Rationale

The operator asked for this. Issues need no storage and no new service on the
public server. The trade-off is that a reporter needs a GitHub account.

## Consequences

- Reports are public and sit next to the code.
- A player without a GitHub account cannot report a problem this way.
- Issue text is written by strangers; see
  [decision 0009](./0009-work-on-an-issue-only-after-agent-ready.md).
