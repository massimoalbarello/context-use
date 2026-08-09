FROM public.ecr.aws/aws-cli/aws-cli:2.34.63@sha256:c95ab0642137f55a12b95b6956dd03cefdbd73e760e0e7b870afc9b47f9c8150 AS awscli

# Alpine's Python-packaged AWS CLI can crash in libssl during multipart S3
# uploads. Keep the transfer client on AWS's bundled glibc runtime.
FROM postgres:17-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f
LABEL org.opencontainers.image.source="https://github.com/massimoalbarello/context-use"
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq \
    && rm -rf /var/lib/apt/lists/*
COPY --from=awscli /usr/local/aws-cli /usr/local/aws-cli
COPY deploy/backup/backup.sh /usr/local/bin/context-use-backup
COPY deploy/aws-credential-broker.sh /usr/local/bin/context-use-aws-credential-broker
COPY deploy/nango/init-db.sh /usr/local/bin/context-use-nango-db-init
COPY deploy/backup/aws-config /etc/context-use/aws-config
COPY deploy/backup/aws-storage-config /etc/context-use/aws-storage-config
RUN ln -s /usr/local/aws-cli/v2/current/bin/aws /usr/local/bin/aws \
    && chmod 0555 /usr/local/bin/context-use-backup /usr/local/bin/context-use-aws-credential-broker /usr/local/bin/context-use-nango-db-init \
    && chmod 0444 /etc/context-use/aws-config /etc/context-use/aws-storage-config
ENTRYPOINT ["/usr/local/bin/context-use-backup"]
