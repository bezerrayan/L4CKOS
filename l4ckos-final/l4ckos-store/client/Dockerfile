FROM node:22-alpine AS build

LABEL org.opencontainers.image.title="loja-escoteira-frontend"
LABEL org.opencontainers.image.description="Frontend Vite servido por nginx da Loja Escoteira"

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

ARG VITE_APP_ENV
ARG VITE_API_URL
ARG VITE_RELEASE_VERSION
ARG VITE_GIT_COMMIT_SHA
ENV VITE_APP_ENV=$VITE_APP_ENV
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_RELEASE_VERSION=$VITE_RELEASE_VERSION
ENV VITE_GIT_COMMIT_SHA=$VITE_GIT_COMMIT_SHA

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY .env.frontend ./.env.production.local
COPY . .
RUN pnpm build:client

FROM nginx:1.27-alpine AS runtime

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/public /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
