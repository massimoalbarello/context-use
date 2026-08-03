FROM oven/bun:1.3.11-alpine@sha256:7ed9f74c326d1c260abe247ac423ccbf5ac92af62bb442d515d1f92f21e8ea9b AS dependencies

WORKDIR /opt/context-use/nango-integrations

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e

LABEL org.opencontainers.image.source="https://github.com/massimoalbarello/context-use"

WORKDIR /opt/context-use/nango-integrations

RUN usermod --login bun --home /home/bun --move-home node \
    && groupmod --new-name bun node

COPY --from=dependencies --chown=bun:bun /opt/context-use/nango-integrations/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock tsconfig.json ./
COPY --chown=bun:bun *.ts ./
COPY --chown=bun:bun github ./github
COPY --chown=bun:bun granola ./granola

RUN mkdir -p build .nango \
    && chown -R bun:bun /opt/context-use/nango-integrations

ENV NANGO_CLI_DEPENDENCY_UPDATE=false \
    NANGO_CLI_TELEMETRY=false \
    NANGO_CLI_UPGRADE_MODE=ignore

USER bun

RUN node ./node_modules/nango/dist/index.js compile --no-interactive --no-dependency-update \
    && rm -rf build/* .nango/*

ENTRYPOINT ["node", "./node_modules/nango/dist/index.js"]
CMD ["--help"]
