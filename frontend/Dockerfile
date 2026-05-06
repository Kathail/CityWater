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

# Sensible defaults for local docker-compose use; Railway overrides via env.
ENV PORT=80 \
    BACKEND_URL=http://backend:5000

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://localhost:${PORT}/ || exit 1

# nginx:alpine's entrypoint runs envsubst over /etc/nginx/templates/*.template
# into /etc/nginx/conf.d/ before launching nginx — exactly what we want.
CMD ["nginx", "-g", "daemon off;"]
