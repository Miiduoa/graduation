# nuni merge gate pilot

This preserves ruleset [26004626](https://github.com/Miiduoa/graduation/rules/26004626) and the required check `審查通過` from App 5504170. It does not merge, deploy, change rules, or substitute a GitHub Actions check for the App. The owner delegates review judgment to a human or an agent acting on their behalf; a machine-verifiable attestation is not proof that a substantive review actually happened. Never attest without reading the exact diff, evaluating tests and risks, and addressing findings. The owner-account COMMENT is explicitly not independent human approval.

## Bootstrap (owner, once)

1. Review and merge this security-sensitive PR using the existing genuine App/manual mechanism. Until the workflow is on main, issue comments cannot trigger it. Do not bypass the ruleset.
2. In the existing ruleset keep App 5504170 required and enable **Require branches to be up to date before merging**. Current ruleset is loose; the pilot refuses to publish unless strict. Keep the no-bypass policy.
3. Create environment `nuni-merge-gate` under repository Settings → Environments. Select deployment branches/tags → selected branches, allow only the branch named `main` (not all protected branches or tags). Enable required reviewers for the initial pilot if an independent reviewer is available; do not allow administrator bypass. The owner must ensure that no other trusted workflow grants unreviewed access to this environment. Use GitHub-hosted runners only.
4. In the [existing App settings](https://github.com/settings/apps/nuni-merge-gate), confirm this App is installed only on the intended repository, with checks:write and metadata:read. Generate a new App private key if needed and store its PEM directly as the **environment** secret `NUNI_GATE_PRIVATE_KEY`. Do not use a repository-wide secret, paste the key into chat, commit it, or share it with any agent. The runtime restricts the short-lived installation token to this repository and checks:write, verifies App identity and revokes the token after use. No contents-write permission is needed.
5. Test with `check` first; it does not read the App key or publish a check. After a genuine review and successful exact-head tests, use `approve`. Verify the resulting check's App ID and audit URL before merging with expected head SHA. Revalidate current main and the absence of failures immediately before merge; GitHub strict mode prevents stale-base merges.

## Pilot scope

Only the 14 known reliability/map file paths enumerated in policy.json, with added or modified status, are eligible. PRs with auth, databases, CI changes, dependencies, migrations, renames, new files outside the list, or other unfamiliar scope remain on the existing genuine manual gate. A shared wake-aware request change also requires Mobile/Maestro checks even when the workflow would not run automatically: in that case the pilot denies instead of skipping a test.

The trusted workflow set is frozen to 43 workflow blob SHAs at the reviewed baseline; the two new gate files are excluded from this fingerprint because they are loaded only from trusted main. Any unrelated workflow addition/change/deletion on main stops approval until policy is reviewed and updated through the manual path. The pilot is deliberately limited; do not extend it merely to get all open PRs through. Do not use stale PR descriptions as evidence.

## Operator commands

For an eligible ready PR, after a substantive exact-head review, submit a review (COMMENT if the owner is the author) with first line:
```
nuni-gate-review v1 head=<40-char head SHA> base=<40-char main SHA> outcome=pass
```
Then provide scope, findings, test evidence, residual risks and what remains untested (at least 120 characters). Do not claim independent approval. Record the numeric review ID. On the same PR, the owner may submit a **new** conversation comment:
```
/nuni-gate check <40-char head SHA> <40-char main SHA> <review ID>
/nuni-gate approve <40-char head SHA> <40-char main SHA> <review ID>
```
Use only one command per comment. Edited, expired, foreign, stale, conflict, draft, unresolved-review, missing-check, failed-check and non-pilot requests fail closed. A skipped preview is not a test pass. The script requires the latest successful pull_request runs associated with the exact PR/head/base; verifies required jobs against GitHub Actions check IDs and genuine CodeQL App; requires the iOS build, smoke test, upload and report steps; validates all visible associated runs; rechecks everything after minting the short-lived App token. The privileged job checks out only the default branch SHA, not the PR. No untrusted PR script or dependency executes with the App secret.

## Test and rollback

`node --test scripts/merge-gate/gate.test.mjs` exercises the pure policy, stale/fork/skipped/failed inputs, review proof, ruleset and PR state. Live environment, read token GraphQL/API permission, App authentication, token revocation and check creation require a pilot run after bootstrap. If anything fails, the existing merge gate remains in force. To disable the pilot, remove the environment secret (or disable its workflow) and revoke the new App key; continue the existing manual process. Do not disable branch protection.

Official references: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issue_comment ; https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments ; https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app .
