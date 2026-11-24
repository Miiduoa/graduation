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

