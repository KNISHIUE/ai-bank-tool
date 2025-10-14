# syntax=docker/dockerfile:1.6

# ---- base deps ----
FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install deps separately for better caching
COPY package.json package-lock.json* tsconfig.json ./
# Avoid running lifecycle scripts (e.g., prepare) before sources are copied
RUN npm ci --include=dev --ignore-scripts

# ---- build ----
FROM base AS build
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# Only copy needed files
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json* ./

# Install only production deps
RUN npm ci --omit=dev --ignore-scripts && \
    adduser -D -H -u 10001 app && \
    chown -R app:app /app

USER app
EXPOSE 3000

# Default: HTTP transport
CMD ["node", "dist/index.js"]
