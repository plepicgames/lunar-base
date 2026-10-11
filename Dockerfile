# The Lunar Base game: one Node.js process that serves the built client and
# the WebSocket. Build from the repository root:
#
#     docker build --build-arg LUNAR_BUILD="$(git rev-parse HEAD)" .
#
# No setting of the Deployment is baked in. `HOST`, `PORT`, `LUNAR_BASE_PATH`,
# `LUNAR_LOG_DIR` and the rest come from the environment at run time, and the
# client is built with relative addresses, so one image serves any base path.
# The only value fixed at build time is `LUNAR_BUILD`, the Git commit: the
# version the client shows and the server writes into each game log.

# node:24.18.1-trixie-slim
FROM node:24.18.1-trixie-slim@sha256:ac39e4b5fcb2b1b34b20364fd58b2e898f3bb80731ee6f62a7536f9df3d6aadc AS build

WORKDIR /src

# The manifests first: the install layer is cached against the lockfile.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# `.dockerignore` admits only what the build reads.
COPY . .

ARG LUNAR_BUILD=dev
RUN LUNAR_BUILD="$LUNAR_BUILD" npx vite build

# node:24.18.1-trixie-slim
FROM node:24.18.1-trixie-slim@sha256:ac39e4b5fcb2b1b34b20364fd58b2e898f3bb80731ee6f62a7536f9df3d6aadc AS runtime-dependencies

WORKDIR /src

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# node:24.18.1-trixie-slim
FROM node:24.18.1-trixie-slim@sha256:ac39e4b5fcb2b1b34b20364fd58b2e898f3bb80731ee6f62a7536f9df3d6aadc AS runtime

# `source` is what links the package on GitHub to this repository.
LABEL org.opencontainers.image.source="https://github.com/plepicgames/lunar-base"
LABEL org.opencontainers.image.description="Lunar Base online card game"
# All rights reserved; see LICENSE. Not an SPDX licence, so a `LicenseRef-`.
LABEL org.opencontainers.image.licenses="LicenseRef-Proprietary"

ENV NODE_ENV=production

# UID and GID 10001, as `runAsUser` and `runAsGroup` on the Deployment in
# `hannosirkel/deploys`. The log directory exists and belongs to that user, so
# a fresh volume mounted there is writable. Nothing else is: the root
# filesystem is read-only in the cluster.
RUN groupadd --gid 10001 lunar \
  && useradd --uid 10001 --gid 10001 --home-dir /nonexistent --no-create-home lunar \
  && install --directory --owner 10001 --group 10001 /var/lib/lunar-base/games

# The image runs `node` and nothing else, so every package manager goes. Each
# vendors a dependency tree that `package-lock.json` does not govern, and the
# image scan in `release.yml` reads that tree too. The tests before and after
# make a base image change that moves them fail the build.
RUN test -x /usr/local/bin/npm && test -x /usr/local/bin/corepack \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
    /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && ! command -v npm && ! command -v npx && ! command -v corepack \
  && ! command -v yarn && ! command -v yarnpkg \
  && command -v node

WORKDIR /app

# Everything the server reads at run time, and nothing more. `package.json`
# carries `"type": "module"`; Node runs the `.ts` files by type stripping.
# `src/client` and `assets/` are not copied: they are inside `dist/client`.
COPY package.json ./
COPY --from=runtime-dependencies /src/node_modules ./node_modules
COPY --from=build /src/docs/design/cards.json ./docs/design/cards.json
COPY --from=build /src/src/engine ./src/engine
COPY --from=build /src/src/protocol ./src/protocol
COPY --from=build /src/src/bots ./src/bots
COPY --from=build /src/src/server ./src/server
COPY --from=build /src/dist/client ./dist/client

ARG LUNAR_BUILD=dev
ENV LUNAR_BUILD=$LUNAR_BUILD
LABEL org.opencontainers.image.revision=$LUNAR_BUILD

USER 10001:10001

EXPOSE 4780

# Exec form and no shell, so Node is process 1 and receives SIGTERM itself.
# Never `npm start`: under npm the signal does not reach the server. The base
# image's entrypoint script is cleared; the Deployment sets neither `command`
# nor `args`.
ENTRYPOINT []
CMD ["node", "src/server/main.ts"]
