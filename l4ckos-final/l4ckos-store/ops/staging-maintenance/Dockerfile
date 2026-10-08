FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json guard.mjs http.mjs server.mjs ./

USER node
EXPOSE 3000

CMD ["node", "server.mjs"]
