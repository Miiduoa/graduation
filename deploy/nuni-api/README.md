# Nuni API deployment source

Campus One uses the existing `api.nuni.tw` database and API. The running API's source repository, `Miiduoa/nuni-prod`, is archived; `Miiduoa/nuni-v2` is a separate rewrite and is not the source currently running in production.

This directory preserves the exact base and reviewed changes used by Campus One, without changing the archived repository or replacing the rewrite. `source.json` binds the base commit, patch checksums, final Git tree, and runtime implementation commit. The second patch updates the derived runtime grant inventory. The third adds a scoped installer for the 30 built-in social event contracts, with enforce-mode regression coverage.

Build from the repository root:

```sh
python3 deploy/nuni-api/build.py
```

The script uses an isolated temporary checkout, validates every patch and the final source tree, then builds the API image. It does not deploy, run migrations, provision an account, change credentials, or copy development data. Production credentials remain in the existing hosting secret store.

The API adds administrator-only password sessions, a public school directory, and explicitly public cross-campus boards/posts with account-wide blocks, reports, and operator moderation. Migrations 275 and 276 are additive. Existing routes and school authorization remain intact.

Credential provisioning uses `platform-password-admin-cli.js`, bounded JSON on stdin, and an explicit `--apply`. It defaults to a read-only plan and never prints the password or hash. Do not place credentials in this repository, command arguments, logs, or environment files.

After migrations, the original image alone cannot restart because schema verification requires an exact migration manifest. The compatible rollback image retains the previous API code plus the two new SQL manifest files. Roll back the application image without restoring an older database over new user writes. See the release verification report for exact production and rollback image digests.

For a real school, install the social event contracts explicitly with the deployed API image, `CAMPUS_EVENT_SCHEMA_TENANT_IDS=<tenantId>` and `CAMPUS_EVENT_SCHEMA_SET=social`, using `node apps/api/dist/install-builtin-event-schemas-cli.js`. This uses the existing register/activate governance service and audit; keep `CAMPUS_EVENT_SCHEMA_ENFORCEMENT=enforce`. Verify active producer versions and hashes after installation. API startup and school activation do not silently grant governance authority or install these contracts.
