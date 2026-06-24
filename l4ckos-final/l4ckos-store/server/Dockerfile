FROM node:22-alpine AS base

LABEL org.opencontainers.image.title="l4ckos-backend"
LABEL org.opencontainers.image.description="Backend Node.js da L4CKOS"

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

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3010
ENV BACKUP_DIR=/app/backups

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json

RUN mkdir -p /app/uploads /app/backups \
  && chown -R node:node /app

USER node

EXPOSE 3010

CMD ["node", "dist/index.js"]
