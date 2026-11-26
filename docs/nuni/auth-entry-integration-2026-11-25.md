# Auth entry integration and independent school capability

Status: tested integration candidate for PR #792; not merged, deployed, or proof of live identity migration. The initial integration is commit `8eed150dbce005e8f9475c355b870dabd49342c7`; subsequent continuation and schema-fixture work is recorded below.

## Integrated sources

- Account entry and verified Google-link candidate: PR #792 at `f9e525d14bd145b7038fa9e60301c0b2cd0b1f03`.
- School entry and personal-data handling: PR #791 at `2923abd813726e112437c6eb282329941cf3ffef`.
- Main: `2e088e1f0a20ce09a83ac2483d6b25b3477a0ce8`.

The five overlapping Web/Mobile login files were explicitly reconciled. General entry places the selected school's sign-in first only when the directory, selection and capability are confirmed. Platform-specific tasks, session recovery, Google fallback, manual import, and original return path/query/hash remain available. Directory loading, failure and unavailable selection cannot expose a stale school's official LMS link. PU's paused student route and separate teacher route are retained. A retry that makes school sign-in available preserves the existing Google component state.

The combined candidate retains #791's account/school-scoped personal course receipts, cache isolation and post-login authorization, plus #792's authenticated credential inventory, explicit Google-link transaction and strict school identity-evidence handling. Integrating their code does not establish equivalence between a Firebase school UID and a platform account ID.

## Root cause and API contract

Previously, school capability lookup waited for the platform `providers` request. A slow or unavailable Google/platform service could therefore block a school route whose local policy was already known. Mobile's 12-second hard deadline could also race the platform retry budget.

`GET /api/nuni/sign-in-options?scope=school&schoolId=pu` now returns only `{ "studentId": boolean }` from local school policy and the existing school-login switch. It returns before Google configuration, `publicOrigin()` or any platform provider request. It does not authenticate, grant access, or enable a school.

- `schoolId` is optional and preserves the existing PU default. Unknown/duplicate parameters, invalid school IDs and unsupported scopes are rejected even when feature switches are off.
- Omitting `scope` preserves the existing combined `{ google, studentId }` contract and its platform readiness/error behavior.
- Web's school-only consumers explicitly select the new scope. `EventRegistrationPanel` and `NuniSignIn`, which need Google capability, retain the combined contract.
- The Web hook keys results by school, scope and retry attempt. Switching any of these invalidates the old result; cleanup rejects late replies.
- Mobile requests the same school-only contract, requires an explicit boolean `studentId`, and retains per-school cache/pending identity, hard timeout, retryable errors, PU pause and release/SSO checks. Missing capability is an error rather than a closed-school result. Google fields cannot open a school route.

Roll out the Web API before or with a Mobile client that uses this scope. Old clients retain the unscoped contract. A new client against an older server that rejects `scope` fails closed with a retryable error; this is not a successful compatibility rollout.

## Local verification of the initial integration

These results belong to the initial `8eed150d` integration and used Node `22.23.5` and the repository's pinned pnpm `10.28.2`. Only documentation changed between these runs and that initial submission. Follow-up changes have separate results below.

| Scope | Result |
| --- | --- |
| Web login, account linking, school capability, identity evidence, LMS data and affected consumers | 25 suites; 980/980 tests passed |
| Mobile login, recovery, school capability, personal data/cache and affected navigation | 17 suites; 332/332 tests passed |
| Functions post-login authorization and feature flags | 2 suites; 10/10 tests passed |
| Google-link service and route Node fixtures | 18/18 tests passed |
| Full Web and Mobile TypeScript checks | Passed; Web used a 6144 MB Node heap |
| ESLint on this increment's 18 changed source/test files | 0 errors; 4 existing Web warnings |
| Whitespace/diff check and independent contract review | Passed |

The focused API regressions verify zero provider calls even with pending/rejected platform providers, malformed input under both enabled/disabled switches, and the unchanged combined contract. UI/client regressions cover directory loading/failure, unavailable schools, Google preservation during retry, original return targets, missing/wrong-typed responses, switching scope/school, cache reset and transport responses arriving after cancellation.

These local results are not a substitute for CI on the resulting remote head. The PostgreSQL/Fastify suite and all other workflow checks must pass on that exact head; earlier green checks cannot be reused. PR #792 records the submitted commit and identical Git tree.

## Initial integration: completed cloud verification

