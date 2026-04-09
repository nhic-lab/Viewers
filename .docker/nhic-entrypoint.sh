#!/bin/sh
set -e

if [ -z "$DICOMWEB_ROOT" ]; then
  echo "Error: DICOMWEB_ROOT environment variable is not set"
  exit 1
fi

NGINX_HTML=/usr/share/nginx/html

# compressDist.sh pre-compresses app-config.js during docker build:
# app-config.js = 0 bytes, app-config.js.gz = content with ${DICOMWEB_ROOT}.
# Decompress, substitute, delete .gz — official entrypoint re-compresses.
if [ -f "${NGINX_HTML}/app-config.js.gz" ]; then
  gunzip -c "${NGINX_HTML}/app-config.js.gz" \
    | envsubst '${DICOMWEB_ROOT}' \
    > "${NGINX_HTML}/app-config.js"
  rm -f "${NGINX_HTML}/app-config.js.gz"
  echo "NHIC: Applied DICOMWEB_ROOT=${DICOMWEB_ROOT} (from .gz)"
elif [ -s "${NGINX_HTML}/app-config.js" ]; then
  envsubst '${DICOMWEB_ROOT}' < "${NGINX_HTML}/app-config.js" > /tmp/app-config.nhic.js
  mv /tmp/app-config.nhic.js "${NGINX_HTML}/app-config.js"
  echo "NHIC: Applied DICOMWEB_ROOT=${DICOMWEB_ROOT}"
else
  echo "NHIC: Warning - app-config.js not found or empty, skipping substitution"
fi

exec /usr/src/entrypoint.sh "$@"
