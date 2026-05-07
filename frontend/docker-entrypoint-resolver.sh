#!/bin/sh
# Pick the active system resolver from /etc/resolv.conf so nginx's
# `resolver` directive points at whatever DNS the container is actually
# using. On Railway this is the platform's internal resolver (which
# knows about *.railway.internal); on Docker Compose it's typically
# 127.0.0.11. Falls back to Cloudflare/Google public DNS so nginx never
# fails to start because resolv.conf was empty.
set -eu

RESOLVERS=$(awk '/^nameserver/ {printf "%s ", $2}' /etc/resolv.conf | sed 's/ *$//')
if [ -z "${RESOLVERS}" ]; then
    RESOLVERS="1.1.1.1 8.8.8.8"
fi

export DNS_RESOLVER="${RESOLVERS}"
echo "[entrypoint] using DNS resolver: ${DNS_RESOLVER}"

# Hand off to the upstream nginx entrypoint, which will envsubst our
# template (including ${DNS_RESOLVER}) and exec nginx.
exec /docker-entrypoint.sh "$@"
