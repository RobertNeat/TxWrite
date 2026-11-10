ARG RUNTIME_VERSION
FROM 192.168.1.162:5000/library/node:${RUNTIME_VERSION}-alpine AS build
RUN apk upgrade --no-cache
ARG PACKAGE_NAME
ARG PROJECT_PATH
WORKDIR /workspace
# corepack downloads the pinned package manager from registry.npmjs.org by default,
# ignoring .npmrc; point it at the local registry too.
ENV COREPACK_NPM_REGISTRY=http://192.168.1.163
RUN corepack enable
ENV npm_config_store_dir=/pnpm/store

# Install dependencies before copying the rest of the source so this layer
# (and the pnpm store cache mount below) stays valid across source-only
# commits, avoiding a full cold reinstall of every package on every build.
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/ftps-remote-manager/package.json ./apps/ftps-remote-manager/package.json
COPY apps/mqtt-puppeteer/package.json ./apps/mqtt-puppeteer/package.json
COPY apps/octo-management-dashboard/package.json ./apps/octo-management-dashboard/package.json
COPY apps/video-service-hub/package.json ./apps/video-service-hub/package.json
COPY packages/printer-contracts/package.json ./packages/printer-contracts/package.json
# pnpm 11 only reads auth/registry settings from .npmrc; minimum-release-age and the
# fetch-retry settings below must be passed as CLI --config overrides instead (.npmrc
# or ENV vars are silently ignored for them). --config.minimum-release-age=0 disables
# pnpm 11's default supply-chain age check for this install only: that check fetches
# publish-time metadata for every lockfile entry, which is unreliable from inside a
# Docker build; the real policy gate already runs on the runner in check_node.sh
# (_job_check.yaml), a dependency of the image build. The fetch-retry overrides widen
# tolerance for the registry's slow/flaky responses seen from Docker Desktop on Windows.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --config.minimum-release-age=0 \
         --config.fetch-timeout=300000 \
         --config.fetch-retries=5 \
         --config.fetch-retry-mintimeout=10000 \
         --config.fetch-retry-maxtimeout=120000 \
         install --frozen-lockfile

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter "${PACKAGE_NAME}..." build \
    && pnpm deploy --filter "${PACKAGE_NAME}" --prod --legacy /opt/app

FROM 192.168.1.162:5000/library/node:${RUNTIME_VERSION}-alpine
RUN apk upgrade --no-cache
ARG APP_PORT
ARG START_COMMAND
ARG PROJECT_PATH
ARG BUILD_OUTPUT
WORKDIR /app
COPY --from=build /opt/app ./
# pnpm deploy --prod only assembles production node_modules + the package
# manifest; it never copies build artifacts, so the compiled dist/ output
# has to be copied explicitly from the build stage's workspace checkout.
COPY --from=build /workspace/${PROJECT_PATH}/${BUILD_OUTPUT} ./${BUILD_OUTPUT}
ENV START_COMMAND=${START_COMMAND}
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE ${APP_PORT}
CMD ["sh", "-c", "exec ${START_COMMAND}"]
