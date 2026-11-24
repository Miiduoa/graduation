# AI workspace browser checks

This fixture bundles the real Web workspace provider, header, home composer,
StudentToday, TodayAgent/Panel, lazy TodayCampusEntry, Conversation, AssistantThread
and their CSS. Journal, calendar receipt mirroring, tracking storage and Web Locks
also remain actual product implementations.
Only account/session providers, selected-campus hooks, Next navigation, home
records and the transport responses are synthetic.

The six continuity scenarios have explicitly synthetic replies and no write cards.
Two additional coursework scenarios use an isolated synthetic backend ledger and
signed-looking fixture tokens. A real chat confirmation creates one synthetic
record; real browser storage retains its receipt, recovery journal and tracking
proof. The fixture never seeds a product proof to bypass the handoff being tested.
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
The manifest records the actual Git HEAD and dirty working-tree state. It also
fingerprints the type-only assistant card contract, server signing/contracts and
this workflow explicitly. Those contract fingerprints identify the source version;
they do not claim that the browser executes server authorization or CI itself.

## Scope

The six continuity scenarios cover desktop 1440px, phones 390px/320px, dark mode, 200% text,
OS reduced motion with the app preference off, and app reduced motion with the
OS set to `no-preference`. Both motion cases independently verify the panel's
entrance animation and the home composer's focus transitions are disabled.
Other checks cover homepage entry visibility, explicit consent, actual question/response UI,
shared drafts, minimize/resume, navigation to coursework and map, account/campus
isolation, same-session revalidation, guest local search and keyboard closing.

The two coursework scenarios keep the real Today already mounted while the real
chat prepares and explicitly confirms a different coursework card. Assertions
verify one write, exact source/conversation/session binding, the first classifier
read against the journal, and the next read against the saved tracking proof.
Journal removal must occur only after that proof is durable. The Today panel's
DOM identity and document time origin remain unchanged, and its unsent duplicate
preview disappears. Exact coursework/calendar links come from the verified source.

The phone failure case rejects the initial tracking read after the event was
verified. It retains the event and recovery journal, then exercises the actual
chat recheck control: reconcile and followup reads restore tracking without a
second ask, plan or confirm. It also rejects a later Today status read and uses
the actual Today retry control, checking unchanged records, imports and proofs.
Every request, synthetic write, journal-removal snapshot and UI phase is captured.

This is component/runtime evidence with synthetic transport. It does not verify
Next server routing, real Google/school login, Groq response quality, remote
authorization, production task writes, native apps, Safari or production deployment.
