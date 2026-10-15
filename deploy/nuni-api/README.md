# Nuni API deployment source

Campus One uses the existing `api.nuni.tw` database and API. The running API's source repository, `Miiduoa/nuni-prod`, is archived; `Miiduoa/nuni-v2` is a separate rewrite and is not the source currently running in production.

This directory preserves the exact base and reviewed changes used by Campus One, without changing the archived repository or replacing the rewrite. `source.json` binds the base commit, patch checksums, final Git tree, and runtime implementation commit. The second patch updates the derived runtime grant inventory. The third adds a scoped installer for the 30 built-in social event contracts, with enforce-mode regression coverage. The fourth preserves existing account-to-person mappings and serializes first-time persona creation, so legacy accounts can publish and read their public posts without creating a second identity.

第五、第六份補丁（`patches/0005-existing-food-order-access.patch`、`patches/0006-food-order-realms.patch`）仍留在目錄裡，之後可單獨驗收暫停門市的本人舊訂單與訂單場域列表。這次 `source.json` 只打包 0001–0004，目標 tree 為 `6776b19a7cea998728469c3091c0ea7c264f6aa3`；`build.py` 不會套用 0005／0006。

Build from the repository root:

```sh
python3 deploy/nuni-api/build.py
```

The script uses an isolated temporary checkout, validates every patch and the final source tree, then builds the API image. It does not deploy, run migrations, provision an account, change credentials, or copy development data. Production credentials remain in the existing hosting secret store.

## Public cafeteria catalog

```sh
python3 deploy/nuni-api/build.py --public-cafeterias-candidate
```

This opt-in image adds anonymous, read-only cafeteria lookup for an explicitly selected school. It only selects open schools and locations marked both public and open; published menus remain scoped to those locations and the same school. Existing account, merchant, and order routes retain their authorization and behavior. The pinned migrations do not define a review-status column, so the catalog reports `unverified` without requiring a schema change.

`public-cafeterias/packaging-source.json` binds the four adapter files. `packaging-inventory.json` additionally binds the patched application and regenerated runtime inventory. Generate the inventory using a frozen dependency install in the isolated source checkout before creating `runtime-inventory.patch`; a substitute dependency tree can change its analysis. The inventory remains `BLOCK` analysis evidence, not a grant or database-readiness receipt. The builder checks both sets of hashes and labels the image with the resulting Git tree. It cannot combine this overlay with the separate course-access candidate.

Before rollout, verify the existing runtime database's SELECT privileges and catalog columns in a read-only transaction. No migrations or grants are needed. Preserve the existing machine configuration and immutable image for rollback, then verify anonymous catalog responses and protected order routes on every updated machine. Do not run the old Fly release migration command for this image-only change.

The API adds administrator-only password sessions, a public school directory, and explicitly public cross-campus boards/posts with account-wide blocks, reports, and operator moderation. Migrations 275 and 276 are additive. Existing routes and school authorization remain intact.

Credential provisioning uses `platform-password-admin-cli.js`, bounded JSON on stdin, and an explicit `--apply`. It defaults to a read-only plan and never prints the password or hash. Do not place credentials in this repository, command arguments, logs, or environment files.

After migrations, the original image alone cannot restart because schema verification requires an exact migration manifest. The compatible rollback image retains the previous API code plus the two new SQL manifest files. Roll back the application image without restoring an older database over new user writes. See the release verification report for exact production and rollback image digests.

For a real school, install the social event contracts explicitly with the deployed API image, `CAMPUS_EVENT_SCHEMA_TENANT_IDS=<tenantId>` and `CAMPUS_EVENT_SCHEMA_SET=social`, using `node apps/api/dist/install-builtin-event-schemas-cli.js`. This uses the existing register/activate governance service and audit; keep `CAMPUS_EVENT_SCHEMA_ENFORCEMENT=enforce`. Verify active producer versions and hashes after installation. API startup and school activation do not silently grant governance authority or install these contracts.
