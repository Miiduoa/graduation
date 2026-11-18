# Unsent revision draft recovery

This slice extends the existing revision/protection flow on `feat/agent-confirmation-workflow-20261109`. It does not restore a conversation, signed card, model consent, execution permission, or action result.

## Reproduction and acceptance

Before this change, entering revised conditions or choosing protected items in a pending calendar proposal and reloading loses both. An unsent draft now survives a same-tab reload for 30 minutes. Recovery is explicit: the user restores the content, requests a fresh proposal, opens its revision editor, and applies the draft. No recovery action asks the model, confirms, cancels, or resubmits a transaction.

The full ordered source content must match to restore protected selections. Compare title, date, endDate, allDay, startTime and endTime, including field presence. New proposal IDs are expected. Same titles, changed time/date, reordered rows, added/removed fields, or incomplete source content cannot establish a match. Mismatch restores text only and requires the user to select protected items again. Existing protection validation, server signatures, revocation, reconciliation, and manual confirmation remain authoritative.

## Persistence boundary

- Storage: `sessionStorage`, one latest draft per exact authenticated context/account/school. Namespace uses SHA-256 of the scope; neither raw identity nor context is stored.
- Lifetime: 30 minutes from the latest successful edit. Reading, restoring and rerendering do not extend expiry. Ordinary unmounts, including login revalidation, do not delete a valid draft.
- Payload: version, random draft ID, scope hash, cleanup source hash, six-field source event snapshots, at most 300 characters of revision instructions, protected indices, savedAt. Limit: 16 events and 16 KiB.
- No tokens, signature, permit, mutation IDs, route token, conversation history, model consent, execution state or account identity is serialized. The cleanup hash contains no recoverable execution credential.
- Scope mismatch is isolated by namespace. Invalid, expired, future-dated or oversized records are hidden and cleanup is attempted only in the current namespace. Failed cleanup never exposes invalid content.
- Storage read/write/remove failure is visible. In-memory input survives a failed save. A failed pre-dispatch removal prevents the affected action from starting.
- Clear the matching source draft before the first revision cancellation, direct calendar confirmation, or direct calendar cancellation. Once a revision has actually started, later edits are only in memory; they are never saved as unsent. An all-protected local no-op keeps the original preview and draft.
- Closing the editor retains the draft. “清除修改內容” and “捨棄修訂草稿” clear content without cancellation or confirmation.
- Restored content is untrusted input. It is never converted into executable cards. Applying requires a fresh, current, unattempted calendar proposal, active account/school, consent, a successfully read execution journal, and no unresolved action.

The existing execution journal is separate. This feature neither changes its format nor deletes it on draft expiry. After reload, its existing behavior may reconcile an unknown prior request; draft recovery cannot retry that request or infer its outcome.

## Integration boundary with PR #546

Reviewed actual #546 diff at `5a19887b4e740e7b96de2bf6e9d83e52880c86ad` against main `269b44c071395caafdbf85b337867687bb1cd3d5`. #546 covers a next-question draft while asking, failed-question switching, IME submission, reading position and stopping an ask. It does not implement cross-reload persistence.

This slice leaves `AssistantThread.tsx` and the generic question composer unchanged. Storage validation is in `assistantPlanRevisionDraft.ts`; state coordination is in `usePlanRevisionDraft.ts`; recovery UI is separate from the conversation thread. `Assistant.tsx` still overlaps #546 and #558 at integration points and requires a reviewed merge plus their combined tests. No unreviewed PR has been merged here.

## Verification contract

Unit and component tests cover strict payload validation, scope/TTL/corruption/storage failures, explicit recovery/discard, source comparison and protection preservation. Integration tests exercise the actual Assistant with deterministic fake API responses and record dispatch-time storage contents.

The browser harness bundles the actual Assistant and uses a fixed fake API. A dedicated `draft-reload=1` mode persists only fake backend state, records page epochs and permits true `page.reload()` testing. Its fake backend journal is test infrastructure, not product draft data. Cases cover reload, matching/mismatching fresh proposals, explicit re-preview/confirmation, denied storage, scope isolation, and requests interrupted across reload. Screenshots and request ledgers are fixture evidence, not real-account, real-model, school-data or physical-phone tests.

Public PR creation/body publication remains pending user authorization after the prior automatic approval rejection. This document is a repository integration note, not a public PR update.
