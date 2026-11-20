# Firebase school administration — browsing / search / audit export (2026-10-23)

## Scope (accurate)

This work targets **Firebase SCHOOL administration** in the Campus One mobile admin dashboard (`AdminDashboardScreen`): members, announcements, club events, and `schools/{schoolId}/adminLogs`.

It is **not** a claim that platform Google login yields a Firebase school-admin identity, nor that these flows are released / accessible to all platform users. The public sign-in options observed on 2026-10-23 were `google:true`, `studentId:false`. Treat changes as **local/test implementations** until queries and real Firebase roles are verified in a target project.

Web `features/admin` is a separate **platform-operator** surface (`ops/audit`); it does not share the App Firestore member/audit truncation bug. Its text now explains the returned record scope.

## Problem

School admin on App previously truncated lists without an honest load-more path:

- Members: first 100 only; UI treated them as all members; search filtered that subset.
- Admin logs: first 20 only; filter + CSV export covered only that window.
- Announcements: first 50 only; same loaded-subset search issue.
- Events already used cursor pagination (`useAdminEvents`), but export labels needed the same loaded-scope honesty.

## Behavior now

- Cursor pagination (page size 50) for members, announcements, and admin logs via `useAdminCollectionPage`, following the `useAdminEvents` fencing pattern (school/uid scope, in-flight token, dedupe by id, retry same cursor, permission-denied flag).
- Stable ordering (timestamp DESC matched with `__name__` DESC for tie-break cursors):
  - Members: `documentId()`
  - Announcements: `publishedAt desc` + `documentId('desc')`
  - Admin logs: `createdAt desc` + `documentId('desc')`
- Timestamp and document-ID directions match Firestore's default index ordering; no new composite indexes or security-rule changes are required by these queries. See the [Firestore index ordering reference](https://firebase.google.com/docs/firestore/query-data/index-overview#default_ordering_and_the_name_field). Target-project index exemptions and live authorization have not been verified.
- UI copy in Traditional Chinese distinguishes **已載入** vs **全部可讀取**, and search placeholders say **已載入**.
- Audit / CSV export:
  - Fenced by uid + schoolId + editor/admin permission + mount generation (`AdminExportSession`).
  - **Chooser/export click captures an origin ticket** (generation + identity + row snapshot). `begin()` requires that origin; stale native Alert callbacks cannot attach old-school rows to a newer identity.
  - `auth.loading` / `auth.profileLoading` deny and invalidate export (uid can change before profile/role settles).
  - Account/school/role/loading change or unmount aborts in-flight work; deferred file write / `Sharing.isAvailableAsync` / share / success alerts are re-checked.
  - Cancel+retry: old `finally` cannot clear a newer busy/controller.
  - Option A: export currently loaded + filtered rows (explicitly not full history).
  - Option B: bounded school-scoped paged export (max 2000), with complete / capped messaging; formula-safe CSV cells.

## Out of scope

LMS trees, notifications, group/community UI, shared package index, dependency version bumps, production data, pushes, commits, production role rollout.
