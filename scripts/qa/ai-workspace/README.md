# AI workspace browser checks

This fixture bundles the real Web workspace provider, header, home composer,
StudentToday, lazy TodayCampusEntry, Conversation, AssistantThread and their CSS.
Only account/session providers, selected-campus hooks, Next navigation, home
records and the capability/ask transport responses are synthetic.

The assistant reply explicitly says it is synthetic. There are no write cards.
The fixture rejects every unexpected fetch or infrastructure call, and Playwright
blocks all browser network requests except local fixture files. It must never
reuse production credentials, browser storage or a signed-in profile.

## Run

From the repository root, with its pinned Node and installed dependencies:

```bash
node scripts/qa/ai-workspace/build.mjs
python scripts/qa/ai-workspace/check.py
```

The checker starts its own loopback server and uses an isolated Chromium context
for each scenario. Install Playwright Chromium using the repository browser setup
when it is unavailable. `PLAYWRIGHT_EXECUTABLE_PATH` may select an existing binary.

Artifacts are written to `artifacts/ai-workspace/`. Source hashes are checked
before and after execution; rebuild after any product or fixture change.
React and React DOM resolve from the Web package. The build checks the installed
versions against the Web manifest plus root `pnpm.overrides`, and records their
resolved paths and package hashes. The override is authoritative when present.

## Scope

The six scenarios cover desktop 1440px, phones 390px/320px, dark mode, 200% text,
OS reduced motion with the app preference off, and app reduced motion with the
OS set to `no-preference`. Both motion cases independently verify the panel's
entrance animation and the home composer's focus transitions are disabled.
Other checks cover homepage entry visibility, explicit consent, actual question/response UI,
shared drafts, minimize/resume, navigation to coursework and map, account/campus
isolation, same-session revalidation, guest local search and keyboard closing.

This is component/runtime evidence with synthetic transport. It does not verify
Next server routing, real Google/school login, Groq response quality, remote
authorization, task writes, native apps, Safari or production deployment.
