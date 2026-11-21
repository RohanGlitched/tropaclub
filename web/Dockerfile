# Build context is the app/ folder (web/ consumes ../shared, ../buy and ../clubs as source, and
# reads ../geo at run time):
#   docker build -f web/Dockerfile -t tropa-web .
FROM node:20-slim AS deps
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-slim AS build
WORKDIR /app
COPY shared ./shared
COPY buy/src ./buy/src
COPY clubs/src ./clubs/src
COPY web ./web
COPY --from=deps /app/web/node_modules ./web/node_modules
# buy/ and clubs/ sources resolve their packages from /app/node_modules
RUN ln -s /app/web/node_modules /app/node_modules
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd web && npm run build

FROM node:20-slim AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /srv
# standalone output mirrors the tracing root (app/), so the server is at web/server.js
COPY --from=build --chown=node:node /app/web/.next/standalone ./
COPY --from=build --chown=node:node /app/web/.next/static ./web/.next/static
COPY --from=build --chown=node:node /app/web/public ./web/public
COPY --from=build --chown=node:node /app/web/assets ./web/assets
# DB-IP Country Lite (CC BY 4.0): read from ../geo relative to the server's working directory
COPY geo/dbip-country-lite.mmdb ./geo/dbip-country-lite.mmdb
# Next writes its page cache here at run time (EACCES otherwise: pages re-render per request and disagree)
RUN mkdir -p /srv/web/.next/cache && chown -R node:node /srv/web/.next
USER node
WORKDIR /srv/web
EXPOSE 8080
CMD ["node", "server.js"]
