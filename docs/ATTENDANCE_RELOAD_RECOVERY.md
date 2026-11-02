# Attendance receipt recovery after page reload

## Product contract

A reload must not convert an uncertain outcome into either an automatic retry or a fabricated failure. The existing in-memory recovery can explicitly resend the exact frozen command. The new reload path does something different: it reads the original immutable correction audit and never invokes a mutation.

Before dispatching a correction, the editor tries to keep one tab-local `sessionStorage` pointer per actor/course/session. Its only fields are schema version, actor UID, course ID, session ID, request ID and creation time. It contains no student UID/name/student number, reason, proposed status, reviewed revision, token or replayable command. These pseudonymous identifiers are not encrypted secrets. Same-origin scripts can access browser storage; the existing application security boundaries still matter.

A matching success or definite initial rejection clears only the matching request pointer. An ambiguous result and a later permission rejection keep it. A stale completion cannot clear a different newer request. Blocked or unavailable storage leaves the existing in-memory path usable and explicitly warns that reload recovery is unavailable. Malformed metadata is not silently overwritten or executed.

## Read-only recovery

On entry, a scope-keyed gate restores the pointer without automatically reading private records or replaying a command. SSR and hydration use a consistent loading snapshot. The gate does not react to a bookmark created by its own live editor mid-request.

The explicit check verifies the current actor and server-confirmed instructor membership, derives the same SHA-256 audit document ID as both server handlers, and reads that audit with `getDocFromServer`. Cache/pending-write snapshots, identity mismatches, malformed statuses/timestamps and account switches are rejected. A 15-second read deadline limits waiting; it is not a backend transaction cancellation. Firestore Rules are unchanged and remain authoritative for school and course access.

If the audit is found, its saved status/time are displayed separately from the student's current verified record. A later correction is never overwritten. A saved audit can be confirmed even when the current record cannot be read, but the current state is then explicitly unavailable. A missing audit is unresolved, not proof that a previous transaction failed. Dismissal requires explicit acknowledgement and removes only the local reminder, never a server record or transaction.

`sessionStorage` survives reloads in the same page session but is not a cross-device backup or durable offline queue. Tabs opened with an opener may receive an initial storage copy; this still cannot cause automatic writes, and server membership/identity checks are repeated. Browser data clearing, tab closure and blocked persistence can lose the pointer. Real HTTPS and iPhone Safari testing remains required.

## Verification

Targeted project tests:

```sh
pnpm --filter web exec vitest run src/lib/attendanceCorrectionBookmark.test.ts src/lib/attendanceCorrectionReceipt.test.ts src/components/AttendanceCorrectionResume.test.tsx src/components/AttendanceCorrectionPanel.recovery.test.tsx src/components/AttendanceCorrectionConflict.test.tsx src/components/AttendanceRegisterCorrection.test.tsx
pnpm --filter web typecheck
```

Local verification for this change executed actual transpiled storage/receipt source with controlled SDK/clock substitutes: 35 checks passed. The pure bookmark module also passed strict standalone TypeScript compilation. Offline Chromium executed the actual changed editor, recovery gate and receipt reader in 9 scenarios, including a retained-storage remount, old receipt versus newer current status, missing receipt, permission denial and actor isolation. Ten real-component dark/light width combinations (320/375/640/768/1280px) had no horizontal overflow and all buttons were at least 44px high.

The browser environment blocked URL navigation, including loopback. The fallback deliberately used offline document mounting, a storage substitute, controlled auth/ledger/Firestore/crypto/review/Button/register adapters and a reused React runtime from a prior repository build. It is not an actual page-reload, Firebase emulator, complete Next application or real-account test. Complete repository Lint/type/Vitest/build verification must refer to this exact commit's CI rather than a previous green run.

No dependencies, security rules, server transactions, deployment settings or production data are changed by this addition.
