# Build context is the repo root (see docker-compose.yml).
# Phase 4: the worker now launches Chromium, so the runtime image is
# Microsoft's Playwright image, pinned to the same version as the `playwright`
# package in packages/core (a mismatch means "browser executable not found").
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

FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=pwuser:pwuser /repo /repo
# Non-root: Chromium keeps its own sandbox, and a browser exploit lands in an
# unprivileged account.
USER pwuser
WORKDIR /repo/apps/worker
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.js"]
