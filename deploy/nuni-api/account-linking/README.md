# Unified account: Google linking candidate

Status: isolated server-side and Web candidate. Dedicated API adapters and a Web account-management page are implemented, but the API is not registered in the production host, the feature flag is default-off, and the candidate schema is not a production migration. No production accounts or sessions are changed by this work.

## Source and decision

The existing archived API source `Miiduoa/nuni-prod@9de47b4b3492325e430562c37bcad552867162db` already defines `platform_accounts`, `platform_account_credentials` (global unique issuer/subject), `platform_login_transactions`, `platform_account_sessions` and separate campus membership in migration 146. `platform-account-service.ts` normal login creates an account if a verified subject is unknown; `platform-idp.ts` verifies the provider signature, issuer, audience, expiry and nonce. The current production reconstruction is documented separately by `../security/source.json` and its production-tree patch, not the archived base alone. This candidate targets the existing account/credential tables rather than introducing a duplicate account database.

## Implemented boundary

`google-link-service.mjs` takes only a trusted server actor (account ID, credential ID, hash of the current validated session), existing DB transaction adapter, and existing platform token verifier. The caller must never build the actor from request JSON. It requires an active, recently created session (five minutes), an active Google/Apple credential, and excludes active platform operators pending role assurance review. No school/QA/password credentials are accepted as a proof today. It returns a link transaction with fixed Google trust roots and a random nonce, stores hashes only, replaces any previous link request for this account, and rechecks account, credential, session, provider settings, request hash, nonce and expiry after remote verification. The completed link reuses the existing account and credential uniqueness constraint. A collision is consumed and returned as generic conflict; no automatic email match, account merge, revocation, reactivation, session creation or role grant. The normal Google login path already resolves the issuer/subject to the associated platform account, but this integration must be verified on the actual reconstructed API.

`schema.candidate.sql` is an unnumbered additive schema proposal with no runtime grants, not attached to the deployment builder. Session deletion cascades. Do not install this on production. A production overlay needs a checked migration ID/manifest, actual DB ACLs, cleanup and integration with the authoritative account-closure/revocation flows.

## Validation

`node --test deploy/nuni-api/account-linking/google-link-service.test.mjs`

The suite is a transactional fixture, not a PostgreSQL engine or live OAuth. Twelve checks cover expected linking, replay, other-account conflict, email collisions, revoked/different Google, nonce and session mismatch, request replacement, expiry, account closure during verification, provider change, privilege/issuer rejection, and malformed input/unverified email. Full database, typecheck/build, actual OAuth, cross-device and production CI are still required. Confirm locking with the existing normal login, account closure, provider changes and concurrent operator grants; prove PostgreSQL uniqueness and rollback under concurrent requests before route registration. Use an isolated database only.

## Next integration gates

- Obtain approved TronClass/tenant issuer proof and stable subject; identify supported scope and explicit consent. Neither password submission nor a cookie is itself permission to mint a platform session.
- Inventory existing Firebase UID/owned data and platform account/persona references. Use verified dual-ownership migration and reversible reconciliation; never merge by email, student number, guessed ID, or profile name.
- Add dedicated link start/callback endpoints (never reuse the existing login endpoint, which revokes the current handle), same-origin/CSRF/state/PKCE, short-lived browser transaction, rate limiting and cleanup, cancellation, explicit confirmation, safe failure copy, and role-aware step-up. Review role changes and revocation/closure across both stores. No raw provider tokens or session values in logs.
- Add a supported school sign-in credential only after verified source contract and migration tests, then enable Google linking from that account and prove both login methods return exactly the same platform account ID. Until then the candidate deliberately only accepts existing Google/Apple credentials. Data sync, agent access and unlink/recovery remain separate gates.


## Dedicated API candidate and cancellation

Only explicit opt-in registers three POST endpoints under `/v1/auth/platform/account-links/google/`: start, complete and cancel. The adapter derives the actor and session hash from the same existing Platform session credential. It rejects caller-defined identity and query strings, applies bounded request bodies, fixed safe error messages and private no-store headers. The current service cancels only a matching unconsumed transaction, including when Google is disabled; cancellation cannot unlink an existing credential.

This remains an isolated adapter, not a registered production route. Host integration must add the exact route classifier to its campus-auth bypass while retaining Platform authentication inside the handler; enable the existing rate limiter, enforce header/body redaction, and verify actual host middleware/ACLs. Web state/PKCE, confirmation, school credential proof, account migration and full deployment remain gated. Run both fixture suites with `node --test deploy/nuni-api/account-linking/google-link-service.test.mjs deploy/nuni-api/account-linking/google-link-routes.test.mjs`. The service suite contains 15 scenarios; the route suite contains 10 fixture checks, not actual Fastify injection or PostgreSQL evidence.

