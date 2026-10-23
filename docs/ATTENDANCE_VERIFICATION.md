# Attendance verification boundary

An attendance record requires server confirmation. Opening a screen, validating an input locally or displaying a QR code does not create attendance.

## Current state (2026-10-23)

- Teachers start the existing group/live-session workflow through `startAttendanceSession`. The current mobile starter keeps a request ID for retries, requests a ten-minute QR lifetime and accepts the backend's 43-character URL-safe token.
- `ClassroomScreen` reads the current live session and active group membership before opening the teacher-only secret subscription. Cached snapshots and pending local writes cannot expose a QR or confirm a student receipt. Metadata-only server confirmations are observed.
- A teacher QR requires a valid token and the secret document's `qrExpiresAt`. The display clears at expiry, when the classroom ends, on read errors, and when the app leaves the foreground. Returning to the foreground subscribes again and requires fresh server-confirmed classroom, membership and secret snapshots. Account, authentication-session object, school, group and session changes discard the previous access state and ignore late callbacks.
- The expiry timer protects the display; `joinLiveSession` remains the authority for token validity and server time. The callable checks active membership and a valid, unexpired server-issued token before recording attendance in its transaction. Opening the classroom itself does not call it or create a record.
- `AttendanceMultiMethodScreen` is now a compatibility entry to the existing classroom. It lists sessions using the current user, course and school, and only offers a matching active workspace session. Demo courses, external LMS courses, mismatched or ended sessions have no check-in action. The destination classroom verifies its current access again.
- The compatibility screen does not collect six-digit tokens, location or selfies, invoke `verifyAttendanceClaim`, publish a successful check-in event or claim that it recorded attendance. `verifyAttendanceClaim` is still not exported by `backend/functions/index.js`; no backend entry point was enabled by this change.
- Numeric-code, location and selfie-liveness methods remain unavailable. There is no queued retry or automatic sync for an unconfirmed claim.

## Contract required before enabling additional methods

Any future attendance callable must:

1. Require Firebase authentication. Derive the student account from `request.auth.uid`, not a client-supplied `claim.uid`.
2. Resolve the course, session and enrollment/role permissions from server-owned records. Reject missing or inactive sessions and unauthorized users.
3. Validate time window, token/code validity and any location policy against server-controlled settings. A client-side session secret is **not** a security boundary.
4. Record the check-in idempotently, avoiding duplicate attendance counts on retries.
5. Return successful attendance **only after** the attendance record is durably persisted. All other outcomes must return a rejection or a clear callable error.
6. Add backend tests for unauthenticated students, wrong-course submissions, expired tokens, replayed requests, concurrent duplicates and storage failures.

Only after that contract is implemented should an additional method be enabled for a real check-in. The mobile app must not emit a teacher-facing `attendance_checked_in` event for a rejected or unreachable server.

## Tests in this repository

- `apps/mobile/src/__tests__/services/liveAttendance.test.ts` covers membership and secret access, server-only receipts, exact QR expiry, malformed credentials, cleanup and the existing join contract.
- `apps/mobile/src/__tests__/hooks/useClassroomSession.test.ts` covers cache/server transitions, background and foreground revalidation, late callbacks after identity changes, session closure, read errors and refresh recovery.
- `apps/mobile/src/__tests__/AttendanceMultiMethodScreen.test.tsx` covers scoped classroom routing, unavailable or mismatched sessions, account/school changes and failed refreshes, without a legacy callable request.
- `apps/mobile/src/__tests__/services/teacherLiveSessionStarter.test.ts` and `TeacherTodayScreen.test.tsx` cover the existing teacher start and navigation flow.
- `apps/mobile/src/__tests__/attendanceConfirmation.test.ts` and `attendanceEngine.test.ts` retain tests for legacy response shapes and local validation utilities. They do not establish a deployed backend or real check-in success for additional methods.
