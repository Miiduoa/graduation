# Legacy Nuni Web security rebuild

Campus One keeps the archived Nuni Web (release 31 digest) as a loopback legacy stage beside the current web process. That stage still ran Next.js 16.2.11. This directory rebuilds the legacy app **from archived `Miiduoa/nuni-prod` source** to Next.js 16.4.2 (the same current-safe pin as Campus One web), without copying private source into the public graduation tree and without mutating the archived remote.

## Source binding

`source.json` pins:

- `baseCommit` / `appsWebTreeAtBase` / `candidateTree`
- patch file + SHA-256
- rollback image digest (old runtime must disappear from the new stage; digest kept for rollback reference only)
- public browser build args (never secrets)

Exact image→commit identity is **best-supported, not label-proven** (pinned image labels are null). See `sourceBinding` in `source.json`. Do not substitute `nuni-v2`.

## Build (local only)

Prefer a local archived checkout (partial clones must be complete enough to materialize trees):

```sh
export NUNI_WEB_LEGACY_SOURCE=/absolute/path/to/nuni-prod-checkout
python3 deploy/nuni-web-legacy/build.py
```

Or:

```sh
python3 deploy/nuni-web-legacy/build.py --source /absolute/path/to/nuni-prod-checkout
```

Produces local tag `nuni-legacy-security:20261024` for `linux/amd64`. After independent verification, publish the artifact and use its immutable registry digest in `deploy/web/Dockerfile.nuni`. The verified published artifact is recorded in `source.json`.

Verify tree only:

```sh
python3 deploy/nuni-web-legacy/build.py --source /absolute/path/to/nuni-prod-checkout --skip-docker
```

## Patches

1. `0001-next-16.4.2-security.patch` — Next.js 16.4.2 (+ lockfile)
2. `0002-sharp-source-map-js-security.patch` — root `pnpm.overrides` for `sharp@0.35.5` and `source-map-js@1.2.2` (+ lockfile). Applied after 0001; no runtime forced install into precompiled Next.

`--keep-checkout` fails closed if the destination already exists, equals/nests the source checkout, or its parent is missing. The helper never deletes an unrelated directory.

## Tests

Offline (always runnable):

```sh
node --test deploy/nuni-web-legacy/build.test.mjs deploy/nuni-web-legacy/source.test.mjs
```

Local image required (skip ≠ pass when the tag is absent):

```sh
node --test deploy/nuni-web-legacy/route-parity.test.mjs deploy/nuni-web-legacy/container-contract.test.mjs
```

Container auth contract uses an isolated Docker network, a TLS synthetic upstream (`scripts/synthetic-upstream.mjs` + `scripts/gen-test-certs.sh`), and fixture values from `fixtures/synthetic-auth.json`. It does not call production Google/Campus auth. See `../legacy-auth-contract-review.md`.

After the image exists, inventory standalone metadata only under `/app`:

```sh
docker run --rm --platform linux/amd64 --entrypoint node \
  -v "$PWD/deploy/nuni-web-legacy/runtime-inventory-app.cjs:/inventory.cjs:ro" \
  nuni-legacy-security:20261024 /inventory.cjs /app
```
