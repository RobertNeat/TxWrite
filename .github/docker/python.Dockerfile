ARG RUNTIME_VERSION
FROM 192.168.1.162:5000/library/python:${RUNTIME_VERSION}-slim
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*
ARG PROJECT_PATH
ARG APP_PORT
ARG START_COMMAND
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY ${PROJECT_PATH}/ ./
ENV START_COMMAND=${START_COMMAND}
EXPOSE ${APP_PORT}
# Generic pipeline template (.github/pipeline_docs/overview.md); not built by
# any entry in .github/ci/projects.json in this repo, not deployed as-is.
CMD ["sh", "-c", "exec ${START_COMMAND}"] # nosemgrep: dockerfile.security.missing-user.missing-user
