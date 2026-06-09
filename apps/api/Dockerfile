# PazarSync API container.
#
# Multi-stage build driven by `turbo prune --docker`, which computes the
# workspace dependency closure automatically — adding a new @pazarsync/*
# dependency to the api will NOT silently break this Dockerfile (no
# hand-maintained COPY list to drift).
#
# Build context MUST be the repository root, not apps/api:
#   docker build -f apps/api/Dockerfile -t pazarsync/api .
#
# Runs from TypeScript source via tsx — same model as apps/sync-worker. The
# workspace packages are source-export (their package.json `main` points at
# `src/*.ts`), so a `node dist/index.js` runtime cannot resolve them; tsx loads
# the source directly. A bundled production image is a future optimisation, not
# a correctness requirement.
#
# Generic + minimal: harden for your deployment target (non-root user,
# healthcheck, signal forwarding, secret injection) before shipping to prod.
#
# Required runtime env (inject at the orchestrator level — see .env.example):
#   DATABASE_URL, DIRECT_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, ENCRYPTION_KEY,
#   TRENDYOL_PROD_BASE_URL, TRENDYOL_SANDBOX_BASE_URL, PUBLIC_API_BASE_URL

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Bake pnpm into the base layer so no stage (especially runtime) downloads it
# at container start — keeps boot self-contained + network-independent.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Prune stage: the workspace subset (api + its dependency closure) only.
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@^2.9.12 prune @pazarsync/api --docker

# Install + prepare stage.
FROM base AS build
WORKDIR /app
# Copy the full pruned workspace + the pruned lockfile, then a SINGLE install.
# The root `postinstall` runs `pnpm --filter @pazarsync/db generate`, which needs
# the Prisma schema present (it is, in out/full — but would NOT be in a json-only
# manifests layer), so we don't split the install into a separate caching layer.
COPY --from=pruner /app/out/full/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Runtime stage: the prepared workspace, run from source via tsx.
FROM base AS runtime
WORKDIR /app
COPY --from=build /app ./
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["pnpm", "start"]
