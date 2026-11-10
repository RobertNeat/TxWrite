# Wariant dla compose.dev.yml: zakłada, że `dist/` jest już zbudowany lokalnie
# (pnpm --filter his-frontend build) przed `docker compose up --build`. Omija
# `pnpm install` w kontenerze - unika wolnego/niestabilnego rejestru npm przy
# lokalnym budowaniu obrazu. Dla CI/produkcji nadal służy angular.Dockerfile.
FROM nginx:1.29-alpine
RUN apk upgrade --no-cache
ARG BUILD_OUTPUT
ARG SERVER_CONFIG
ARG APP_PORT
COPY ${BUILD_OUTPUT} /usr/share/nginx/html
COPY ${SERVER_CONFIG} /etc/nginx/conf.d/default.conf
EXPOSE ${APP_PORT}
