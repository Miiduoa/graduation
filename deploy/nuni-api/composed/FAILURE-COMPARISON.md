# 30 個失敗檔的正式基線與候選比對

正式基線 tree：`b0a10ac814cd03fbfb45132566035acce8339f17`；候選 tree：`4c7919d6cff32789acb06e2b9f4edb180cdad3a1`。

Node24.22.1、pnpm10.28.2、同一 frozen lockfile、EXPO_NO_DOTENV=1、兩個 worker；只重跑前輪30個失敗檔，沒有重跑其餘423檔。下表記錄預設5秒 timeout 的本輪結果，逐項原始錯誤與逾時重跑見 VALIDATION.md 及 `/workspace/nuni-api-fix3-evidence/`。

| 檔案（apps/api/ 下） | 前輪失敗 | 基線失敗 | 候選失敗 | 兩邊同名失敗 | 只基線 | 只候選 |
|---|---:|---:|---:|---:|---:|---:|
| `src/accounts/school-onboarding-service.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/app.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/calendar-core.test.ts` | 4 | 4 | 4 | 4 | 0 | 0 |
| `src/calendar/calendar-reminder-delivery-worker.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/career-application-purge-execution-expand-migration.test.ts` | 7 | 7 | 7 | 7 | 0 | 0 |
| `src/career-application-purge-planning-migration.test.ts` | 17 | 17 | 17 | 17 | 0 | 0 |
| `src/career-outbox-v2-transition-and-suppression-migration.test.ts` | 8 | 8 | 8 | 8 | 0 | 0 |
| `src/event-governance/producer-event-types-registered.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/evidence-binding-download-coverage.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/evidence-subject-screen-coverage.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/expected-version-provenance.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/food-campus-life.test.ts` | 5 | 5 | 5 | 5 | 0 | 0 |
| `src/food-guest-table.test.ts` | 7 | 7 | 7 | 7 | 0 | 0 |
| `src/food-merchant-mode-gating.test.ts` | 3 | 3 | 3 | 3 | 0 | 0 |
| `src/food-nutrition-call-turnover.test.ts` | 6 | 6 | 6 | 6 | 0 | 0 |
| `src/food-online-payment.test.ts` | 17 | 17 | 17 | 17 | 0 | 0 |
| `src/food-order-dispute.test.ts` | 4 | 4 | 4 | 4 | 0 | 0 |
| `src/food-ordering.test.ts` | 17 | 17 | 17 | 17 | 0 | 0 |
| `src/food-payment-action-offered.test.ts` | 4 | 4 | 4 | 4 | 0 | 0 |
| `src/food-procurement.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/food/food-table-session-close-worker.test.ts` | 2 | 2 | 2 | 2 | 0 | 0 |
| `src/in-school-entitlement.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/kitchen-only-staffer-can-work.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/leave-core.test.ts` | 4 | 4 | 4 | 4 | 0 | 0 |
| `src/notification-push-retry-truth.test.ts` | 2 | 2 | 2 | 2 | 0 | 0 |
| `src/privacy/privacy-inventory-v2.test.ts` | 2 | 2 | 2 | 2 | 0 | 0 |
| `src/social-capability-truth.test.ts` | 5 | 5 | 5 | 5 | 0 | 0 |
| `src/social-report-evidence.test.ts` | 5 | 5 | 5 | 5 | 0 | 0 |
| `src/staff-role-seed-respects-staged-schema.test.ts` | 1 | 1 | 1 | 1 | 0 | 0 |
| `src/test-support/outbox-failpoint.test.ts` | 5 | 0 | 1 | 0 | 0 | 1 |

原135項最終分類：既有118項、候選獨有回歸0項、環境因素17項。預設只在候選失敗的1項經60秒重跑兩邊通過；另1項同名點餐失敗在候選先逾時，60秒單項重跑後兩邊同樣是實際412、預期201的既有斷言。沒有只在候選失敗的實際斷言。

## 逐檔失敗測試名稱

以下列出前輪全部135個失敗名稱；「兩邊／只候選／兩邊通過」表示本輪預設5秒的狀態，括號為補跑後的最終分類。同名也另行核對錯誤內容，不自行等同同根因。

