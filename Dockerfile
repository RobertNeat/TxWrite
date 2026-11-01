# syntax=docker/dockerfile:1

#### Stage: frontend build ####
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN corepack enable \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set fetch-retries 10 \
    && pnpm config set fetch-retry-factor 2 \
    && pnpm config set fetch-retry-mintimeout 20000 \
    && pnpm config set fetch-retry-maxtimeout 120000 \
    && pnpm config set network-concurrency 4
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm fetch
COPY apps/frontend apps/frontend
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --offline --filter frontend...
RUN pnpm --filter frontend build

#### Stage: backend build ####
FROM node:24-bookworm-slim AS backend-build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/backend/package.json apps/backend/package.json
RUN corepack enable \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set fetch-retries 10 \
    && pnpm config set fetch-retry-factor 2 \
    && pnpm config set fetch-retry-mintimeout 20000 \
    && pnpm config set fetch-retry-maxtimeout 120000 \
    && pnpm config set network-concurrency 4
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm fetch
COPY apps/backend apps/backend
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --offline --filter backend...
RUN pnpm --filter backend build

#### Stage: runtime ####
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

# Toolchain packages (TeX Live, pandoc, fontconfig, etc.) will be installed here in a
# future session, before the app COPY below, so adding them does not bust the app layers.
# See docs/project_assumptons/technology.md section 9 for the planned toolchain list.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/backend/package.json apps/backend/package.json
RUN corepack enable \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set fetch-retries 10 \
    && pnpm config set fetch-retry-factor 2 \
    && pnpm config set fetch-retry-mintimeout 20000 \
    && pnpm config set fetch-retry-maxtimeout 120000 \
    && pnpm config set network-concurrency 4
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --prod --filter backend...

COPY --from=backend-build /repo/apps/backend/dist apps/backend/dist
COPY --from=frontend-build /repo/apps/frontend/dist/frontend/browser apps/backend/public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data
ENV CACHE_DIR=/cache

EXPOSE 3000
VOLUME ["/data", "/cache"]

CMD ["node", "apps/backend/dist/main.js"]
