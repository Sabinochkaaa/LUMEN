# ── 1. Dashboard (React) ─────────────────────────────────────────────
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── 2. LÜMEN Core + API ──────────────────────────────────────────────
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 LUMEN_DATA_DIR=/app/data APP_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-rus fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY lumen/ lumen/
COPY examples/ examples/
COPY --from=web /web/dist web/dist
ARG RAILWAY_GIT_COMMIT_SHA
ENV LUMEN_COMMIT=${RAILWAY_GIT_COMMIT_SHA}
RUN mkdir -p /app/data && useradd -m lumen && chown -R lumen /app
USER lumen
EXPOSE 8000
CMD ["sh", "-c", "uvicorn lumen.api.app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --no-server-header"]
