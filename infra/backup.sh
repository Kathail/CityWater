#!/usr/bin/env bash
#
# Daily Postgres dump → encrypted → S3-compatible bucket.
#
# Required env (see docs/RUNBOOKS.md for details):
#   DATABASE_URL             postgresql:// connection string
#   BACKUP_BUCKET            S3 bucket name (B2 or R2)
#   BACKUP_S3_ENDPOINT       (optional) S3-compatible endpoint URL
#   BACKUP_S3_REGION         (optional) defaults to "auto"
#   BACKUP_AGE_RECIPIENT     age public key for encryption
#   AWS_ACCESS_KEY_ID
#   AWS_SECRET_ACCESS_KEY
#
# Retention is enforced inline: anything under daily/ older than
# BACKUP_RETENTION_DAYS (default 30) is purged after a successful upload.

set -euo pipefail

: "${DATABASE_URL:?must be set}"
: "${BACKUP_BUCKET:?must be set}"
: "${BACKUP_AGE_RECIPIENT:?must be set}"

REGION="${BACKUP_S3_REGION:-auto}"
ENDPOINT_FLAG=""
if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
  ENDPOINT_FLAG="--endpoint-url=${BACKUP_S3_ENDPOINT}"
fi
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

stamp="$(date -u +%Y-%m-%d)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "[backup] dumping $stamp"
pg_dump --format=custom --compress=6 --no-owner --no-acl \
  "$DATABASE_URL" > "$work/dump"

echo "[backup] encrypting"
age --recipient "$BACKUP_AGE_RECIPIENT" \
  --output "$work/dump.age" "$work/dump"

echo "[backup] uploading to s3://$BACKUP_BUCKET/daily/$stamp.dump.age"
aws s3 cp "$work/dump.age" "s3://$BACKUP_BUCKET/daily/$stamp.dump.age" \
  --region "$REGION" $ENDPOINT_FLAG

echo "[backup] writing heartbeat"
echo "$stamp" | aws s3 cp - "s3://$BACKUP_BUCKET/last-success.txt" \
  --region "$REGION" $ENDPOINT_FLAG

echo "[backup] purging older than $RETENTION_DAYS days"
cutoff="$(date -u -d "$RETENTION_DAYS days ago" +%Y-%m-%d)"
aws s3 ls "s3://$BACKUP_BUCKET/daily/" --region "$REGION" $ENDPOINT_FLAG \
  | awk '{print $4}' | while read -r key; do
  [[ -z "$key" ]] && continue
  date_in_key="${key%%.dump.age}"
  if [[ "$date_in_key" < "$cutoff" ]]; then
    echo "  purge: $key"
    aws s3 rm "s3://$BACKUP_BUCKET/daily/$key" \
      --region "$REGION" $ENDPOINT_FLAG
  fi
done

echo "[backup] done"
