# TronClass retention deployment

The checked-in `firebase.json` remains compatible with the project's documented Spark plan. It does **not** enable TTL deletion or billing. The bounded `TronClassRetention` server worker is the default retention implementation once its explicit deployment setting is enabled.

## Optional managed TTL

Use this profile only for a project whose billing is already enabled and whose operator has approved TTL deletion. Firebase documents that TTL deletion is outside the free quota and requires billing: [quotas](https://firebase.google.com/docs/firestore/quotas), [TTL behavior](https://firebase.google.com/docs/firestore/ttl), [field configuration](https://firebase.google.com/docs/reference/firestore/indexes).

Generate a separate configuration from the current complete index specification:

```sh
node scripts/tronclass/prepare-ttl-profile.cjs
```

The generator copies all existing composite indexes and field overrides, adds the three `purgeAt` policies, and explicitly disables TTL on shared submission locks. It leaves the normal deployment files unchanged. The profile retains an ascending collection index on each expiry field so the bounded worker can still run. It contains no Functions or Storage deployment configuration.

The generator reports the private temporary directory it created. After reviewing the files and confirming the intended project, set `TRONCLASS_TTL_DIR` to the reported directory and use that configuration with the existing deployment and readiness commands.

```sh
pnpm exec firebase deploy --only firestore:indexes --project "$TRONCLASS_FIREBASE_PROJECT" --config "$TRONCLASS_TTL_DIR/firebase.json"
node scripts/wait-for-firestore-indexes.cjs --project "$TRONCLASS_FIREBASE_PROJECT" --config "$TRONCLASS_TTL_DIR/firebase.json"
```

The readiness gate requires the exact field's TTL to be `ACTIVE` with no added expiration offset; ready indexes alone cannot satisfy this check. The lock policy must be disabled. TTL is asynchronous, so server authorization continues enforcing expiry independently. An absent/null `purgeAt` preserves closed binding markers and unresolved submission operations. The permanent submission lock is never eligible for automatic deletion.

This profile was generated and checked locally; no production billing setting, TTL policy or data has been changed by this development work.
