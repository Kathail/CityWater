# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

FROM nginx:alpine AS runtime

# envsubst (from gettext) renders nginx.conf.template at container start
# so BACKEND_URL + PORT can come from the Railway service env.
RUN apk add --no-cache gettext

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint-resolver.sh /docker-entrypoint-resolver.sh
RUN chmod +x /docker-entrypoint-resolver.sh

# Sensible defaults for local docker-compose use; Railway overrides via env.
ENV PORT=80 \
    BACKEND_URL=http://backend:5000

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://localhost:${PORT}/ || exit 1

# Custom entrypoint pulls the live system resolver out of /etc/resolv.conf
# into ${DNS_RESOLVER} so nginx's `resolver` directive can re-resolve
# *.railway.internal at request time. Then chains to nginx:alpine's
# upstream entrypoint, which envsubsts our template and execs nginx.
ENTRYPOINT ["/docker-entrypoint-resolver.sh"]
CMD ["nginx", "-g", "daemon off;"]
