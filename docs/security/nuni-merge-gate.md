# nuni merge gate pilot

The pilot records the owner's delegated review of an exact pull request, head and base. The genuine GitHub App `5504170` issues `審查通過`. Its signing job runs only on GitHub-hosted runners, checks out the triggering `main` commit and uses a repository-scoped installation token with `checks:write`. A review submitted through the owner's account is recorded as an owner-delegated decision.

## Publication hold

`policy.json` sets `publicationEnabled` to `false`. An `approve` request stops before requesting an environment, signing a JWT or writing a check. Keep the hold through bootstrap and independent live verification of GitHub blocking failed reruns and newly opened discussions. Activation requires a separately reviewed change on the existing genuine App path. The local test fixture exercises the future enabled path in a credential-free child process.

## Bootstrap

1. Review the security change, its exact head, CI, CodeQL and the applicable Maestro full run. Use the existing genuine App procedure to approve this PR for `main`. The proposed `issue_comment` workflow becomes available after it reaches the default branch.
2. Keep [ruleset 26004626](https://github.com/Miiduoa/graduation/rules/26004626) active on `main` with an empty bypass list. Enable strict up-to-date and required conversation resolution. In that same ruleset, pin the contexts below to their listed sources. Activate the three conditional test results once their workflows are available on `main`. Older branches then need to incorporate the new base.
3. Configure `nuni-merge-gate` (environment ID `28496869500`) with exactly one branch rule for `main`, admin bypass disabled, and owner `Miiduoa` as the sole required environment reviewer. Permit the owner to review an environment run they initiated. This review grants the signing job access to its environment after a separate administrator readback.
4. Confirm the App installation selects only `Miiduoa/graduation`. After bootstrap, the owner can enter `NUNI_GATE_PRIVATE_KEY` directly in GitHub's **environment secrets** form. Keep the private key out of repository-wide secrets, local review commands, PR jobs and chat. The installed App also has commit status permission. The pilot requests only checks permission for the one repository and revokes the token after use.

| GitHub source | Required check contexts |
| --- | --- |
| nuni-merge-gate `5504170` | `審查通過` |
| CodeQL `57789` | `CodeQL` |
| GitHub Actions `15368` | `CI Summary`, `Analyze (javascript-typescript)`, `policy-and-postgres`, `EAS Update (Preview)`, `Maestro PR result`, `Mobile agent PR result`, `Spatial browser PR result` |

`CI Summary` requires all nine validation jobs. The three conditional results run on every `main` PR. Each checks the changed paths using the event's exact Git merge parents. A suite deemed applicable must pass. Failed classification, missing evidence, a cancelled test or an applicable skipped test fails its result. A skipped optional preview remains eligible under GitHub's native status-check semantics. GitHub continues to enforce the required checks and unresolved conversations after the App posts its result.

## Operator procedure

The allowlist contains 14 reliability and campus map paths. The policy pins the trusted workflows and the scripts that classify changes and validate Maestro reports. The policy integrity tests hash the actual repository files and compare the complete workflow inventory, so workflow edits require an explicit review and pin update; no runtime process refreshes trusted pins automatically. Changes outside this scope use the existing App procedure. Mobile and shared wake-aware changes require iOS smoke and full tests including successful JUnit evidence for each committed flow. The full suite runs every isolated flow to collect all reports, then fails if any flow failed. Use **Re-run all jobs** if a partial retry lacks the complete successful job set for the current attempt. A manual workflow run provides additional evidence; the gate verifies `pull_request` runs for the exact PR, head and base.

1. Read the exact diff, address findings and review the tests. Submit an owner review on that head with `nuni-gate-review v1 head=<head> base=<base> outcome=pass` as its first line. Record specific findings, test evidence and remaining limitations in at least 120 additional characters. Use a `COMMENT` review on the owner's own PR.
2. After activation, add a new PR comment containing `/nuni-gate check <head> <base> <review-id>` for a read-only check, or `/nuni-gate approve <head> <base> <review-id>` to request publication. Use full commit SHAs. A dry run with no visibility into the bypass list reports missing evidence. A valid approve request can enter the protected environment queue. Queue admission grants no App check.
3. From a trusted checkout of the reviewed `main` commit, run the following with GitHub CLI authenticated as the repository owner. Use the numbers in the run URL, run attempt, and initiating PR/comment URLs.

   ```sh
   node scripts/merge-gate/attest-environment.mjs <run-id> <attempt> <pr-number> <comment-id>
   node scripts/merge-gate/attest-environment.mjs <run-id> <attempt> <pr-number> <comment-id> --approve-environment
   ```

   The first command reads only. The second independently rechecks the pending deployment, current `main`, PR, comment, exact review, environment restrictions and the latest version of the ruleset. It requires explicit empty bypass lists in both the administrative current ruleset and its immutable GitHub history entry. It records those observations through GitHub's environment approval API. The Actions job has no administration credential. A generic approval from the web UI lacks the required evidence. An expired or ambiguous approval requires a fresh command.
4. The publisher reads the GitHub-recorded environment approval for its own run. It checks the owner, environment ID, PR, head, base, review, triggering comment, run attempt, five-minute freshness, and current ruleset timestamp and content digest. It repeats these checks before minting a token and immediately before writing. It accepts an existing App success only for the identical command and workflow run. A historical App check without that evidence requires separate review by the existing App operator.
5. Immediately before merging, use the management account to recheck the ruleset and empty bypass list, latest `main`, exact PR head, current checks, review and resolved conversations. Confirm that the App check's `external_id` is `nuni-gate:v2:<PR>:<head>:<base>:<review-id>:<comment-id>` and its details link is the issuing workflow run. GitHub associates native checks with commits. A PR sharing another PR's head still needs its own matching audit record. Merge through the normal PR interface with an expected head SHA, one batch at a time. Recheck the next batch against the new `main`.

## Verification and rollback

### Revalidating an issued approval

`nuni-merge-gate-revalidate.yml` reads current evidence after CI starts or completes, after a review/comment event relay, when an initiating PR comment is edited/deleted, and every 15 minutes. The review relay has no credentials or checkout. The consumer always checks out its triggering `main` revision; it never executes PR code or reads event artifacts. `workflow_run.in_progress` is included because GitHub does not emit `requested` for reruns. Review thread resolve/unresolve is not an Actions trigger, so the periodic scan covers that case.

The inspection job has read-only permissions and no App key. Only an actual invalid `nuni-gate:v2` success requests the **existing** `nuni-merge-gate` protected environment. The owner must approve that environment before withdrawal; environment restrictions and private-key scope remain unchanged. This approval grants only the ability to withdraw an invalid verdict and requires no change to the publication hold. The signing job repeats the complete evidence check, re-reads the exact check ID, head, audit binding, publication time and issuing run, and PATCHes that existing check to `failure`. It cannot create or restore a success. Non-pilot checks, other Apps and changed check identities remain untouched. Issuance freshness is evaluated at the check's publication time; a valid approval is not revoked merely because its original command is now more than one hour old.

Native strict required checks and conversation resolution remain the merge-time enforcement. Background runs and protected-environment approval can be delayed, so check withdrawal is an additional audit safeguard, not an atomic replacement for those protections. Keep `publicationEnabled: false` until live acceptance confirms a successful genuine App verdict is blocked after a failed rerun and after a newly unresolved discussion, then confirms that the protected withdrawal job changes that same App check to failure. A repaired PR requires a fresh review and approval through the existing operator procedure; this worker never restores the old green result.

Run `node --test scripts/merge-gate/*.test.mjs` and `python3 scripts/merge-gate/maestro-reports.test.py`. Local negative tests exercise the actual publish entry point without credentials or network access. Live acceptance requires a protected environment approval, real App identity and check readback, plus verifying that GitHub blocks a failed required rerun and an unresolved discussion after an earlier success. To stop publication, disable the publisher, remove the environment secret and revoke its dedicated App key. Keep `main` protections active.

[GitHub ruleset visibility](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset) · [Workflow environment approval history](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run) · [GitHub required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)

[Workflow run and review events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
