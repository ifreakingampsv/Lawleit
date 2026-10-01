# Lawleit API — production image (Fly.io)
# Multi-stage: build TS with dev deps, run from a slim runtime.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
# .env is deliberately NOT copied: all configuration reaches production
# through Fly secrets (DATABASE_URL, SESSION_SECRET, CORS_ORIGINS, cookie flags).
# Migrations run before the server on every boot (drizzle's journal makes
# re-running idempotent).
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
