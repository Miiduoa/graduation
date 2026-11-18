# JSON fallback snapshot contract

`sync_from_json_dump` replaces a whole `firestore:<collection>` source, including
all schools and legacy unscoped rows. A file's existence, nonzero row count or
`[]` cannot establish that it is a complete source. Ordinary development arrays
and objects are therefore rejected without reading or changing the index.

There is currently no production snapshot exporter in this repository. Startup
calls `migrate_legacy_firestore_index()` without trusted digests: when live sync
fails, local dumps cannot append, overwrite or delete indexed facts. Existing
scoped rows stay available, and legacy unscoped rows remain invisible to
school-filtered retrieval. Migration reports `retryable: true` while those rows remain, but this is a
status flag, not a scheduled retry. `server.lifespan` invokes migration once when
RAG starts; there is no Firestore retry loop in this repository. An index with no
legacy rows returns early from migration and is not refreshed by that helper.

The availability tradeoff is explicit: during an outage, existing scoped facts
can become stale and previously unscoped facts stay unavailable. This patch does
not turn an unverified development dump into an offline recovery source. It also
does not delete the last known scoped index merely to make migration look done.

## Recovery when no trusted exporter exists

After restoring authorized live-source access, an operator can explicitly call
`migrate_legacy_firestore_index(db=authorized_db)` again for outstanding legacy
rows (or allow the normal RAG startup attempt on a planned restart). To refresh
already-scoped sources when no legacy rows remain, use the existing
`sync_all(db=authorized_db)` API; migration's early return is not a refresh job.
Both operations use the existing full paginated live reads. These are operational
instructions, not operations performed by this PR; real source/index access
requires the usual authorization and a backup/recovery procedure.

If live access cannot be restored, keep the index unchanged until an independently
reviewed complete export exists. The explicit snapshot API below accepts such an
artifact; there is no built-in exporter, conversion utility or CLI shortcut that
can certify a legacy dump. Review `firestore`/`json` per-collection results and
`remaining`, `rebuilt`, `retryable` after migration; `-1` is failure, and a preserved
index or `retryable: true` is not proof of refreshed facts. Do not approve a digest
merely to clear that status.

## Explicit complete snapshots

A controlled caller may supply `trusted_snapshot_sha256`, mapping each requested
collection to the lowercase SHA-256 of the exact approved file bytes. The trust
value must come from an independently reviewed export/restore process, not from
the dump itself or a sidecar automatically discovered beside it. Do not simply
hash an arbitrary development dump to grant it replacement authority.

Before approving a digest, establish that the export is current and complete for
the entire collection across **all schools**, with no school filter, row limit,
missing page or unfinished write. A digest checks integrity and records caller
approval; it cannot prove completeness, provenance or freshness. Export to a
temporary file and publish it only after the full read succeeds. This change does
not add an exporter, automatically configure trust, or approve any real restore.

Each `<collection>.json` must have exactly this envelope (example data is synthetic):

```json
{
  "format": "nuni-rag-firestore-snapshot-v1",
  "collection": "announcements",
  "scope": "all_schools",
  "complete": true,
  "documents": [
    {
      "id": "fixture-announcement-pu",
      "data": {"schoolId": "pu", "visibility": "public", "title": "Fixture"}
    },
    {
      "id": "fixture-announcement-nchu",
      "data": {"schoolId": "nchu", "title": "Another fixture"}
    }
  ]
}
```

- The filename and `collection` must match a `PUBLIC_FIELDS` collection. Only
  `all_schools`, literal `true`, and this exact format version are supported.
- Every document has exactly `id` and `data`. IDs are unique nonblank strings,
  without slashes or leading/trailing whitespace; use original Firestore IDs,
  never array positions. `data` is an object.
- Every row needs a valid `schoolId` under `public_school_id`, even a non-public
  row. Existing alias normalization (`tw-pu` → `pu`, `tw-nchu` → `nchu`) applies.
  Missing/unknown sentinel/invalid school values reject the snapshot.
- Visibility may be absent/null, `public`, `private`, or `school`. The last two
  are intentionally excluded. Unknown visibility rejects the snapshot. Public
  rows must contain at least one usable public scalar display field.
- `public_document` remains the only projection into indexed text and metadata;
  private extra fields and nested objects are not serialized.
- `documents: []` is a legitimate **whole-source deletion** only with the same
  complete all-schools envelope and independently approved digest. A snapshot
  whose rows are all explicitly non-public likewise produces an empty public
  source. A one-school/partial export must never be approved as `all_schools`.

Callers must explicitly select their intended collections, for example
`sync_from_json_dump(approved_dir, collections={"announcements"},
trusted_snapshot_sha256=approved_digests)`. The same keyword argument is available
on `migrate_legacy_firestore_index`; it only considers collections whose live sync
failed. Successful live collections are never replaced by fallback snapshots.
JSON replacement targets the default local `campus` Chroma collection, as before;
this contract does not add custom-index restore support. There is no
environment-variable or CLI switch granting trust automatically.

All requested files are read and validated before any index read/write/delete.
Missing files or approval, hash mismatch, malformed JSON (including duplicate
keys/non-finite numbers), malformed rows, or unsupported scope returns `-1`
for every requested collection and preserves the index. A caller may request a
subset of complete collections; a subset of schools/documents is not supported.

After validation, replacement retains the existing write-before-delete ordering.
Only stale IDs of the declared source are removed; other sources are untouched.
An upsert failure does not delete old rows. Writes across batches/collections are
not transactional: successfully written new chunks can remain after a later
runtime write failure. JSON validation itself never begins a partial write.

## Offline regression evidence

At main `d4bc4cbf418eee804842b8834e19c6a28202ce89`, an in-memory fake seeded with
`old-pu`, `old-nchu` (announcements) and `app-help` reproduced:

| Input | Main result | Main remaining rows | Guarded result |
| --- | --- | --- | --- |
| Plain `[]` | `announcements: 0` | `app-help` | `announcements: -1`, all original rows preserved |
| Plain one-school pu array | `announcements: 1` | `new-0` (pu), `app-help` | `announcements: -1`, all original rows preserved |

This demonstrates an isolated failure mode, not an observation of lost production
data. `tests/test_rag_school_scope.py` covers these cases plus trusted complete
and empty replacements, malformed inputs, projection, scope and an actual mocked
live-sync retry after an outage (without granting JSON trust).
