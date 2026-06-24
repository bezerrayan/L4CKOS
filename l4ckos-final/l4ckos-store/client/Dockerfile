FROM node:22-alpine AS build

LABEL org.opencontainers.image.title="l4ckos-frontend"
LABEL org.opencontainers.image.description="Frontend Vite servido por nginx da L4CKOS"

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

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
