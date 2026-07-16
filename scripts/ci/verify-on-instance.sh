#!/usr/bin/env bash
set -euo pipefail

env_file=/data/context-use/secrets/runtime.env
cd /opt/context-use/deploy

sql="SELECT CASE WHEN NOT has_column_privilege('context_use_mcp','knowledge_pages','published_version_id','UPDATE') AND NOT has_column_privilege('context_use_dashboard','knowledge_pages','public_slug','UPDATE') AND NOT has_function_privilege('context_use_mcp','confirm_publication_intent(uuid,text,text,text)','EXECUTE') AND has_function_privilege('context_use_publisher','confirm_publication_intent(uuid,text,text,text)','EXECUTE') AND NOT has_table_privilege('context_use_public','knowledge_pages','SELECT') AND has_table_privilege('context_use_public','published_pages','SELECT') THEN 'ok' ELSE 'denied' END"
result="$(docker compose --env-file "$env_file" exec -T postgres sh -c "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -U postgres -d context_use -Atq -c \"$sql\"")"
test "$result" = ok

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

test "$(aws s3api get-bucket-encryption --bucket "$ASSET_BUCKET" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text)" = aws:kms
test "$(aws s3api get-public-access-block --bucket "$ASSET_BUCKET" --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]' --output text | tr -d '[:space:]')" = TrueTrueTrueTrue
aws s3api head-bucket --bucket "$BACKUP_BUCKET"
