FROM node:22-alpine AS base

LABEL org.opencontainers.image.title="loja-escoteira-backend"
LABEL org.opencontainers.image.description="Backend Node.js da Loja Escoteira"

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

FROM base AS prod-deps
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build:server

FROM node:22-alpine AS runtime
WORKDIR /app

ARG RELEASE_VERSION=unknown
ARG GIT_COMMIT_SHA=unknown
ARG DEPLOYED_AT=unknown
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3010
ENV BACKUP_DIR=/app/backups
ENV RELEASE_VERSION=$RELEASE_VERSION
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
ENV DEPLOYED_AT=$DEPLOYED_AT

LABEL org.opencontainers.image.version=$RELEASE_VERSION
LABEL org.opencontainers.image.revision=$GIT_COMMIT_SHA
LABEL org.opencontainers.image.created=$DEPLOYED_AT

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
COPY --from=build /app/scripts/seed-staging.mjs ./scripts/seed-staging.mjs
COPY --from=build /app/scripts/seed-staging-client.mjs ./scripts/seed-staging-client.mjs
COPY --from=build /app/scripts/stagingSeedCommon.mjs ./scripts/stagingSeedCommon.mjs

RUN mkdir -p /app/uploads /app/backups \
  && chown -R node:node /app

USER node

EXPOSE 3010

CMD ["node", "dist/index.js"]
