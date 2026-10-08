# Attendance verification boundary

The mobile attendance screen has a local preflight validator and a separate server-confirmation step. **A local pass is not an attendance record.**

## Current state (2026-10-08)

- `AttendanceMultiMethodScreen` validates QR, numeric code or location input locally using `@campus/shared`.
- It calls `verifyAttendanceClaim` and only reports attendance as completed after the callable returns `{ valid: true, status: 'present' | 'late' }`.
- **The callable is not currently exported by `backend/functions/index.js`.** Consequently this screen cannot confirm a formal check-in against the current backend. It reports an unconfirmed attempt rather than inventing a successful record.
- The existing `joinLiveSession` callable is a *different* group/live-session workflow with its own `groupId`, QR token and Firestore transaction. It now checks group membership, allows entering the live classroom without claiming attendance, and only records attendance when a server-issued QR token is valid and unexpired. Do not conflate it with `verifyAttendanceClaim`.
- Selfie-liveness verification is disabled on this screen. Taking a picture without a trusted biometric service is not liveness verification.
- There is no queued-retry or automatic sync mechanism for unconfirmed claims. The UI must not promise one.

## Required backend contract

Before enabling this screen for real attendance, the callable must:

1. Require Firebase authentication. Derive the student account from `request.auth.uid`, not a client-supplied `claim.uid`.
2. Resolve the course, session and enrollment/role permissions from server-owned records. Reject missing or inactive sessions and unauthorized users.
3. Validate time window, token/code validity and any location policy against server-controlled settings. The screen's client-side session secret is **not** a security boundary.
4. Record the check-in idempotently, avoiding duplicate attendance counts on retries.
5. Return `{ valid: true, status: 'present' | 'late' }` **only after** the attendance record is durably persisted. All other outcomes should return a rejection or throw a clear callable error.
6. Add backend tests for unauthenticated students, wrong-course submissions, expired tokens, replayed requests, concurrent duplicates and storage failures.

Only after that contract is implemented should this screen be included in an end-to-end acceptance test. The mobile app must not emit a teacher-facing `attendance_checked_in` event for a rejected or unreachable server.

## Tests in this repository

- `apps/mobile/src/__tests__/attendanceConfirmation.test.ts` checks accepted/rejected server response shapes and limits which input methods this screen can offer.
- `apps/mobile/src/__tests__/attendanceEngine.test.ts` checks local preflight logic; it **does not** establish backend security or real check-in success.

The rest of the live-session attendance feature should be reviewed separately: this document does not claim to audit all check-in entry points.
