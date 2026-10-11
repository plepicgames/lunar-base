# 0004. Reserve all rights and grant no licence

- **Date:** 2026-10-11
- **Status:** accepted

## Context and problem statement

The repository is public. A reader must know who holds the copyright and what
the reader may do with the game, its rules text, its artwork, its name and its
source code.

## Considered options

- An open-source licence.
- No licence file.
- A plain statement: copyright Plepic Games OÜ, all rights reserved.

## Decision

Chose the plain statement. The holder is Plepic Games OÜ. No licence is
granted. [`LICENSE`](../../LICENSE) says so, and
[`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md) keeps the notices of
third-party material.

## Rationale

The operator named the holder. A public repository without a licence already
grants nothing, but a reader cannot see that. A file that says so in plain
words removes the question. An open-source licence would give away the game.

## Consequences

- A reader may view the repository and fork it as GitHub's terms require.
  Nothing else is permitted.
- `THIRD-PARTY-NOTICES.md` must change when a shipped dependency changes.
