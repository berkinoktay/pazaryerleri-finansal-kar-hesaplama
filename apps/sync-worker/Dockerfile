# Sync worker container.
#
# Multi-stage build driven by `turbo prune --docker`, which computes the
# workspace dependency closure automatically — the previous hand-maintained
# COPY list shipped only 3 of the 6 workspace packages the worker imports and
# drifted as dependencies changed. Prune removes that footgun.
#
# Generic + minimal — adapt to your deployment target's conventions (non-root
# user, healthcheck, signal forwarding, log rotation, secret injection) before
# shipping to production. Runs from TypeScript source via tsx (the workspace
# packages are source-export, so there is no built JS entry to run).
#
# Required runtime env (inject at orchestrator level — Docker -e,
# Kubernetes Secret, etc.):
#   DATABASE_URL    — pgbouncer pool for runtime queries
#   DIRECT_URL      — direct connection (for migrations only; optional at runtime)
#   ENCRYPTION_KEY  — hex-encoded AES-256 key for store credential decryption
#
# Build context must be the repository root, not apps/sync-worker:
#   docker build -f apps/sync-worker/Dockerfile -t pazarsync/sync-worker .

FROM node:20-alpine AS base
RUN npm install -g pnpm@10.33

# Prune stage: the workspace subset (worker + its dependency closure) only.
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@^2.9.12 prune @pazarsync/sync-worker --docker

# Install + prepare stage.
FROM base AS build
WORKDIR /app
# Copy the full pruned workspace + the pruned lockfile, then a SINGLE install.
# The root `postinstall` runs `pnpm --filter @pazarsync/db generate`, which needs
# the Prisma schema present (it is, in out/full — but would NOT be in a json-only
# manifests layer), so we don't split the install into a separate caching layer.
COPY --from=pruner /app/out/full/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# Runtime stage: the prepared workspace, run from source via tsx.
FROM base AS runtime
WORKDIR /app
COPY --from=build /app ./
WORKDIR /app/apps/sync-worker
CMD ["pnpm", "start"]
