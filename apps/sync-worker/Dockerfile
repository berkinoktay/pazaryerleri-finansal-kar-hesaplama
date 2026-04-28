# Sync worker container.
#
# Multi-stage build: install dependencies + run prisma generate in a
# build stage, then copy the prepared workspace into a clean runtime
# stage. Generic and minimal — adapt to your deployment target's
# conventions (non-root user, healthcheck, signal forwarding, log
# rotation, secret injection) before shipping to production.
#
# Required runtime env (inject at orchestrator level — Docker -e,
# Kubernetes Secret, etc.):
#   DATABASE_URL    — pgbouncer pool for runtime queries
#   DIRECT_URL      — direct connection (for migrations only; optional at runtime)
#   ENCRYPTION_KEY  — base64 AES-256 key for store credential decryption
#
# Build context must be the repository root, not apps/sync-worker:
#   docker build -f apps/sync-worker/Dockerfile -t pazarsync/sync-worker .

FROM node:20-alpine AS base
RUN npm install -g pnpm@10.33

FROM base AS build
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/db ./packages/db
COPY packages/marketplace ./packages/marketplace
COPY packages/sync-core ./packages/sync-core
COPY apps/sync-worker ./apps/sync-worker
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pazarsync/db generate

FROM base AS runtime
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/sync-worker
CMD ["pnpm", "start"]
