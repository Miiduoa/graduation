# Unified account: Google linking candidate

Status: isolated server-side candidate; no API route, no feature flag enabled, no migration applied, no existing sessions or users touched.

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

## Actual database acceptance gate (not yet executed)

The Security Gates workflow now invokes both Node fixture suites and `google-link-postgres.ci.mjs` using the existing CI loopback PostgreSQL and previously installed pinned Fastify/pg test dependencies. The script rejects any non-test connection string, creates a unique random schema, executes the actual candidate DDL on a synthetic subset of migration 146, and drops only its own schema. Four scenarios exercise concurrent ownership conflicts, duplicate callback serialization, cancellation/logout during verification, and actual Fastify HTTP injection. The verifier and account resolver are fixtures: these tests are not live Google verification, complete production-schema compatibility, host rate-limiter testing or proof that the API is deployed. No changes to production packaging, credential methods or grants. The exact new CI head must pass before any integration is considered.
