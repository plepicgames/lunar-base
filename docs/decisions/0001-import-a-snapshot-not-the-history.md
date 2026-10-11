# 0001. Import a snapshot, not the history

- **Date:** 2026-10-11
- **Status:** accepted

## Context and problem statement

The game was built in a private build repository with 159 commits. Of these,
154 carry a `localhost` author address. The history also holds files that name
private paths. This repository is public.

## Considered options

- Import the full history.
- Rewrite the history, then import it.
- Import a snapshot of the current files.

## Decision

Chose the snapshot. The files are copied as they are today. No commit from the
private build repository is imported.

## Rationale

A snapshot cannot publish an old author address or a file that was deleted
later. A rewritten history must be checked commit by commit, and one miss is
public. The cost is that this repository does not show how the game was built.

## Consequences

- No private path or address enters through an old commit.
- `git blame` starts at the import, not at the original change.
- The private build repository stays the only record of the build history.
