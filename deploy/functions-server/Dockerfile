FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' ca-certificates)" ge '20250419~deb12u2' \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /build
RUN npm install --global typescript@5.5.4 --ignore-scripts --no-audit --no-fund
COPY scripts/build-functions-shared.cjs ./scripts/build-functions-shared.cjs
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.cjs.json ./packages/shared/tsconfig.cjs.json
COPY packages/shared/src ./packages/shared/src
COPY backend/functions/package.json backend/functions/package-lock.json ./backend/functions/
WORKDIR /build/packages/shared
RUN npm install --ignore-scripts --no-audit --no-fund --omit=peer typescript@5.5.4
WORKDIR /build/backend/functions
COPY backend/functions/ ./
RUN node ../../scripts/build-functions-shared.cjs
RUN npm ci --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
ENV FUNCTIONS_ROOT=/app
ENV APP_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /build/backend/functions/ ./
COPY --chown=node:node deploy/functions-server/server.js ./server.js
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
