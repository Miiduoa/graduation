# nuni-api runtime dependency security candidate

Opt-in rebuild of the **currently deployed** API source tree with patched compatible dependency pins. This directory does **not** change default `source.json` / composed / food-ordering candidates.

## Production bind

| Field | Value |
|---|---|
| Base | `9de47b4b3492325e430562c37bcad552867162db` (`Miiduoa/nuni-prod`, archived) |
| Production tree | `b0a10ac814cd03fbfb45132566035acce8339f17` |
| Security candidate tree | see `source.json` `candidateTree` |
| Rollback image | `registry.fly.io/nuni-api@sha256:be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2` |
| Live started machine | `857656ef1e7798` |
| Stopped machine | `d897e35f345428` (**do not start**) |

Default repo `deploy/nuni-api/source.json` (v20 / `6776b19a…`) is **not** current production. Do not deploy it for this fix.

## Patched pins

- `fastify` `5.10.0` → `5.12.7`
- `zod` `4.4.3` → `4.6.7` (Zod 4 line only; Zod 3 left alone)
- `brace-expansion` → `5.0.12`
- `fast-uri` → `3.1.9` / `4.2.3`
- `@grpc/grpc-js` → `1.14.5`
- Runtime base `node:24.22.1-alpine@sha256:06d7adf3…` + CA bundle hardening (same pin family as legacy web security)

Private `pnpm-lock.yaml` is regenerated in the security patch. Image build uses frozen lock install into the image stages — **no** force-install into precompiled `dist`.

## Build (local only)

```sh
export NUNI_API_SECURITY_SOURCE=/absolute/path/to/nuni-prod-clone
python3 deploy/nuni-api/build.py --security-candidate
# or:
python3 deploy/nuni-api/security/prepare.py --source "$NUNI_API_SECURITY_SOURCE"
```

Tag: `nuni-api-security:20261024` (`linux/amd64`). Does not push the registry, deploy Fly, run migrations, or write production data.

## Tests

```sh
NUNI_API_SECURITY_SOURCE=… node --test deploy/nuni-api/security/source.test.mjs
node --test deploy/nuni-api/security/container-contract.test.mjs
```

HTTP / Postgres regression: materialize with `--keep-checkout`, install frozen deps in that checkout, then run existing `scripts/verify-nuni-*.mjs` against an isolated loopback database. Do not use ambient production `DATABASE_URL`.

## Release procedure

Verify the local image, readiness, and audit counts before updating the existing machines **without** `release_migration`. Roll the running machine to the verified digest; update the stopped machine with `--skip-start` so a later start cannot restore vulnerable packages. Preserve its stopped state and rollback digest `be815455…`.
