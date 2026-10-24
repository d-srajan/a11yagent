# Build context is the repo root (see docker-compose.yml).
# Phase 0 needs no browser, so this uses node:22-slim; Phase 1 switches to the
# Playwright base image when Chromium is required.
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @a11yagent/worker...
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @a11yagent/core build && pnpm --filter @a11yagent/worker build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
USER node
WORKDIR /repo/apps/worker
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.js"]
