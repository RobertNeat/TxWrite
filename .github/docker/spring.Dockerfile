ARG RUNTIME_VERSION
FROM 192.168.1.162:5000/library/maven:3.9-eclipse-temurin-${RUNTIME_VERSION} AS build
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*
ARG PROJECT_PATH
WORKDIR /source
COPY .mvn/settings.xml /tmp/settings.xml
COPY ${PROJECT_PATH}/pom.xml ./pom.xml
RUN --mount=type=cache,id=maven-repo,target=/root/.m2/repository \
    mvn --batch-mode -s /tmp/settings.xml dependency:go-offline
COPY ${PROJECT_PATH}/src ./src
RUN --mount=type=cache,id=maven-repo,target=/root/.m2/repository \
    mvn --batch-mode -s /tmp/settings.xml package -DskipTests

FROM 192.168.1.162:5000/library/eclipse-temurin:${RUNTIME_VERSION}-jre
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/bin/pebble
ARG BUILD_OUTPUT
ARG APP_PORT
ARG START_COMMAND
WORKDIR /app
COPY --from=build /source/${BUILD_OUTPUT} ./app.jar
ENV START_COMMAND=${START_COMMAND}
USER 10001
EXPOSE ${APP_PORT}
CMD ["sh", "-c", "exec ${START_COMMAND}"]