## Actual database acceptance gate

The Security Gates workflow invokes both Node fixture suites and `google-link-postgres.ci.mjs` using the existing CI loopback PostgreSQL and pinned Fastify/pg test dependencies. The script rejects any non-test connection string, creates a unique random schema, executes the actual candidate DDL on a synthetic subset of migration 146, and drops only its own schema. The original four database scenarios passed on exact commit `322e93bdf59836ab2038ec35423819ef0f5de5e9`: [Security Gates log](https://github.com/Miiduoa/graduation/actions/runs/45424218896/job/138561031951). These cover concurrent ownership conflicts, duplicate callback serialization, cancellation/logout during verification, and actual Fastify HTTP injection.

The inventory increment adds two database scenarios and expands HTTP assertions. They must pass again on the resulting commit; the previous head's success is not evidence for new code. The verifier and account resolver are fixtures: these tests are not live Google verification, complete production-schema compatibility, host rate-limiter testing or proof that the API is deployed. Production packaging, credential methods and grants are unchanged.

## Web browser candidate (default off)

The separate Next.js routes at `/auth/platform/link/google/{start,callback}` and the gated account-management page use the existing encrypted cookie and current platform session, not ordinary Google login. Start requires an exact same-origin form, explicit consent and current session context. OAuth uses a separate five-minute sealed link cookie, fixed Google trust roots, PKCE-S256, state, nonce and a fixed dedicated callback. The callback requires the same session, never revokes or replaces a platform session or normal login cookie, and routes provider access-denied to the matching cancellation transaction. No link write or token exchange is automatically retried. Ambiguous responses and not-pending cancellations remain unknown; stale callbacks never clear a potentially newer link cookie. Link cookie expires naturally and backend transaction is single-use. The page does not treat its URL result as authoritative proof of an existing credential; a verified credential inventory is still required.

`NUNI_GOOGLE_ACCOUNT_LINK_ENABLED` defaults off. No production flag, OAuth registration or API deployment is changed here. Only enable in isolated staging once the dedicated API is registered and the exact callback is approved. The candidate still supports only already verified platform credentials until school issuer proof, school-credential model, actual account migration, rate-limit/ACL review and end-to-end tests are complete. Tests use mocked HTTP transport with real Next request/cookie primitives; they do not establish live OAuth acceptance. Exact-head CI is required.

## Authenticated inventory and return verification (2026-11-25)

`GET /v1/auth/platform/account-links/google/status` resolves the current Platform bearer and then rechecks the account, current verified credential and unexpired session inside a read transaction. It returns only the account ID, current method, supported active methods and the current Google-link capability. It never returns a provider subject, credential ID, email, nonce or token. Account-first read locks follow the mutation's lock ordering. An old but valid session may still read; the five-minute step-up rule only marks a new link as `reauth-required`. Operators may inspect their own methods. Inactive, ambiguous or untrusted Google history never enables replacement through this feature.

The Web BFF at `/api/nuni/account/login-methods` requires the encrypted session and matching `X-Campus-Session`. It accepts no account selector, query string or request body; performs one fixed, bounded, uncached upstream GET; projects the response through the same pure parser used by the client; and returns the current session context. The management view remains readable if the Google provider or client secret is disabled, while starting a new link remains unavailable. The separate candidate rollout flag still gates both.

After any callback, the page reads this inventory before showing linked methods or a new-link form. URL result values cannot establish success. An unknown response followed by an unlinked snapshot does not prove the earlier write failed: the user may recheck without writing, or explicitly start a new transaction that replaces the unfinished one. New consent is required after every refresh or identity change. Account/session changes, revalidation, pending logout, page hiding and return all invalidate the prior inventory and consent. Aborted or late requests cannot restore another account's state. A read failure offers only a read retry; no callback or write is replayed automatically.

Targeted reproduction from the repository root:

```sh
node --test deploy/nuni-api/account-linking/google-link-service.test.mjs deploy/nuni-api/account-linking/google-link-routes.test.mjs
pnpm --filter web exec vitest run src/lib/nuni/googleAccountLink.test.ts src/lib/nuni/accountLoginMethods.test.ts src/app/auth/platform/link/google/GoogleLinkEntry.test.tsx
pnpm --filter web typecheck
```

The PostgreSQL/Fastify acceptance script runs in the existing Security Gates job with its isolated service and explicit test connection. The status route is additive and uses existing account tables; it does not require a new inventory table or schema migration. Production host registration, middleware/rate-limit integration, real OAuth callbacks, school issuer proof and cross-store migration remain separate delivery gates.
