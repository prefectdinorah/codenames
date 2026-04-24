#!/usr/bin/env bash
# Upload Spyfall location images to S3.
#
# Usage:
#   cp .env.example .env && edit .env to set S3_ACCESS_KEY and S3_SECRET_KEY
#   ./scripts/upload-spyfall-images.sh <local-images-dir>
#
# Requires: aws-cli v2 (brew install awscli  /  apt install awscli)

set -euo pipefail

IMAGES_DIR="${1:-./spyfall-images}"

if [ ! -d "$IMAGES_DIR" ]; then
  echo "Directory not found: $IMAGES_DIR" >&2
  exit 1
fi

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${S3_ENDPOINT:?Set S3_ENDPOINT in .env}"
: "${S3_REGION:?Set S3_REGION in .env}"
: "${S3_BUCKET:?Set S3_BUCKET in .env}"
: "${S3_ACCESS_KEY:?Set S3_ACCESS_KEY in .env}"
: "${S3_SECRET_KEY:?Set S3_SECRET_KEY in .env}"

PREFIX="${S3_PREFIX:-spyfall}"

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
export AWS_DEFAULT_REGION="$S3_REGION"

echo "Uploading $IMAGES_DIR/* -> s3://$S3_BUCKET/$PREFIX/"

aws s3 sync "$IMAGES_DIR" "s3://$S3_BUCKET/$PREFIX/" \
  --endpoint-url "$S3_ENDPOINT" \
  --acl public-read \
  --exclude "*" \
  --include "*.jpg" --include "*.jpeg" --include "*.png" --include "*.webp"

echo "Done. Verify: ${SPYFALL_IMAGE_BASE:-$S3_ENDPOINT/$S3_BUCKET/$PREFIX}/airport.jpg"
