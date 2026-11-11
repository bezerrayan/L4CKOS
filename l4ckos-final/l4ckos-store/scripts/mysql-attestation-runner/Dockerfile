FROM node:22.23.2-bookworm-slim

ENV NODE_ENV=production
WORKDIR /runner

COPY scripts/mysql-attestation-runner/package.json scripts/mysql-attestation-runner/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile --ignore-scripts

COPY scripts/mysql-schema-attestation.mjs ./scripts/mysql-schema-attestation.mjs
COPY server/database/mysqlTls.mjs ./server/database/mysqlTls.mjs

USER node
ENTRYPOINT ["node", "scripts/mysql-schema-attestation.mjs"]
