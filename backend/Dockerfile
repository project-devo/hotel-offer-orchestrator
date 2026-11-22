# syntax=docker/dockerfile:1

# Pinned Temporal CLI image: provides the `temporal` binary (static Go build) for the embedded dev server.
FROM temporalio/temporal:1.10.1 AS temporal-cli

# Debian/glibc base (not Alpine): Temporal's native core library needs glibc.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=20000

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# tsc -> dist/, then pre-bundle workflow code -> dist/workflow-bundle.js
RUN npm run build

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=20000 && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=256 \
    PORT=3000
WORKDIR /app

COPY --from=temporal-cli /usr/local/bin/temporal /usr/local/bin/temporal
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Strip CRLF as a safety net (Windows checkouts) and verify the Temporal CLI runs.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh \
 && temporal --version

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
