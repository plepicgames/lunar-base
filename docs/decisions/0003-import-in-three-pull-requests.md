# 0003. Import in three pull requests

- **Date:** 2026-10-11
- **Status:** accepted

## Context and problem statement

The import is about 185 binary files and about 200 source files. That is above
the pull-request size gate. The code passes its checks only as a whole.

## Considered options

- One pull request for everything.
- Many small pull requests, one for each source directory.
- Three pull requests: data and artwork, then code, then design documents.

## Decision

Chose three pull requests. The operator approved the size override for the
import.

## Rationale

A pull request that holds one source directory cannot run `npm run check`, so
it cannot be verified. One pull request for everything mixes binary files,
code and documents in one review. Three pull requests give each kind its own
check: checksums for data and artwork, `npm ci && npm run check` for code, and
the link check for documents.

## Consequences

- Each of the three pull requests can be verified on its own terms.
- The code pull request is large. Its review relies on the checks and on the
  search for private paths.
- The size override applies to the import only.
