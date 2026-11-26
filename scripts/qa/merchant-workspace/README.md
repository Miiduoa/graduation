# Merchant workspace browser fixture

Run from the repository root with the locked dependencies installed:

```sh
node scripts/qa/merchant-workspace/build.mjs
node scripts/qa/merchant-workspace/serve.mjs
```

The `Merchant Workspace Browser` GitHub Actions workflow checks the exact PR head
with the repository's locked Node/pnpm versions and Chromium setup. In that CI
environment, `python scripts/qa/merchant-workspace/check.py` starts this server,
runs the desktop/390px dark/320px 200%-text reduced-motion scenarios, and writes
`checks.json`, screenshots, failure HTML when needed, and the server log alongside
the bundled source hashes. A pending or interrupted scenario cannot count as a
pass. These synthetic checks do not establish real-account or deployment success.

The server listens on port `4178` (`MERCHANT_QA_PORT` overrides it) and falls back to
the same application for deep links, so refreshing a merchant URL is testable.

## Scope

This bundles the actual `MerchantWorkspace`, `MerchantOperations`,
`MerchantOrderDesk`, `SiteShell`, header, shared controls and CSS. Only Next's
routing, authentication/session, school data and network/data boundaries are
synthetic. The manifest `artifacts/merchant-workspace/source-sha256.json` records
every bundled source hash and each replaced import. The fixture does not prove
real account access, production deployment or real payment processing.

All mutations update local memory only. External `fetch` is rejected and the
server's Content Security Policy blocks network connections and form submission.
Refreshing restores the initial synthetic orders and store data.

## Scenarios

- `/merchant/workspace`: two authorized locations of the same brand and campus.
  Store A is active; Store B still needs settings and an initial menu.
- `/merchant/workspace?tenant=campus-one&location=store-a&section=orders&queue=active`:
  direct entry into A's preparation/pickup view, with two incoming and two active
  orders available in the whole queue.
- `/merchant/workspace?tenant=campus-one&location=store-b`: the incomplete store.
- Add `theme=dark`, `text=200` or `motion=reduce` on initial load to check the actual
  product's dark theme, enlarged root font or reduced-motion preference.
- Add `account=guest` initially for the real sign-in component. OAuth is disabled
  in this fixture; inspect the return destination without submitting it.

Controls below the real application switch to a second account with no merchant
membership, revoke Store A, or hold/release reads. For a stale-response check,
delay reads, reload the selected store, change accounts, then release reads. Old
captured responses intentionally resolve, allowing the product's scope checks to
prove they reject those responses.

Read-only diagnostic state is available as `window.__merchantQA.snapshot()`;
network requests and synthetic writes are recorded separately. The fixture's
control functions are for local QA only and never ship with the application.

Suggested viewport coverage: desktop, 390px dark, and 320px with 200% root text and
reduced motion. Check Back/Forward, refresh, normal versus new-tab links, keyboard
focus, authorization recovery, unknown targets, local write confirmations and
no horizontal overflow. Camera scanning and real OAuth/device permissions need
separate device validation.
