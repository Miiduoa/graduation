# Independent review and safe merge migration

Status: **PROPOSED / NOT ACTIVATED**. Repository: Miiduoa/graduation.
Baseline inspected: `cc06b4da2abe1b954a0411b68ca6ea6a0788c70e` (2026-11-25).

## Observed state

- Ruleset [26004626](https://github.com/Miiduoa/graduation/rules/26004626) is active, targets the default branch, forbids bypass actors, and requires `審查通過` from App 5504170 (nuni-merge-gate). Preserve it during migration.
- Repository auto-merge is disabled. The current connected account cannot change rulesets or Copilot approval settings through the available operations. A PR review by its author cannot replace an independent approval.
- [PR #793](https://github.com/Miiduoa/graduation/pull/793) at `fa38e452ea848ae646b66c607dbe78fdb50e7ff0` was the pilot: 15 non-skipped checks passed; the old App approval was absent. A normal Copilot reviewer request was attempted, but neither a pending Copilot reviewer nor a Copilot review was observed on read-back. Do not treat this as an accepted review or evidence of entitlement.
- On the same head, GitHub Actions (App 15368) emitted all CI jobs and Analyze (javascript-typescript); GitHub Advanced Security (App 57789) emitted CodeQL. The current CI Summary explicitly fails if a validation dependency fails, is cancelled, or is skipped. Maestro and Mobile Agent Regression are path-filtered, so they must not be made unconditional required checks without a separate always-running gate.

## Staged migration (administrator; never remove the old protection first)

1. Export the current ruleset using the repository Settings / Rulesets UI; keep the version and source IDs. Verify Copilot code review entitlement, budget/credits, and availability of the repository approval toggles. Do not purchase a plan or enable billable overages automatically.
2. In Settings / Copilot / Code review, enable custom instructions, automatic review capability and the two approval settings only if available. Limit AI approvals that count toward merge requirements to a narrow, reviewed file allowlist. Initial pilot paths (optional): `apps/mobile/src/services/voiceNav.ts` and `apps/mobile/src/__tests__/services/voiceNav.test.ts`. Do not enter a blank all-files allowlist. Start with the default entitled review effort; expand only after reviewing quality and costs.
3. In Settings / Rulesets, import [staged-ruleset.json](./merge-governance/staged-ruleset.json) as a **separate additive rule**; verify the UI accepts every source and field before activating. The JSON is a proposed REST-compatible rule payload; import support and availability have not been live-tested. If import cannot preserve source pins, configure the same requirements in the UI. Keep ruleset 26004626 active. Never add bypass actors. Require independent approval, dismiss stale approvals, require last-push approval and resolution of discussions, use strict up-to-date checks, and preserve merge commits. Enable automatic Copilot review on new pushes, not on every draft. Confirm CI Summary and every listed source-pinned job appears on a docs-only canary as well as a code PR. A GitHub UI check marked skipped/neutral is not a substitute for successful required validation.
4. Request Copilot review for a small, non-draft PR, record its actual independent APPROVED review and commit ID, and verify that GitHub recognizes it toward required approvals. Check new push invalidation, stale base, unresolved discussions, missing/failed/cancelled checks, unauthorized check source, and an excluded security-sensitive file. Use disposable test PRs without production side effects. A COMMENTED review, absence of findings, an approval on an older SHA, or an AI-written review by the author is not enough. Keep the old gate if any test or provider access fails.
5. Only after the additive rule is active and the positive and negative cases are verified, an administrator may retire the old App requirement as a deliberate policy migration (not an exception for pending PRs), retaining every new mandatory check and independent review requirement. Re-read both rulesets and their effective rules. Do not disable all branch protection. Roll back by restoring the old active rule first, then reverting any new configuration if necessary.
6. Enable Allow auto-merge in Settings / General only after the rules are validated. For each non-draft PR, recheck current head/base, actual diffs, review provenance, unresolved threads, and successful applicable checks. Use merge commits to preserve source history. Enable auto-merge per eligible PR only; when main advances, revalidate. Do not queue every existing PR simultaneously, and do not close or delete source branches based on patch similarity alone.

## Additional merge conditions

AI approvals may count only for allowlisted low-risk changes. Authentication, roles/ACLs, Firebase/Supabase rules, credentials, personal data, payment, migrations, dependency/security policies, review instructions, CI/workflows, deployment, and broad integration changes need independent human review. Copilot reads instructions from the proposed head, so these files must never be eligible for AI-only approval. Do not expand the allowlist to these paths.

The native rule enforces the always-on CI jobs, CodeQL checks and independent approval. It does **not** by itself enforce path-conditional checks. Before enabling auto-merge on an eligible PR, require Maestro for mobile-impacting changes and Mobile Agent Regression / applicable browser and access checks for affected paths, using current head and current main. If this cannot be verified, leave auto-merge off; a future always-running trusted aggregate check can automate this further. No deployment is authorized by this migration; preserve current production release gates.

## Official references

- [GitHub Copilot code review configuration](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review)
- [Copilot code review behavior and approvals](https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/code-review)
- [Managing repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository)
- [Available rules and status check source pins](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Auto-merge settings](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository)

No settings were activated, no checks were fabricated, and no permissions, credentials or production code were changed by this proposal.
