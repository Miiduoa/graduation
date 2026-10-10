FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS base
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
WORKDIR /build
RUN npm install --global pnpm@10.28.2 --ignore-scripts --no-audit --no-fund
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter web... --ignore-scripts
COPY tsconfig.json ./
COPY apps/web/ ./apps/web/
COPY packages/shared/ ./packages/shared/

# These are public browser settings. Never pass server credentials as build args.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_SITE_URL=https://nuni.tw
ENV NEXT_PUBLIC_CLOUD_FUNCTION_REGION=asia-east1
ENV NEXT_PUBLIC_DEFAULT_SCHOOL_ID=pu
ENV NEXT_PUBLIC_ALLOW_LOCAL_MOCK_AUTH=false
ENV NEXT_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS=false
RUN node -e "for(const name of ['API_KEY','AUTH_DOMAIN','PROJECT_ID','STORAGE_BUCKET','MESSAGING_SENDER_ID','APP_ID'])if(!process.env['NEXT_PUBLIC_FIREBASE_'+name])throw new Error('Missing public Firebase build setting: '+name)"
RUN pnpm --filter web build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /build/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /build/apps/web/.next/static/ ./apps/web/.next/static/
COPY --from=build --chown=node:node /build/apps/web/public/ ./apps/web/public/
WORKDIR /app/apps/web
RUN node -e "require('sharp')"
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
