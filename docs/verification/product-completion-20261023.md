# Product completion candidate verification — 2026-10-23

## Scope and identity

Repository: `Miiduoa/graduation`. Work was implemented by Cursor in separate owned worktrees and reviewed independently. No other chat's dirty checkout was modified. Candidate source `e5a47b15cac43ee796998415ea5677d5e0042e0d` includes notifications/discussion, admin pagination/export and personal calendar, plus main snapshot `6a1f52c6`. This is a local candidate, not deployment or all-domain completion.

Node 22.23.3, pnpm 10.28.2, unchanged lockfile. Platform Google sessions and Firebase school sessions remain distinct. Public personal calendar works on the existing personal-import ledger; school notifications/discussion/admin require their own school authorization.

## Integrated checks

| Command/check | Observed result |
| --- | --- |
| `pnpm --filter web test` | 199 files passed, 1 skipped; 2227 tests passed, 1 skipped |
| `pnpm --filter mobile test` | 251 suites passed, 1 skipped, 1 failed; 2791 tests passed, 1 skipped, 1 failed |
| `pnpm typecheck` | Shared, Web and Mobile passed |
| `pnpm lint` | Mobile, Web and Functions passed with existing warnings. Shared found one new deliberate control-byte regex lint violation; scoped rationale added, then `pnpm lint:shared` passed with 3 existing warnings. |
| `pnpm --filter web build` | Production build passed |
| Standalone HTTP | `/health/live`, `/calendar`, `/groups` each 200 |

The Mobile failure was the existing `AdminEventPolicy.test.tsx` assertion against the old CSV button label and former column boundary. Updated expectations retain the actual capacity/controlled-registration-count checks and assert the new exportScope field. The complete five-test file then passed. Do not relabel the initial full run as green; final integration checks are recorded below when available.

## Independent behavior verification

- Browser synthetic guest CRUD on local calendar: create, persist across reload, edit, reject reversed times, cancel edit, whole-list export with two VEVENT entries, explicit one-event export, cancel/confirm delete and reload, month filter. Parsed downloaded ICS: Asia/Taipei timed boundaries, all-day exclusive end. 390×844 has no horizontal overflow and screenshot inspected. Development browser had zero errors and one CSS preload warning.
- Built standalone browser renders calendar actions and empty state. Unauthenticated group deep link shows the school-login gate with a preserved return URL and does not show fabricated posts.
- Selected existing group Firestore rules: 8 passed, 0 failed on owned local demo emulator ports; source hashes unchanged and emulators stopped. The two older impersonation fixtures omit active school membership, so their denial alone does not isolate authorId enforcement. This is not new-service transaction validation.
- Final ICS helper/service tests: 45 passed; updated genuinely overlapping export regression separately passed all 8 helper tests. A stale export cannot delete a newer export file; account switch after sharing cleans the old file.
- Root's final notification tests: 4 suites / 38 passed; after adding stale listener suppression, hook + resolver 19 passed. Real producer-shaped grade payload and actual hook school context covered. Missing school/role rejects grade navigation.
- Root's final Web discussion/service/directory tests: 27 passed, including immutable publication retry, conflict without new ID, transaction existing-document protection, and unavailable browser storage preventing dispatch while preserving visible draft.
- Root admin stale native Alert + export session verification: 2 suites / 11 passed.

## Remaining acceptance

No deployed SHA, actual school-account user journey, real background push, Google cross-device calendar synchronization, physical-device sharing, signed installable bundle, or store acceptance was established by these checks. See the [13-domain ledger](../PRODUCT_COMPLETION_2026-10-23.md). Additional group ownership transfer is under review and is not included in the counts above.
