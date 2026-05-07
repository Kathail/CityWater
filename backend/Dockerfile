# syntax=docker/dockerfile:1.7
ARG PYTHON_VERSION=3.12-slim-bookworm

FROM python:${PYTHON_VERSION} AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install uv

COPY pyproject.toml ./
COPY app ./app
RUN uv pip install --system --no-cache .

FROM python:${PYTHON_VERSION} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_APP=app.wsgi

RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 citywater

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY app ./app
COPY migrations ./migrations

ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}

USER citywater

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-5000}/healthz || exit 1

# Shell-form CMD so $PORT / $WEB_CONCURRENCY expand at runtime — Railway
# (and most PaaS) inject PORT and expect the app to bind to it. Defaults
# to 5000 for `docker run` locally. Migrations run first; `exec` makes
# gunicorn become PID 1 so SIGTERM from the orchestrator reaches it
# directly. --forwarded-allow-ips=* lets gunicorn trust the X-Forwarded-*
# headers Railway's proxy sets; ProxyFix in app/__init__.py reads them.
CMD sh -c "flask --app app.wsgi db upgrade && exec gunicorn --bind 0.0.0.0:${PORT:-5000} --workers ${WEB_CONCURRENCY:-2} --access-logfile - --forwarded-allow-ips=* app.wsgi:app"
