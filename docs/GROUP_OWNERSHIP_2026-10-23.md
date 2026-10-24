# Group ownership transfer (2026-10-23)

## Scope

Privileged `transferGroupOwnership` callable so a **current active group owner** with an **active same-school seat** can transfer ownership to another **active same-group, same-school, non-guest** member, then leave via existing `leaveGroup`.

Firebase **school** authorization only. Not a platform Google-account bridge. Not claimed deployed or generally accessible.

## Authority model

- Live ownership authority: exactly one `groups/{groupId}/members/{uid}` with `role == 'owner'` and `status == 'active'`.
- `groups.createdBy` is historical/immutable (rules already block client changes).
- User mirrors `users/{uid}/groups/{groupId}` updated atomically with member docs.
- Clients cannot set `role` (including `owner`) via Firestore; `ownershipTransfers/{operationId}` is client deny-all.

## Callable contract

Inputs: `groupId`, `targetUid`, `operationId`, `expectedCurrentOwnerUid` (must equal auth uid).

Transaction:
1. Validate group `schoolId`; load actor/target user + school seats + memberships + mirrors.
2. If receipt exists and payload matches → require actor eligible account + active school seat → return immutable receipt (`reused: true`) with stored `actorNewRole` (no membership/audit writes).
3. Else require actor is the sole active owner (query below), target eligible active non-owner member → flip roles + mirrors → write receipt + one immutable `adminLogs` doc keyed by `ownership-` plus SHA-256 of JSON `[groupId, operationId]`, using `transaction.create` and shared `completedAt`. Different groups may safely reuse an operation ID; a pre-existing audit aborts the entire transaction.

### Active-owner query (fail-closed)

```
members.where('role','==','owner').where('status','==','active').limit(2)
```

- 1 doc and id == actor → OK  
- 0 or 2 docs → `failed-precondition` (never invent authority; never truncate a second active owner)

**Index:** composite `collectionGroup members` on `role` + `status` in `backend/firestore/firestore.indexes.json`. The manifest includes this query index; validate the deployed indexes in the target project before release.

## Clients

- **Mobile** `GroupMembersScreen`: owner-only「轉讓擁有權」→ confirm naming recipient → callable; generation/uid/school/group fence; same `operationId` retry; after success re-read actor membership and `reloadMyMembership` before success UI; scope change clears busy flags.
- **Web** `GroupOwnershipTransfer` + `groupOwnershipService`: paginated eligible members + directory names; confirm; fences; `GroupDirectory` wires owner-only action with remount `key` and component-level scope reset.

User-visible copy: Traditional Chinese. Receipt / historical replay is not treated as proof of current ownership — UI refreshes live membership.

## Registration

`exports.transferGroupOwnership = onCall(...)` in `backend/functions/index.js` beside join/leave; Fly HTTP adapter classifies all `onCall` exports from that map.

## Tests

- Server: auth, atomic transfer, concurrency (sequential store), idempotent retry, >1 active owner fail-closed, inactive-owner crowd, revoked/deleted replay, leave+handoff replay, audit single key, export registration.
- Mobile/Web: confirmation, retry same operation id, identity/scope switch, actor role reload.
- Real Firestore emulator: `backend/functions/groupOwnership.emulator.cjs`, 12 passed / 0 failed / 0 skipped on Node 22.23.4. Includes parallel competing transfers, same-operation retries, two groups reusing an operation ID, immutable audit collision rollback, old-owner rule revocation, and historical receipt replay.
- Final unit suite: 28 passed. Mobile screen/service: 8 passed; Web ownership/directory: 18 passed. Final Mobile assertions reopen a member after transfer to verify authority removal, and require a new confirmation after scope switch.

## Out of scope

Admin browse/export work, root product group-discussion worktree, package upgrades, production deploy, shared emulator ports from this task.
