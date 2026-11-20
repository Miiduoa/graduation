# nuni-api runtime dependency + JSON parser security candidate

2026-11-01 發布決策：本目錄的安全依賴更新另案發布，不併入 composed 281／撤回過濾這次發布；兩個候選互斥，任何一個都不能宣稱為「main 全部 API 修正」。281 操作見 [runbook](../composed/RUNBOOK.md)。

Opt-in rebuild of the **currently deployed** API source tree with patched compatible dependency pins and a bounded Fastify malformed/empty JSON → HTTP 400 fix. This directory does **not** change default `source.json` / composed / food-ordering candidates.

## Production bind

| Field | Value |
|---|---|
| Base | `9de47b4b3492325e430562c37bcad552867162db` (`Miiduoa/nuni-prod`, archived) |
| Production tree | `b0a10ac814cd03fbfb45132566035acce8339f17` |
| Prior deps-only candidate | `d006ec857bd1b5be5b0281c94077d61f9af51d05` (`nuni-api-security:20261024`, keep immutable) |
| Security candidate tree | see `source.json` `candidateTree` (0000+0001+0002) |
| Rollback image | `registry.fly.io/nuni-api@sha256:be815455fbb2ccce844b69f004e416e44465e3421f9da654d0cd5db8379c3dc2` |
| Live started machine | `857656ef1e7798` |
| Stopped machine | `d897e35f345428` (**do not start**) |

Default repo `deploy/nuni-api/source.json` (v20 / `6776b19a…`) is **not** current production. Do not deploy it for this fix.

## Patched pins (unchanged from 0001)

- `fastify` `5.10.0` → `5.12.7`
- `zod` `4.4.3` → `4.6.7` (Zod 4 line only; Zod 3 left alone)
- `brace-expansion` → `5.0.12`
- `fast-uri` → `3.1.9` / `4.2.3`
- `@grpc/grpc-js` → `1.14.5`
- Runtime base `node:24.22.1-alpine@sha256:06d7adf3…` + CA bundle hardening (same pin family as legacy web security)

## JSON body parser 400 (0002)

Independent same-image acceptance found `POST /v1/auth/platform/password/sessions` with body `{` rejected by Fastify (`FST_ERR_CTP_INVALID_JSON_BODY`, statusCode 400) but the central error handler only special-cased 429/413/415, so clients saw **500 / INTERNAL_ERROR**.

Patch `0002-json-body-parser-400.patch` maps **only** the known Fastify codes `FST_ERR_CTP_INVALID_JSON_BODY` / `FST_ERR_CTP_EMPTY_JSON_BODY` **and** `statusCode === 400` to HTTP 400 `INVALID_JSON_BODY` with a fixed client message. It does **not** trust an arbitrary thrown `statusCode`. `DomainError` / `AuthError` (401/403) and opaque 500 for unknown errors stay unchanged. Schema SQL and `runtime-grant-matrix.json` bytes are unchanged; grant analysis provenance remains production tree `b0a10ac…` (overlay is no longer dependency-only).

## Build (local only)

```sh
export NUNI_API_SECURITY_SOURCE=/absolute/path/to/nuni-prod-clone
python3 deploy/nuni-api/build.py --security-candidate
# or:
python3 deploy/nuni-api/security/prepare.py --source "$NUNI_API_SECURITY_SOURCE"
```

Tag: `nuni-api-security:20261024-json` (`linux/amd64`). Leaves prior local tag `nuni-api-security:20261024` at tree `d006ec…` untouched. Does not push the registry, deploy Fly, run migrations, or write production data.

## Tests

```sh
NUNI_API_SECURITY_SOURCE=… node --test deploy/nuni-api/security/source.test.mjs
node --test deploy/nuni-api/security/container-contract.test.mjs
# Focused HTTP inject (vitest in materialized candidate):
#   pnpm --filter @campus/api exec vitest run src/json-body-parser-errors.test.ts
```

HTTP / Postgres regression: materialize with `--keep-checkout`, install frozen deps in that checkout, then run existing `scripts/verify-nuni-*.mjs` against an isolated loopback database. Do not use ambient production `DATABASE_URL`.

## Release procedure

Verify the local image, readiness, and audit counts before updating the existing machines **without** `release_migration`. Roll the running machine to the verified digest; update the stopped machine with `--skip-start` so a later start cannot restore vulnerable packages. Preserve its stopped state and rollback digest `be815455…`.
