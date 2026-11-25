# Auth entry integration and independent school capability

Status: tested integration candidate for PR #792; not merged, deployed, or proof of live identity migration.

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

## Local verification

All results below used Node `22.23.5` and the repository's pinned pnpm `10.28.2`, with the integrated implementation present. Only documentation changed after these runs.

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

## Remaining acceptance and release gates

- Browser visual acceptance was not completed because the available preview environment rejected URL access. No real Google/TronClass OAuth or physical-device end-to-end verification was performed in this round.
- Direct school primary sign-in still needs an approved issuer/stable-subject lifecycle and authoritative role contract. Cross-provider ownership mapping, existing account/data migration, collision handling and rollback remain separate work.
- The Google-link adapter is still not registered in the production host. Candidate SQL is not a production migration; the Google-link flag and school/release switches were not enabled.
- Production host controls, controlled real-account acceptance and deployment verification remain required before rollout.
- Main ruleset `26004626` requires the exact head's `審查通過` check from App `5504170` (`nuni-merge-gate`). Ordinary CI, a review comment or another status cannot replace that check. No bypass or rule change is part of this integration.

See [unified account architecture](unified-campus-account-architecture-2026-11-24.md), [campus-first ADR](../adr/0004-campus-first-identity-and-data.md), and [Google-link candidate](../../deploy/nuni-api/account-linking/README.md) for the preserved implementation and rollout boundaries.
