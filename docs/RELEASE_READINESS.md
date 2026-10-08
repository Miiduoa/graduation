# Release readiness

Campus One is a prototype. A green unit-test run does not establish production readiness.

## Release gates

| Gate | Evidence required |
| --- | --- |
| Build | Web production build, iOS and Android release builds on supported toolchains |
| Authentication | Sign-in, sign-out, session expiry, and account recovery verified |
| Authorization | Student, teacher, and admin access boundaries tested against Firestore rules |
| Data integrity | Concurrent edits, duplicate submissions, retries, and failed writes exercised |
| Offline behavior | Airplane-mode entry, stale cache disclosure, queued writes, and conflict handling |
| Navigation | Cold-start deep links, malformed URLs, unauthorized destinations |
| Accessibility | Screen reader labels, dynamic text, keyboard focus, contrast |
| Privacy | Data inventory, retention policy, deletion path, logging redaction |
| Observability | Crash reporting, request correlation, actionable alerts |
| Recovery | Backup restoration drill, rollback instructions, feature kill switches |

## Evidence policy

For each release candidate, record the tested commit SHA, environment, date, commands, pass/fail results, and unresolved defects. Do not substitute screenshots or README claims for test output.

## Pilot rollout

1. Start with synthetic data and internal accounts.
2. Test the complete student journey on physical iOS and Android devices.
3. Introduce a small consent-based pilot; keep official school integrations disabled until authorized.
4. Monitor crashes, failed actions, stale-data incidents, and support reports.
5. Expand only after the release gates have documented evidence.

## Known boundary

Campus One must not present demo records as official university records. External LMS, transit, and campus integrations require separately validated credentials, data contracts, and permissions.
