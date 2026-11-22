# Tropa Club indexer (Cloud Run job). Build context = a staged dir holding indexer/ and shared/ (see deploy.sh).
FROM node:20-slim
WORKDIR /app/indexer
COPY indexer/package.json indexer/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY indexer/tsconfig.json ./
COPY indexer/src ./src
COPY indexer/data ./data
COPY shared /app/shared
ENV NODE_ENV=production \
    CACHE_DIR=/tmp/cache \
    OUT_DIR=/tmp/out/public \
    GCS_MODE=sdk \
    STATE_FROM_GCS=1
CMD ["node", "--max-old-space-size=3584", "--import", "tsx", "src/main.ts"]
