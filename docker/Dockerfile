# syntax=docker/dockerfile:1

# qq-bot — multi-stage build. The TypeScript toolchain (tsc, tsx, @types/node)
# lives only in the builder; the final image carries Node, the runtime
# dependencies, and the compiled dist/ — nothing else.
#
# The bot is an *outbound* WebSocket client (it dials QQ's gateway), not a
# server, so the image EXPOSEs no port. The `news` command persists fetched
# RSS items in a SQLite file under /app/data — mount a volume there to keep it
# across container replacements (see docker-compose.yml). Credentials are
# supplied at runtime via env vars (see .env.example); never bake them into
# the image.

# ---- builder: full dependency set, compile src/ -> dist/ ----
FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
# Manifests first so the install layer is cached until they actually change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# tsc build (src/ -> dist/). tsc fails on type errors, so this doubles as the
# typecheck gate for the image (CI also gates explicitly before building).
RUN pnpm build

# ---- prod-deps: resolve ONLY the runtime dependencies ----
FROM node:22-slim AS prod-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- runtime: Node + prod deps + dist, unprivileged ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# package.json is copied so its "main" field and CommonJS "type" sit next to
# dist/; node reads it when resolving the entry.
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
# Writable home for the news SQLite database (NEWS_DB_PATH, default data/news.db).
RUN mkdir -p /app/data && chown node:node /app/data
# Drop privileges to the `node` user (uid 1000) shipped by the official image.
USER node
# No HEALTHCHECK: the bot exposes no HTTP endpoint. It runs as PID 1, so if the
# process dies the container exits and the restart policy (see docker-compose or
# `docker run --restart`) brings it back.
# --disable-warning silences node:sqlite's ExperimentalWarning on Node 22.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
