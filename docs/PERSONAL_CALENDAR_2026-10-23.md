# Personal calendar — 2026-10-23

## Scope

Personal (device / optional account-sync) agenda for **public / platform** identity paths. Events are **not** official school records, enrollment, RSVP, or automatic reminders.

Live note: Google Nuni sessions do not create Firebase school users. Web owner key uses `platform:…`; mobile uses `nuni:…` / `firebase:…` / `guest:device`. CRUD uses the existing personal-import ledger, not a separate store.

## Behavior

### Web (`/calendar`)

- Primary **新增行程** form: title, date, optional end date, all-day / timed, start/end time, optional location (no notes field in the contract).
- Direct **編輯** / confirmed **刪除** on a selected event via `savePersonalImportBatch` / `changePersonalImport`.
- Stable `id` + `source` provenance retained on edit; account + school isolation via storage scope keys.
- Validation / storage failures keep the draft; double-submit guarded; stale saves fenced after account/school switch (`key` remount + active scope check).
- Load failure: error shown, mutate disabled, ledger not treated as empty overwrite.
- Existing **從截圖或檔案匯入** (`/import?kind=events`) remains.
- Persistence copy reflects sync flag: device-only vs “saved on device; sync separately if enabled”.
- **匯出目前列表** always uses the visible month/list filter; edit mode has **匯出這筆**. Cancel clears selection so list export cannot silently stick to one row. Asia/Taipei; all-day exclusive `DTEND`; timed `TZID=Asia/Taipei`; escaping + line folding. Reminder/報名 limits sit in secondary help.

### Mobile

- Reachable `PersonalCalendar` on **LearnStack** (`Calendar` + `PersonalCalendar`) and **PreAuthStack** (guest / platform before school login).
- Login landing public entry + `PersonalImportSummary` (events) → personal calendar; UnifiedCalendar header links to it without enabling the old Firebase demo as the personal CRUD path.
- Same repository contracts: `appendPersonalImports` / `editPersonalImport` / `deletePersonalImport`.
- Create / edit / delete, retry on load error, empty state, account/school remount isolation.
- ICS export via `shareICalContent` (cache `.ics` + `expo-sharing`, `text/calendar`), with active-scope fencing before and after sharing. Every invocation owns a distinct cache path, so delayed cleanup cannot delete a newer export. Successful active sharing retains the file for asynchronous receivers.

## Tests (synthetic)

| Suite | Result |
| --- | --- |
| Web vitest (calendar + event draft/ICS) | 12 passed |
| Mobile jest (ICS sharing + existing iCal service, final correction) | 45 passed |
| Mobile PersonalCalendarScreen (reviewed screen candidate) | 5 passed |
| Shared / web typecheck; focused eslint | clean on touched files |
| Mobile `tsc --noEmit` | clean after Button `onPress` void fixes |

Covered: UI/storage create–edit–delete, end-before-start / all-day exclusive end / overnight, persistence failure keeps draft, damaged ledger no destructive overwrite, account/school isolation, import provenance preserved, ICS export wording.

## Browser QA (local)

Synthetic guest session against local Next dev (`http://127.0.0.1:4218/calendar`), independently exercised by root:

- Create timed event; reload and verify persistence; reject end-before-start; edit title/end time.
- Create an all-day event; open and cancel editing; export the list and parse **two** VEVENT entries, with Asia/Taipei timed boundaries and all-day exclusive DTEND.
- Explicit single-event export has one VEVENT. Cancel deletion preserves it; confirmed deletion stays deleted after reload.
- Month filtering hides and restores the remaining event. At 390 × 844, no horizontal overflow; screenshot visually inspected.
- Browser reported zero console errors and one CSS preload warning. No real user or production writes; no claim of physical-device sharing or cross-device sync.

## Limitations

- Not a full calendar competitor (no recurrence UI, invitations, push reminders, or school official feed merge).
- Notes field not in personal-import contract — omitted.
- Real-device App Store / production acceptance not verified here.
- Web/mobile owner key prefixes remain intentionally different (`platform:` vs `nuni:`) to avoid breaking existing ledgers.