### src/accounts/school-onboarding-service.test.ts

- 兩邊：school onboarding application and platform approval lets an operator open a provisioned tenant so find-school shows it as open（基線也失敗）

### src/app.test.ts

- 兩邊：campus API keeps every registered non-public route authenticated by default（基線也失敗）

### src/calendar-core.test.ts

- 兩邊：unified calendar API core expands weekly class sessions, honors skipped occurrences, all-day events, conflicts and source-version reminders（基線也失敗）
- 兩邊：unified calendar API core keeps private personal events owner-only with replay-safe writes, history, conflicts and stale reminders（基線也失敗）
- 兩邊：unified calendar API core lets a teacher reschedule a class, notifies enrolled students in-app, and rebuilds reminders（基線也失敗）
- 兩邊：unified calendar API core returns a room conflict 409 before any side effect and lets the adjacent boundary through（基線也失敗）

### src/calendar/calendar-reminder-delivery-worker.test.ts

- 兩邊：calendar reminder delivery worker delivers a due reminder on database time with nobody opening the reminder list（基線也失敗）

### src/career-application-purge-execution-expand-migration.test.ts

- 兩邊：166 Career application purge execution expansion backfills legacy evidence conservatively and rejects ordinary receipt DML（基線也失敗）
- 兩邊：166 Career application purge execution expansion is the unique chain head, reruns cleanly, and keeps every activation gate false（基線也失敗）
- 兩邊：166 Career application purge execution expansion keeps every phase-2 guard after migration 165 is replayed out of order（基線也失敗）
- 兩邊：166 Career application purge execution expansion keeps pre-core and post-core dead letters distinct and terminal（基線也失敗）
- 兩邊：166 Career application purge execution expansion leaves the Career privacy target unchanged and manually unsucceedable（基線也失敗）
- 兩邊：166 Career application purge execution expansion rejects contradictory v2 pending and dead-letter facts（基線也失敗）
- 兩邊：166 Career application purge execution expansion represents ambiguous delivery without blessing legacy published rows（基線也失敗）

### src/career-application-purge-planning-migration.test.ts

- 兩邊：165 Career application purge planning model accepts only the approved platform request for the exact pending application and target（基線也失敗）
- 兩邊：165 Career application purge planning model blocks approved retention exception instead of creating runnable work（基線也失敗）
- 兩邊：165 Career application purge planning model blocks completed handoff instead of creating runnable work（基線也失敗）
- 兩邊：165 Career application purge planning model blocks late Career legal hold instead of creating runnable work（基線也失敗）
- 兩邊：165 Career application purge planning model blocks late platform hold instead of creating runnable work（基線也失敗）
- 兩邊：165 Career application purge planning model blocks open offer fraud case instead of creating runnable work（基線也失敗）
- 兩邊：165 Career application purge planning model does not permit jobs to enter any phase-2 effect state（基線也失敗）
- 兩邊：165 Career application purge planning model fails closed for incomplete scope, active application, future deadline and manual target success（基線也失敗）
- 兩邊：165 Career application purge planning model forbids DELETE and TRUNCATE across every authority and work-control relation（基線也失敗）
- 兩邊：165 Career application purge planning model is the unique chain head and remains rerunnable without enabling destruction（基線也失敗）
- 兩邊：165 Career application purge planning model keeps evidence and outbox scope immutable while phase 1 forbids effects（基線也失敗）
- 兩邊：165 Career application purge planning model leaves malformed scorecard cache uncovered instead of treating response.id as an application（基線也失敗）
- 兩邊：165 Career application purge planning model maps all 14 application operations by their actual response lineage（基線也失敗）
- 兩邊：165 Career application purge planning model records current blockers with deterministic precedence and explicitly requeues after release（基線也失敗）
- 兩邊：165 Career application purge planning model rejects forged link, evidence, outbox and phase-1 tombstone inserts（基線也失敗）
- 兩邊：165 Career application purge planning model rejects unverified Career target success, deletion and truncation（基線也失敗）
- 兩邊：165 Career application purge planning model uses transaction-stable now for the exact delete_after boundary and binds history to the job（基線也失敗）

### src/career-outbox-v2-transition-and-suppression-migration.test.ts

