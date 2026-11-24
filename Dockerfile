FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
COPY packages/inspiration/styles.json ./packages/inspiration/styles.json
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production APP_MODE=team_demo API_HOST=127.0.0.1 PORT=8080 MEDIA_ROOT=/data/media
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY apps ./apps
COPY packages ./packages
COPY skills/qoder-cloud-agent/scripts ./skills/qoder-cloud-agent/scripts
COPY server ./server
COPY scripts/start-demo.mjs ./scripts/start-demo.mjs
COPY docs/contracts ./docs/contracts
EXPOSE 8080
CMD ["node", "scripts/start-demo.mjs"]
