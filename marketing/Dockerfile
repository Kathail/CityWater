# syntax=docker/dockerfile:1.7
#
# Production image for the citywater.ca brochure. Two-stage build:
# node builds the static bundle into ./dist, nginx serves it.
# Mirrors the frontend/Dockerfile pattern (envsubst-templated config,
# $PORT bound at runtime) so Railway can host both services the same way.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

FROM nginx:alpine AS runtime

# envsubst (from gettext) renders nginx.conf.template at container start
# so $PORT can come from the Railway service env.
RUN apk add --no-cache gettext

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Defaults for local docker run; Railway overrides via env.
ENV PORT=80

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://localhost:${PORT}/ || exit 1

# nginx:alpine's entrypoint expands /etc/nginx/templates/*.template
# into /etc/nginx/conf.d/ before launching nginx — exactly what we want.
CMD ["nginx", "-g", "daemon off;"]
