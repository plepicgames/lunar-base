# 0005. Run the game as one replica with strategy Recreate

- **Date:** 2026-10-11
- **Status:** accepted

## Context and problem statement

The server keeps each game and the lobby in the memory of one process. There
is no database. The public deployment needs a replica count and an update
strategy.

## Considered options

- Run the game inside an existing Deployment.
- Its own Deployment with two or more replicas.
- Its own Deployment, one replica, strategy `Recreate`.

## Decision

Chose its own Deployment with one replica and strategy `Recreate`.

## Rationale

Two replicas would split the lobby: a player on one replica cannot see or join
a game on the other. A rolling update runs two processes for a short time and
has the same effect. `Recreate` stops the old process before the new one
starts.

## Consequences

- All players see one lobby.
- Each deployment ends the games in progress and causes a short outage.
- The game does not scale past one process until game state moves out of
  memory.
