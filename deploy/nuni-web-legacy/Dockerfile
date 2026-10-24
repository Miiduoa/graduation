# syntax=docker/dockerfile:1.7
# Rebuilt legacy Nuni Web (linux/amd64). Does not copy private source into the
# graduation context; build.py materializes a patched checkout first.
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS base
RUN apk add --no-cache --upgrade 'ca-certificates>=20261020-r0' 'ca-certificates-bundle>=20261020-r0'
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY patches patches
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/source-test-utils/package.json packages/source-test-utils/package.json
COPY apps/web/package.json apps/web/package.json
# sharp's platform binary must install for linux/amd64 musl standalone tracing
RUN pnpm install --frozen-lockfile --filter @campus/web...

FROM dependencies AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_AUTH_MODE
ARG NEXT_PUBLIC_OIDC_ISSUER
ARG NEXT_PUBLIC_OIDC_CLIENT_ID
ARG NEXT_PUBLIC_OIDC_REDIRECT_URI
ARG NEXT_PUBLIC_PRIVACY_NOTICE_VERSION
ARG NEXT_PUBLIC_POLICY_PUBLISHER
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL
ARG NEXT_PUBLIC_ON_DEVICE_AI_RELEASE
ARG NEXT_PUBLIC_ON_DEVICE_AI_RELEASE_ORIGIN
ENV CAMPUS_RELEASE_BUILD=1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AUTH_MODE=$NEXT_PUBLIC_AUTH_MODE
ENV NEXT_PUBLIC_OIDC_ISSUER=$NEXT_PUBLIC_OIDC_ISSUER
ENV NEXT_PUBLIC_OIDC_CLIENT_ID=$NEXT_PUBLIC_OIDC_CLIENT_ID
ENV NEXT_PUBLIC_OIDC_REDIRECT_URI=$NEXT_PUBLIC_OIDC_REDIRECT_URI
ENV NEXT_PUBLIC_PRIVACY_NOTICE_VERSION=$NEXT_PUBLIC_PRIVACY_NOTICE_VERSION
ENV NEXT_PUBLIC_POLICY_PUBLISHER=$NEXT_PUBLIC_POLICY_PUBLISHER
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL=$NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL
ENV NEXT_PUBLIC_ON_DEVICE_AI_RELEASE=$NEXT_PUBLIC_ON_DEVICE_AI_RELEASE
ENV NEXT_PUBLIC_ON_DEVICE_AI_RELEASE_ORIGIN=$NEXT_PUBLIC_ON_DEVICE_AI_RELEASE_ORIGIN
COPY packages/contracts packages/contracts
COPY packages/source-test-utils packages/source-test-utils
COPY apps/web apps/web
RUN pnpm --filter @campus/web build \
  && node -e "const v=require('./apps/web/node_modules/next/package.json').version; if(v!=='16.4.2') throw new Error('Expected Next 16.4.2 during build, got '+v)"

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
# Sharp is nested under next's pnpm node_modules (same layout as the live legacy
# stage). Resolve/load through next. source-map-js is present under standalone
# .pnpm but not always require-reachable from next — pin-check via /app inventory.
RUN <<'EOF'
set -e
node -e '
const { createRequire } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const root = "/app";
const serverRequire = createRequire("/app/apps/web/server.js");
const nextPkg = serverRequire("next/package.json");
if (nextPkg.version !== "16.4.2") throw new Error("Runtime Next must be 16.4.2, got " + nextPkg.version);
const nextRequire = createRequire(serverRequire.resolve("next"));
function packageVersion(req, name) {
  const entry = req.resolve(name);
  let dir = path.dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (pkg.name === name) return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot locate package.json for " + name);
}
const sharpViaNext = packageVersion(nextRequire, "sharp");
if (sharpViaNext !== "0.35.5") throw new Error("Runtime sharp must be 0.35.5, got " + sharpViaNext);
const sharp = nextRequire("sharp");
if (typeof sharp !== "function") throw new Error("Runtime sharp did not export a constructor");
function inventoryVersions(name) {
  const versions = new Set();
  const todo = [path.join(root, "node_modules"), path.join(root, "apps/web/node_modules")];
  const seen = new Set();
  while (todo.length) {
    const dir = todo.pop();
    let real;
    try { real = fs.realpathSync(dir); } catch { continue; }
    if (!(real === root || real.startsWith(root + "/")) || seen.has(real)) continue;
    seen.add(real);
    let entries;
    try { entries = fs.readdirSync(real, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(real, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) todo.push(full);
      else if (entry.name === "package.json") {
        try {
          const pkg = JSON.parse(fs.readFileSync(full, "utf8"));
          if (pkg.name === name && typeof pkg.version === "string") versions.add(pkg.version);
        } catch {}
      }
    }
  }
  return [...versions].sort();
}
const sharpAll = inventoryVersions("sharp");
const smAll = inventoryVersions("source-map-js");
if (JSON.stringify(sharpAll) !== JSON.stringify(["0.35.5"])) {
  throw new Error("Standalone sharp versions must be exactly [0.35.5], got " + JSON.stringify(sharpAll));
}
if (JSON.stringify(smAll) !== JSON.stringify(["1.2.2"])) {
  throw new Error("Standalone source-map-js versions must be exactly [1.2.2], got " + JSON.stringify(smAll));
}
console.log(JSON.stringify({ next: nextPkg.version, sharp: sharpAll, "source-map-js": smAll }));
'
node --version
EOF
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