- 兩邊：167 Career outbox protocol-v2 transition and suppression safety layer fails closed when readiness is missing and leaves the candidate event unchanged（基線也失敗）
- 兩邊：167 Career outbox protocol-v2 transition and suppression safety layer is rerunnable and leaves role, cutover, core, destructive, and target gates false（基線也失敗）
- 兩邊：167 Career outbox protocol-v2 transition and suppression safety layer keeps an old 166 manual replay fail-closed and restores v2 only after rerunning 167（基線也失敗）
- 兩邊：167 Career outbox protocol-v2 transition and suppression safety layer keeps ordinary SQL on protocol 1 and rejects direct v2, payload, and suppression forgery（基線也失敗）
- 兩邊：167 Career outbox protocol-v2 transition and suppression safety layer rejects NULL transition and suppression CAS inputs without any side effect（基線也失敗）
- 兩邊：167 Career outbox protocol-v2 transition and suppression safety layer rejects scope, lease, and post-claim suppression without side effects（基線也失敗）
- 兩邊：167 Career outbox protocol-v2 transition and suppression safety layer suppresses only a matching pending event with an active job lease and fixed non-PII payload（基線也失敗）
- 兩邊：167 Career outbox protocol-v2 transition and suppression safety layer uses monotonic generation and token/provider/attempt uniqueness through accepted and dead-letter paths（基線也失敗）

### src/event-governance/producer-event-types-registered.test.ts

- 兩邊：生產端事件類型必須有註冊的契約 掃到的每一個事件類型都在內建清單裡（基線也失敗）

### src/evidence-binding-download-coverage.test.ts

- 兩邊：every kind of attachment someone can file has somebody who is allowed to open it（基線也失敗）

### src/evidence-subject-screen-coverage.test.ts

- 兩邊：every attachment a reviewer may open has a screen that points at it（基線也失敗）

### src/expected-version-provenance.test.ts

- 兩邊：expectedVersion provenance in user-facing screens never sends a hard-coded version except where creating the thing（基線也失敗）

### src/food-campus-life.test.ts

- 兩邊：food campus life: POS, shift, dining waitlist, qualification discount applies a qualification discount without exposing the internal reason to merchants（基線也失敗）
- 兩邊：food campus life: POS, shift, dining waitlist, qualification discount does not count pending-refund counter cash as expected drawer or day-close recorded cash（基線也失敗）
- 兩邊：food campus life: POS, shift, dining waitlist, qualification discount hides cashier queue buttons from kitchen-only staff and withholds counter payment until a shift is open（基線也失敗）
- 兩邊：food campus life: POS, shift, dining waitlist, qualification discount keeps cancelled POS tenders actionable until cash return or ledger reversal is explicitly confirmed（基線也失敗）
- 兩邊：food campus life: POS, shift, dining waitlist, qualification discount refuses POS take-order without an open shift, then records cash as a counter fact not card capture（基線也失敗）

### src/food-guest-table.test.ts

- 兩邊：food guest table ordering keeps leave students out of the in-school food path and blocks kitchen-only counter payment（基線也失敗）
- 兩邊：food guest table ordering keeps one guest across different open retry keys with the same nonce（基線也失敗）
- 兩邊：food guest table ordering keeps payment-pending table orders reachable when the same open key is replayed（基線也失敗；60秒重跑）
- 兩邊：food guest table ordering keeps two guests apart on one table even when they send the same retry key（基線也失敗）
- 兩邊：food guest table ordering lets a visitor quote and order from a table without a student login（基線也失敗）
- 兩邊：food guest table ordering lets staff end a table sitting so the next scan is a new session（基線也失敗）
- 兩邊：food guest table ordering rejects a bare table code, a guest student-card, and another guest's order（基線也失敗）

### src/food-merchant-mode-gating.test.ts

- 兩邊：food merchant mode gating does not create an in-app order after the stall switches to an external menu（基線也失敗）
- 兩邊：food merchant mode gating lets a full location quote（基線也失敗）
- 兩邊：food merchant mode gating treats empty merchant_mode as info_only and refuses a quote（基線也失敗）

### src/food-nutrition-call-turnover.test.ts

