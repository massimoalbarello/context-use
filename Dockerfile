FROM oven/bun:1.3.11-alpine@sha256:7ed9f74c326d1c260abe247ac423ccbf5ac92af62bb442d515d1f92f21e8ea9b AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile
RUN bun --cwd apps/web build

FROM oven/bun:1.3.11-alpine@sha256:7ed9f74c326d1c260abe247ac423ccbf5ac92af62bb442d515d1f92f21e8ea9b AS runtime
LABEL org.opencontainers.image.source="https://github.com/massimoalbarello/context-use"
RUN apk add --no-cache ca-certificates tini
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production WEB_DIST=/app/apps/web/dist PORT=3000
USER bun
EXPOSE 3000 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "apps/server/src/index.ts"]