The [CI for `8eed150d`](https://github.com/Miiduoa/graduation/actions/runs/45525127141) completed successfully. Its checkout merge commit `8decd1b04ef569763aa66ed634709674fc78d7b1` has the same tree as the head: `c3fa83ddb8b55cde30badc7cf061246ef0777dd1`.

- Web: 25,722 passed / 116 skipped; 869 suites passed / 14 skipped.
- Mobile: 11,540 passed / 1 skipped; 572 suites passed / 1 skipped.
- Google-link service/routes: 18/18 passed. The earlier PostgreSQL/Fastify suite: 10/10 passed, using the former limited schema fixture.
- Full CI, typecheck, Web/Mobile build and CodeQL passed. The head has 22 successful and 3 skipped checks; skipped deployment/notification jobs are not deployment evidence.
- Maestro completed two guest smoke flows: startup/login navigation and campus-map access. Full/specific suites were skipped; this is not real OAuth or complete authentication acceptance.

These are the initial head's results. They do not certify later changes or establish compatibility with a complete production API host.

## Follow-up: preserve existing accounts and test real schema constraints

Two Web entry defects were reproduced and corrected. An existing platform session, session loading, a recovery error or pending logout now keeps the platform continuation/recovery entry first, matching Mobile. School-first ordering applies only to a confirmed signed-out general entry; school-specific tasks, selected-school checks and original return targets retain their existing behavior. Reordering preserves the same keyed platform component.

An authenticated platform session does not identify its provider. The signed-in heading and status now refer to the nuni account, and the first-time Google registration copy is hidden. No provider lookup or new authentication flow was introduced.

The PostgreSQL fixture had omitted real CHECK constraints and used the unsupported account state `closed`. It now executes complete byte-preserved migrations 146, 206, 245 and 268 from the pinned API archive, plus migration 275 from the pinned production reconstruction patch. Both Git blob SHA-1 and SHA-256 are verified before the database is opened. Only the two prerequisite campus key tables are synthetic; see [the fixture manifest](../../deploy/nuni-api/account-linking/test-fixtures/source.json) for exact sources and scope.

The account-closure fixture now uses `deleted` with `deleted_at`, clears `suspended_at`, sets `revoked_at` with revoked credentials, and removes sessions under the account-first lock. A pending Google verification is also interrupted by this schema-valid closure. Service/routes, production migration packaging and feature switches are not modified by this fixture correction.

| Follow-up verification | Result |
| --- | --- |
| Web regression baseline | 5 new assertions failed against the earlier implementation, reproducing four account-state ordering defects and the provider-label defect |
| Web targeted regression | 4 files; 191/191 passed, 0 skipped |
| Full Web TypeScript and four changed Web files' ESLint | Passed |
| PostgreSQL constraint baseline | All 10 new constraint cases failed because the old fixture accepted invalid data; its 9 existing functional cases still passed |
| PostgreSQL 17.12 + Fastify using pinned migrations | 21/21 TAP tests passed, 0 failed/skipped, including parent test nodes; existing concurrency/callback cases and the added closure race passed |
| Google-link service/routes fixtures | 18/18 passed |
| Migration provenance, Node syntax and diff checks | Passed |

The PostgreSQL run used a newly created, separately owned loopback cluster whose data directory was verified before testing and removed afterward. No production database was contacted. The new head still needs its own cloud CI results; the completed `8eed150d` CI above must not be relabeled as that new head's result.

## Concurrent main update

Before submission, main advanced to `f43003eda50acbdf99c5b86a35f495b74df24af0` through PR #756. This continuation also merges that exact main, preserving its search history/return handling, IME and Mobile keyboard/feedback changes, Next patch, lockfile and dependency-build serialization.

The only automatically merged source file was `apps/web/src/app/search/page.tsx`. Relative to main, its sole difference remains the explicit `useSignInOptions(undefined, true, 'school')` call; the search-return implementation and tests are preserved. Dependencies were installed with Node 22.23.5, pnpm 10.28.2 and `--frozen-lockfile`, and the installed Next router contains the pinned patch.

After this merge, six Web suites (login, account continuation, school capability, search and service directory) passed 382/382 tests. Five Mobile suites (guest login, import entry, feedback, shared primitives and input continuity) passed 110/110. Full Web and Mobile TypeScript checks passed; ESLint passed for the four changed Web source/test files and the automatically merged search page. These results supersede the earlier four-file Web regression run for the final integrated source tree. The PostgreSQL fixture and service/routes files were unaffected by this main update; their results above retain the same tested bytes.

## Remaining acceptance and release gates

- Browser visual acceptance was not completed because the available preview environment rejected URL access. No real Google/TronClass OAuth or physical-device end-to-end verification was performed in this round.
- Direct school primary sign-in still needs an approved issuer/stable-subject lifecycle and authoritative role contract. Cross-provider ownership mapping, existing account/data migration, collision handling and rollback remain separate work.
- The Google-link adapter is still not registered in the production host. Candidate SQL is not a production migration; the Google-link flag and school/release switches were not enabled.
- Production host controls, controlled real-account acceptance and deployment verification remain required before rollout.
- Main ruleset `26004626` requires the exact head's `審查通過` check from App `5504170` (`nuni-merge-gate`). Ordinary CI, a review comment or another status cannot replace that check. No bypass or rule change is part of this integration.

See [unified account architecture](unified-campus-account-architecture-2026-11-24.md), [campus-first ADR](../adr/0004-campus-first-identity-and-data.md), and [Google-link candidate](../../deploy/nuni-api/account-linking/README.md) for the preserved implementation and rollout boundaries.
