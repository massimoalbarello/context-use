FROM postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
LABEL org.opencontainers.image.source="https://github.com/massimoalbarello/context-use"
RUN apk add --no-cache aws-cli bash gzip coreutils jq
COPY deploy/backup/backup.sh /usr/local/bin/context-use-backup
RUN chmod 0555 /usr/local/bin/context-use-backup
ENTRYPOINT ["/usr/local/bin/context-use-backup"]