- 兩邊：food nutrition, calling and turnover announces a number without pretending the food was collected（基線也失敗）
- 兩邊：food nutrition, calling and turnover keeps staff calling away from students and call history away from another diner（基線也失敗）
- 兩邊：food nutrition, calling and turnover refuses to call a number before the food exists（基線也失敗）
- 兩邊：food nutrition, calling and turnover returns a bounded recent history without losing the full call count（基線也失敗）
- 兩邊：food nutrition, calling and turnover serializes simultaneous calls and replays one idempotency key without a duplicate announcement（基線也失敗）
- 兩邊：food nutrition, calling and turnover shows the counter what is ready and how often each has been called（基線也失敗）

### src/food-online-payment.test.ts

- 兩邊：food online payment, end to end through a stubbed provider actually sends the money back when a paid order is cancelled, and does not call it refunded yet（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider counts online money outside the till, so the cash variance does not go missing（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider does not open two checkouts for one order when the student taps twice（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider does not pay the order twice when the provider resends the same notification（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider does not try to refund an order that was never paid online（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider finishes the refund only when the provider says it settled（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider keeps a captured order paid when an older authorization notice arrives late（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider marks the order paid only when the provider record confirms it（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider never counts a development-only capture as real online money（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider opens a checkout, hands off through our own address, and does not call the order paid yet（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider records the money as received but leaves a cancelled order alone（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider refuses a handoff address whose signature was altered（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider refuses to pay an order when the notified amount does not match（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider routes a partial refund to a person instead of closing the order or waiting forever（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider sends the payer onward when the handoff address is opened, without any sign-in（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider tells the cashier the money already arrived online, so nobody is charged twice（基線也失敗）
- 兩邊：food online payment, end to end through a stubbed provider will not let a food order be paid by a slow offline method（基線也失敗）

### src/food-order-dispute.test.ts

- 兩邊：an order that came out wrong carries a complaint from the student to the shop and back, without ever saying the money is back（基線也失敗）
- 兩邊：an order that came out wrong keeps one order from carrying two open complaints about the same thing（基線也失敗）
- 兩邊：an order that came out wrong never lets a refund be larger than the order it refunds（基線也失敗）
- 兩邊：an order that came out wrong refuses evidence that is not a real clean attachment（基線也失敗）

### src/food-ordering.test.ts

- 兩邊：food preorder, inventory, KDS and pickup cancels unpaid orders immediately and keeps paid cancellation pending a real refund（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup completes paid -> accepted -> preparing -> ready -> one-time pickup without collapsing states（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup does not offer counter payment after the inventory reservation expires（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup enforces customer ownership and database-backed location assignments（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup keeps live payment blocked while the development capture remains explicit and does not create KDS（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup keeps paid inventory firm past the quote timer and blocks order creation after a location closes（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup keeps rejection truthfully pending refund and minimizes public event payloads（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup prices selected extras, shares a table session, and keeps stations separate until every ticket is ready（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup quotes only server prices, reserves stock once, and rejects payload smuggling（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup rejects unsupported customization and pickup times beyond the bounded window（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup 保留與扣料合起來剛好扣一次，不多也不少（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup 兩道菜共用同一食材時，各自買得起也不代表一起點得成（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup 沒有配方的餐點消耗零，也永遠不會被擋（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup 缺料而開不了火的已付款訂單，店家可以取消並進入待退款（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup 開始製作時依配方扣料，而且一張訂單只扣一次（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup 食材不夠做的餐點不會顯示成可購買，也點不下去（基線也失敗）
- 兩邊：food preorder, inventory, KDS and pickup 食材不足時擋下開始製作，並且不留下半套扣料（基線也失敗）

### src/food-payment-action-offered.test.ts

- 兩邊：a deployment without online payment offers no payment button does not advertise an action that would always fail（基線也失敗）
- 兩邊：the online payment action reaches the customer's order also offers it in the order list, not only on the detail screen（基線也失敗）
- 兩邊：the online payment action reaches the customer's order keeps the action out of the list once the order is no longer awaiting payment（基線也失敗）
- 兩邊：the online payment action reaches the customer's order offers create-payment-session on an order that is waiting to be paid（基線也失敗）

### src/food-procurement.test.ts

- 兩邊：food procurement, ingredients and expiry 同一天的邊界上，畫面、菜單可賣性與下單閘說的是同一件事（基線也失敗）

### src/food/food-table-session-close-worker.test.ts

- 兩邊：food table session close worker closes an overdue table session without treating kitchen or payment as done（基線也失敗）
- 兩邊：food table session close worker refuses a quote on an overdue sitting even if the close worker has not run（基線也失敗）

### src/in-school-entitlement.test.ts

- 兩邊：in-school entitlement remainder blocks leave and alumni from the five in-school services plus LMS record mutations（基線也失敗）

### src/kitchen-only-staffer-can-work.test.ts

- 兩邊：a kitchen-only staffer can do the whole kitchen job reaches the food workbench and carries one counter order through to ready（基線也失敗）

### src/leave-core.test.ts

- 兩邊：leave production API/DB core accepts a 0.3-hour leave when the increment is 0.1, which IEEE-754 modulo would reject（基線也失敗）
- 兩邊：leave production API/DB core accepts split date-time ranges whose envelope would exceed the duration cap（基線也失敗）
- 兩邊：leave production API/DB core charges one day for two half-day segments on the same campus calendar day（基線也失敗）
- 兩邊：leave production API/DB core releases 0.1 then 0.2 hour reservations without wedging the ledger（基線也失敗）

### src/notification-push-retry-truth.test.ts

- 兩邊：a deployment with web push configured never claims push is not open（環境因素；60秒重跑）
- 兩邊：a deployment without web push says so honestly, as configuration — not as fate（環境因素；60秒重跑）

### src/privacy/privacy-inventory-v2.test.ts

- 兩邊：keeps a pre-v3 v2 request intact, still open, and in the same operation namespace（基線也失敗）
- 兩邊：upgrades existing v1 rows unchanged and rejects relabelling an old snapshot as v2 or v3（基線也失敗）

### src/social-capability-truth.test.ts

- 兩邊：social capability claims follow the deployment does not claim external calendar is unconnected while it ships subscriptions（環境因素；60秒重跑）
- 兩邊：social capability claims follow the deployment keeps federation blocked because no federation protocol is implemented（環境因素；60秒重跑）
- 兩邊：social capability claims follow the deployment reports media as available when the attachment runtime is available（環境因素；60秒重跑）
- 兩邊：social capability claims follow the deployment reports media as blocked and names the scanner when the scanner is unavailable（環境因素；60秒重跑）
- 兩邊：social capability claims follow the deployment reports media as blocked when the object store is unavailable（環境因素；60秒重跑）

### src/social-report-evidence.test.ts

- 兩邊：social report evidence attachments accepts report evidence through the shared pipeline when the scanner is available（環境因素；60秒重跑）
- 兩邊：social report evidence attachments keeps text-only reports working while the scanner is unavailable（環境因素；60秒重跑）
- 兩邊：social report evidence attachments lets a scoped moderator open the evidence bound to a report（環境因素；60秒重跑）
- 兩邊：social report evidence attachments shows evidence to the moderation queue but never to the reported person（環境因素；60秒重跑）
- 兩邊：social report evidence attachments still refuses report evidence when the scanner is genuinely unavailable（環境因素；60秒重跑）

### src/staff-role-seed-respects-staged-schema.test.ts

- 兩邊：the demo seed runs on a schema staged before migration 199 seeds without touching any table that only exists after migration 199（基線也失敗）

### src/test-support/outbox-failpoint.test.ts

- 兩邊通過：outbox persistence failpoint always disarms when the failing-path assertion throws（環境因素；60秒重跑）
- 兩邊通過：outbox persistence failpoint does not mask a frozen callback error when cleanup also fails（環境因素；60秒重跑）
- 只候選：outbox persistence failpoint refuses a real on-disk PGlite database created by the production factory（環境因素；60秒重跑）
- 兩邊通過：outbox persistence failpoint reports a cleanup-only failure（環境因素；60秒重跑）
- 兩邊通過：outbox persistence failpoint retains a non-Error callback throw alongside the cleanup failure（環境因素；60秒重跑）
