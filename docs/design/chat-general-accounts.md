# 一般帳號開放聊天（含私訊與社團群）

2026-10-12。顧晉瑋決定兩件事：

1. 只用 Google、Apple 或 Email 登入、沒綁學校的一般帳號，也可以用聊天，包括私訊。
2. 一般帳號也可以進**社團群**（公開社團、活動群）。**班級群仍限已驗證的同校學生。**

這份只寫設計，**不改正式站資料、不部署、不改 `.github/workflows/ci.yml` 的 deploy 條件，也不設定 `ONLINE_ORDERING_ENABLED` 或 `NEXT_PUBLIC_ONLINE_ORDERING`**。後續實作另開工作，本文不是上線授權。

---

## 1. 為什麼要改、現在卡在哪

目前聊天與群組整條鏈都假設「已登入、而且是該校在籍會員」。一般帳號能看公車、公告、餐廳等公開功能，一進對話或群組就被擋下來。

對得上程式的現況：

| 位置 | 現況 | 對一般帳號的後果 |
| --- | --- | --- |
| `backend/firestore/firestore.rules` 的 `conversations` | 建立時必須 `schoolId != null`，且 `isSchoolMember(schoolId)`（`schools/{schoolId}/members/{uid}.status == 'active'`） | 沒有校籍不能建對話 |
| 同一段規則的讀取／寫訊息 | 只要 `request.auth.uid` 在 `memberIds` 即可 | 若被寫進成員名單就能讀；問題在進不去 |
| Web `apps/web/src/lib/privateMessages.ts` | `watchMessagingSession` 要求 `users/{uid}.schoolId` 存在，且該校 `members/{uid}.status == 'active'` 才給 session | 沒綁學校連收件匣都開不成 |
| Web `Messaging.tsx` | 未登入文案是「登入學校帳號後，就能查看你的對話與通知。」列表寫「最近更新的 100 個**校內**對話」 | 產品語言把聊天等同學校帳號 |
| 對方名字 | Web 讀 `schools/{schoolId}/directory/{uid}`；App `ChatScreen` / `DmsScreen` / `GroupMembersScreen` 走 `fetchSchoolDirectoryProfiles`。directory 規則只給校籍會員讀 | 一般帳號讀不到校內名錄；校內名錄也不該給未驗證的人看 |
| DM 文件 id | `deriveDmConversationId(schoolId, a, b)` → `dm_{schoolId}_{uidA}_{uidB}`（兩端相同） | 沒有 schoolId 就沒有穩定 id |
| App `firebaseSource.createConversation` | 沒有 `schoolId` 直接丟「缺少 schoolId，無法建立對話」 | 一般帳號建不了私訊或群聊 |
| `friendships` / `friendBlocks` / 找人代號 | 建立與讀取都要 `isSchoolMember` | 不能靠現有好友、封鎖、校內代號來找一般帳號 |
| 群組文件 | 讀取只要 `isActiveGroupMember`；建立要校籍。`createGroup` 已有 `isPrivate`、`isPublished`，但沒有加入分級 | 沒進群就看不到社團主頁；沒有「公開／需審核／僅限同校」 |
| `joinGroupByCode` | 交易裡檢查該校 `members` 為 `active`，且請求的 `schoolId` 必須等於群的 `schoolId`。成員文件不能由客戶端建立 | 一般帳號用加入碼也進不去。班級、社團、讀書會走同一道門 |
| App `GroupsScreen` | `users/{uid}/groups` 查詢帶 `schoolId == 目前學校` | 沒綁學校的人連「我的群組」都查不到 |
| 成員名單 | `GroupMembersScreen` 列出 `groups/{id}/members` 再補名錄的 `displayName`、`department` | 一開放讀取就可能把真名、系所交給未驗證的人 |
| 附件 | Storage 對話路徑只要是對話成員就能上傳（圖／檔上限 20MB） | 一旦進得去，未驗證帳號也能傳圖 |
| 配額、訊息請求、平台級封鎖／檢舉、禁言、加入申請 | 沒有這些集合。現有 `friendBlocks` 綁學校；POI `reports` 是景點檢舉；Nuni 看板已有 `joinPolicy: open \| request \| invite-only`，但那是跨校貼文板，不是 Firestore 社團群 | 陌生人私訊與公開社團都沒有緩衝層 |

「已驗證身分」在本文件的意思，跟現有授權一致：該 Firebase UID 在至少一所學校的 `schools/{schoolId}/members/{uid}.status == 'active'`。Nuni 學校資格若是 `pending`、`rejected`、`revoked`，或根本沒申請，都還是一般帳號。驗證成功是在**既有平台帳號上加上學校保證**，不另開聊天身分。

「一般帳號」：已用 Google、Apple 或 Email 登入平台，但沒有任何一校的 active 校籍。沒登入的人仍然不能聊天、不能進群。Apple／Email 目前不是完整產品入口（平台登入以 Google 為主）；權限表不為它們另寫一套，只要還沒通過學校核對，都算一般帳號。

`users/{uid}` 只有本人能讀，裡面可有 `displayName`、`studentId`、`schoolId`、`email`。校內名錄另有 `department`、`roleLabel`。這些都不能因為開了聊天或社團群，就讓未驗證的人看見。

「社團群／活動群」對應現有 `groups.type == 'club'`（活動群可再掛 `linkedEventId` 指到 `schools/{schoolId}/clubEvents/{eventId}`）。報名活動（`clubEvents/.../registrations`）**不會**自動變成聊天成員，避免把報名個資捲進群。`type == 'course'` 是班級群，不在此次放寬範圍。`type == 'study'` 見第 12 節待決。

---

## 2. 別人怎麼讓未驗證的人進群，又防詐騙、防騷擾

下面只摘可直接借到 Campus One 的做法，不是要做成 Discord 或 LINE。

| 產品 | 進群怎麼分級 | 進得去之後怎麼限 | 可借用的 |
| --- | --- | --- | --- |
| Discord | 伺服器可公開；另有驗證等級（已驗證 email、帳號年齡、**進群滿 10 分鐘才能發言**、最高還要電話）。Rules Screening：同意規則前不能說話、不能對成員私訊 | AutoMod 先擋關鍵字／洗版；Slowmode 限制發言頻率；管理員可 timeout（禁言）、踢人 | 公開群仍要冷靜期；未同意／未過冷靜期不能從群裡私訊別人；檢舉或規則命中可先擋訊息再通知幹部 |
| LINE OpenChat | 管理員三選一：公開加入、管理員核准、邀請碼。新開或剛改名的房間約 24 小時內不出現在搜尋 | 管理員可刪訊息、強制退出、設 NG 詞；未滿 18 或未完成年齡確認功能會被限。外人看不到誰在房間裡 | 三種加入方式對得上我們的公開／需審核／僅限同校；公開目錄不要一開放就被搜到；成員名單預設不給外人看 |
| Telegram 群組 | 可公開、可開「加入需管理員同意」 | 一般成員可被關掉「傳連結／傳媒體／拉人」；Slow mode；大群可隱藏成員名單；檢舉並封鎖 | 未驗證預設不能傳連結；隱藏名單避免被掃去私訊詐騙；幹部一鍵踢人 |
| Dcard | 註冊後很多互動要學校或身分驗證；部分看板另要求驗證才能留言 | 禁止留聯絡方式／導流；檢舉由站方處理；匿名討論不把校系背後的真名揭開 | 校板、班級這種「學校身分才合理」的空間維持驗證牆；未驗證在群裡也不准看到別人的真名、學號、學校 |

Nuni 跨校看板已有 `joinPolicy: 'open' | 'request' | 'invite-only'`（`apps/web/src/features/admin/api.ts`）。社團群沿用 **公開／需審核** 這兩個字，第三級改成校園需要的 **僅限同校驗證**，不要再發明第四套詞。

綜合後採用的層次：

1. 加入分級由幹部設定，既有社團預設維持僅限同校，避免一上線就對外公佈。
2. 進群 ≠ 能發言、能看名單、能私訊。
3. 未驗證預設禁連結；圖有冷靜期與張數上限。
4. 名單是騷擾入口，未驗證不給看完整名單。
5. 幹部要有審核、踢人、禁言；檢舉累積到門檻先對其他人隱藏，不立刻自動踢人。

---

## 3. 誰可以傳給誰

原則：一般帳號走**平台私訊**，以及幹部設為公開或需審核的**社團／活動群**。班級群、校內好友與校內名錄維持校籍。陌生人的第一則私訊先進對方的「訊息請求」，接受後才變成正式對話。

### 3.1 私訊

| 發送方 | 接收方 | 可不可以 | 怎麼進對話 |
| --- | --- | --- | --- |
| 一般帳號 | 已驗證學生（任一校） | 可以 | 對方「訊息請求」。接受後才是正式對話 |
| 已驗證學生 | 一般帳號 | 可以 | 一般帳號的「訊息請求」。學生端仍看到未驗證標示 |
| 一般帳號 | 一般帳號 | 可以 | 雙方都走訊息請求 |
| 已驗證學生 | 同一所學校、已驗證的學生 | 可以，維持現況 | 沿用 `dm_{schoolId}_…`，不強制再走請求（彼此已能從校內名錄／好友／代號找到） |
| 已驗證學生 | 另一所學校、已驗證的學生 | 可以 | 視為陌生人，走平台私訊與訊息請求，不共用任一方的校內名錄 |
| 未登入 | 任何人 | 不行 | 維持現況 |

補充：

- 被封鎖的人不能再送請求，也不能寫入已存在的對話。平台封鎖見第 5 節，與現有校內 `friendBlocks` 分開。
- 兩人只會有一份平台私訊文件。先送請求的人寫入；對方接受後同一份文件改成正式對話，不另開 id。
- 同一所學校的兩名已驗證學生，繼續用現有校內 DM，避免把舊對話拆成兩份。
- 學生與一般帳號之間**不用**校內 DM id。即使該學生之後換學校、或一般帳號後來通過驗證，這份平台對話仍在；通過驗證不自動把舊訊息搬進校內 DM。

誰可以「找到」對方來傳第一則：

- 一般帳號不能查 `schools/{schoolId}/directory`、`schools/{schoolId}/handles`、學號、課程名單。
- 一般帳號可用自己設定的**平台聊天代號**（不是校內 handles）被找到，或從對方分享的個人聊天連結進入。
- 已驗證學生可從校內名錄找同學（維持現況）；要找一般帳號，只能用對方給的平台代號或連結，不能用學號反查。
- 店面留言、公開貼文若之後要加「傳訊」入口，只能開平台私訊請求，不能把作者的學號、學校、真名帶過去。
- 從社團群點進私訊：見第 6.4 節，未驗證不能靠成員名單掃人。

### 3.2 班級群

對應現有 `groups.type == 'course'`。成員來自校務名單、教師加入，或 `joinGroupByCode`；後者已強制該校 active 校籍。群組文件的讀取是 `isActiveGroupMember`；成員子文件不能由客戶端建立。

| 規則 | 說明 |
| --- | --- |
| 誰進得去 | 該班／該課的 active 成員，且本身是**該校**已驗證身分 |
| 加入分級 | 固定 `school_verified`。幹部、老師都不能改成公開或需審核 |
| 一般帳號 | 不能加入、不能被加進 `groups/{id}/members`、不能出現在班級群聊 |
| 聊天內容 | 只有 active 成員能讀寫。作業、點名、成績、名單仍走原契約 |
| 老師／助教想聯絡校外的人 | 用平台私訊，不要把對方拉進班級群 |
| 一般帳號之後通過驗證 | 驗證加上課籍之後，才能用既有加入流程進班 |

班級群維持校內，是因為它綁課表、作業與名單。開放會讓未驗證的人看到同學與課程脈絡。

### 3.3 社團群與活動群：加入分級

對應 `groups.type == 'club'`。建立群組目前仍要校籍（`createGroup` 的 `assertActiveSchoolMember`），所以**開社團的人必須是已驗證學生或幹部**；一般帳號只能加入，不能當第一個開群的人。

活動群同一套規則，可選填 `linkedEventId`。`schools/{schoolId}/clubEvents` 的報名名單不自動同步成聊天成員。

幹部（`owner`／`moderator`，現有 `canManageGroup`）設定 `joinPolicy`，三選一：

| 分級 | 儲存值 | 誰進得去 | 列表上誰看得到 |
| --- | --- | --- | --- |
| 公開 | `open` | 已登入即可立刻成為成員（仍受第 6 節冷靜期與發言限制） | 已登入的人可在公開社團目錄看到（要 `isPublished == true`） |
| 需審核 | `request` | 已登入可送加入申請；幹部核准後才是成員。核准前看不到群聊與貼文 | 同上，按鈕是「申請加入」 |
| 僅限同校驗證 | `school_verified` | 維持現況：該校 `members.status == 'active'`，可用加入碼或幹部加入 | 只出現在該校已驗證學生的社團列表，一般帳號看不到 |

**預設值：**

- **已經存在、沒有 `joinPolicy` 欄位的社團／活動群**：視同 `school_verified`。一般帳號進不去，行為與今天相同。幹部要公開或改需審核，必須自己改一次。
- **之後新建的社團／活動群**：預設 `request`（需審核）。不要預設公開。
- **班級群**：不能改，永遠 `school_verified`。
- 從 `school_verified` 改成 `open` 或 `request` 時，畫面要先確認：「之後沒綁學校的人也能進來。群裡只會顯示暱稱，不會顯示學號與真名。」
- 從 `open`／`request` 改回 `school_verified` 時：未驗證成員改為 `status: 'left'`，並寫原因 `policy_closed`；他們不能再讀群聊。不刪歷史訊息。

`isPrivate`、`isPublished`（`createGroup` 已有）不取代 `joinPolicy`：

- `joinPolicy` 管能不能進。
- `isPublished` 管要不要出現在公開目錄。`open`／`request` 且未發佈＝有連結的人才能申請，目錄找不到（類似 LINE 邀請碼房）。
- 既有 `isPrivate == true` 且沒有 `joinPolicy` 的，仍視同 `school_verified`。

加入碼（`joinCode`）：

- `school_verified`：維持現況，`joinGroupByCode` 仍要該校校籍。
- `request`：有碼的人只能送到申請，不能靠碼跳過審核。
- `open`：有碼且已登入就加入，但仍走冷靜期。
- 班級群的碼絕不讓一般帳號使用；Functions 依 `type == 'course'` 直接拒絕。

---

## 4. 畫面怎麼標出「未驗證身分」

只要對話或群聊裡，**觀看者看得到的那個人**不是已驗證身分，就要標。已驗證對已驗證、且該空間是 `school_verified`（校內私訊或僅限同校的社團／班級）時，不顯示這組標示。色票跟 `docs/design/design-system.md`：紙白底、次要文字 `--muted`／`theme.colors.muted`，警示用語意提醒色，不能只靠顏色、也不另做紫色標籤。

無障礙名稱必須包含「未驗證身分」，不能只剩圖示。

### 4.1 頭像

現況：Web 列表用名字第一個字當圓形字頭（`Messaging.tsx` 的 `styles.avatar`）；App 對話頂端目前主要是文字標題；群組成員用 `Avatar` 加名錄。

未驗證時：

- 圓形頭像仍只顯示**平台暱稱**的第一個字，或本人上傳的平台頭像。
- 右下疊一枚約 16px 的灰底圓章，圖示用問號或「未驗證」盾牌（`Ionicons` 的 `shield-outline` 可接受）。
- 圓章對螢幕閱讀器的名稱：「未驗證身分」。
- 沒有平台頭像時不要去讀校內名錄或 Google 大頭照裡可能帶出的真名。
- 已驗證且這場是校內、僅限同校的空間：維持現況，不加這枚圓章。已驗證學生在**平台私訊**與**公開／需審核社團**裡對外也只顯示平台暱稱頭像。

### 4.2 名字旁

出現位置：對話列表、訊息氣泡上方的發送者名稱（App `ChatScreen` 已有 `senderName`）、Web 對話標題、社團群聊氣泡。

- 暱稱後面緊接一枚文字標籤，文案固定為 **「未驗證身分」**。
- 標籤樣式：次要文字、細框，不要做成「訪客」或「校外人士」（那會讓人以為是學校核發的校外身分）。
- 已驗證學生在平台私訊與公開／需審核社團的顯示名是平台暱稱，**名字旁不寫學校、系所、學號、職稱**。僅限同校的班級／社團仍可用名錄的 `displayName`／`roleLabel`。
- 自己看自己：設定頁可寫「其他人會看到：未驗證身分」。聊天氣泡裡自己的訊息不必每則都標。

### 4.3 對話與群組頂端

現況：App `ChatScreen` 用 `headerTitle` 顯示對方名字與「正在輸入⋯」／「在線」；Web 對話頁是 `<h2>` 對方名字。App 已有引用貼文橫幅 `refBanner`，未驗證橫幅可放在同一層、搜尋列下方。

對方是未驗證時，私訊頂端固定一條橫幅（不可滑掉，直到對方通過驗證）：

- 標題：**對方尚未通過學校身分驗證**
- 內文：**這不是學校核對過的帳號。請不要提供學號、證件、密碼或轉帳資料。**
- 橫幅右側次要動作：「檢舉」與「封鎖」，見第 5 節。
- 自己是未驗證、對方已驗證時，改顯示：**你的帳號尚未通過學校身分驗證。對方會看到未驗證標示。通過驗證後，才能加入班級群。**
- 雙方都未驗證：用第一條（對方未驗證）為主。
- 訊息請求尚未接受前，頂端加上：**這是訊息請求。你接受之後，才會出現在正式對話列表。**

公開或需審核的社團群，成員進群後頂端固定一條（可在「我知道了」後收合，每次重新開啟群再出現一次）：

- 標題：**這個群有未驗證身分的成員**
- 內文：**請不要在群裡問學號、真名或轉帳資料。未驗證成員看不到別人的學校與真名。**

列表頁未驗證的私訊列，除了名字旁標籤，預覽文字前可加「請求 · 」直到接受。不要在列表露出學號或學校名。

---

## 5. 私訊的防詐騙與防騷擾

現有私訊是成員即可互寫，沒有請求層、沒有每日上限、沒有擋連結。`friendBlocks` 還要校籍，一般帳號用不到。開聊天必須先補下面四層，不能只改畫面。

### 5.1 訊息請求

陌生人送來的第一則（及接受前的後續幾則）進收件匣 **「訊息請求」**，不進正式「私人對話」列表，也不發「你有新訊息」那種容易誤以為已是好友的推播。推播文案用：**「你有一則訊息請求」**。

誰算陌生人：一般帳號寄出的私訊；已驗證寄給一般帳號；跨校已驗證互寄。同一所學校、兩邊都已驗證的校內 DM 維持現況，不進這個匣。

請求期間：

- 發送方可再補文字，但仍算同一則請求，不另開對話。
- 接收方看得到對方平台暱稱、未驗證標示、請求內容。
- 接收方三個動作：**接受**、**婉拒**、**封鎖**。
- 接受：同一份文件改為正式對話，之後的訊息走一般收件匣。
- 婉拒：發送方不再能寫入；接收方列表移除。七天內同一對人不能重送（比照現有好友邀請婉拒後七天內不能刪了再送的精神）。
- 封鎖：等於婉拒加上平台封鎖。
- 接收方沒動作前，發送方看不到已讀，也看不到對方是否在線。

請求還沒接受時，發送方只能附加請求訊息，不能改對方資料、不能傳圖（見 5.4）。

### 5.2 檢舉與封鎖

新增平台級資料，不復用校內 `friendBlocks`，也不把私訊檢舉寫進景點 `schools/{schoolId}/pois/{id}/reports`。

封鎖：

- 集合見第 8 節。一人一筆，只有封鎖者能讀、能解除。
- 封鎖後：對方不能送請求、不能寫已有對話、不能用平台代號搜到你。你這側對話可改為「已封鎖」，內容仍在，但輸入框改為「已封鎖這個人」。
- 兩人若在同一公開社團，封鎖**不會**自動把對方踢出群；群內仍看得到對方依第 6 節規則能發的訊息，但氣泡上的「傳私訊」對封鎖雙方隱藏。要對方離開社團，請幹部踢人。
- 解除封鎖不會自動恢復請求；要對方再送一次。
- 校內 `friendBlocks` 繼續服務校內好友；兩邊任一存在，私訊都要拒絕。Functions 寫入前兩邊都查。

檢舉：

- 對話頁、請求頁、社團訊息都要有「檢舉」。
- 理由固定選項（單選，可附 200 字說明）：垃圾訊息、詐騙或索取轉帳、騷擾、假冒身分、不當內容、其他。
- 私訊檢舉不自動封鎖，但送出後詢問「要不要一併封鎖」。
- 社團訊息的自動隱藏門檻見第 7.4 節。
- 寫入只能本人建立、不能改、不能刪；管理員另以後台讀取。本階段不發明新的公開審核台。

### 5.3 新帳號每天能傳幾則、之後怎麼放寬（私訊）

上限只約束**未驗證**帳號，用 `users/{uid}.createdAt` 算帳號年齡。計數放在伺服器寫的當日配額文件，客戶端不能自己改。日期用 Asia/Taipei。通過任一校驗證後改走已驗證那一列。

「則」= 成功寫入的私訊（含請求裡的文字）。請求次數另外算：一天內對多少個**不同的人**發出第一次請求。社團群則數另計，見第 6.3 節，不跟私訊共用額度，避免進一個公開群就把私訊額度用完。

| 帳號年齡 | 每天可對多少人發出請求 | 每天可傳幾則私訊文字 | 接受後每天可傳幾張圖 |
| --- | ---: | ---: | ---: |
| 未滿 24 小時 | 3 | 10 | 0（請求期本來就不能傳圖） |
| 第 2–7 天 | 5 | 20 | 1 |
| 第 8–30 天 | 8 | 40 | 3 |
| 超過 30 天仍未驗證 | 12 | 80 | 5 |
| 已驗證（任一校 active） | 不另限請求人數（校內 DM 維持現況；對外平台私訊每天最多 30 人） | 200 | 沿用 Storage 20MB／則，不另做張數門檻 |

放寬方式：到了上表的年齡就自動用新上限，不需人工核准。若該帳號當日被檢舉且管理員標為成立，當日剩餘額度歸零，並連續 7 天改用「未滿 24 小時」那一列；7 天內再成立一次檢舉，暫停平台私訊發送 30 天（仍可讀已接受的對話）。

超過上限時，輸入框改為不可送出，文案：**今天送出的訊息已達上限，明天再試。通過學校身分驗證後，上限會放寬。** 不要顯示剩餘則數給可能拿來探測規則的人看。

已驗證學生對一般帳號發送，受「對外平台私訊每天最多 30 人」約束，避免用校內帳號大量掃一般帳號。

### 5.4 未驗證帳號在私訊裡的連結與圖片

請求尚未接受：

- 只能傳純文字，最長仍比照現況 4000 字（Web `sendPrivateMessage`）。
- 內容若含 `http://`、`https://`、`www.` 或明顯網址（含沒有協定的 `example.com/path`），整則拒絕，文案：**未驗證身分在對方接受前不能傳送連結。**
- 不能傳 `type: 'image' | 'file'`，也不能寫 Storage 對話路徑。

對方接受之後、但仍未驗證：

- 連結仍禁止，直到通過學校驗證。文案：**通過學校身分驗證後才能傳送連結。**
- 圖片依 5.3 的每日張數；檔案（非圖）維持禁止。
- 圖片送出前壓成一般相片；未驗證單張最多 2MB。

已驗證：維持現有文字／圖片／檔案與 Storage 規則。

檢查放在 Fly 上的寫入入口。現有 App `appendChatMessage`／`ChatScreen` 客戶端直接寫入，一般帳號這條路要改走 callable，不能沿用。

---

## 6. 未驗證成員進社團群之後的限制

只適用 `joinPolicy` 為 `open` 或 `request` 的社團／活動群。`school_verified` 與班級群裡所有人都已驗證，不套這組限制。

### 6.1 新成員冷靜期

借 Discord High：進群後 **10 分鐘內不能發言、不能傳圖、不能對群成員發私訊**。期間可以讀已有訊息與置頂公告，輸入框文案：**加入後 10 分鐘才能發言，用來減少垃圾訊息。**

冷靜期從該群 `members/{uid}.joinedAt` 起算。被踢後再加入，冷靜期重算。幹部核准申請的那一刻才寫 `joinedAt`。

帳號未滿 24 小時的人，冷靜期改為 **1 小時**（仍可讀）。這是平台規則，幹部不能關。

### 6.2 連結與圖片

未驗證在社團群：

- **不能傳連結**（檢測與私訊相同），直到通過學校驗證。幹部、已驗證成員可以傳。
- 冷靜期內不能傳圖。
- 冷靜期後：未滿 24 小時的帳號每天在**所有公開／需審核社團合計**最多 1 張圖；第 2–7 天每天 3 張；第 8 天起每天 5 張。單張最多 2MB。
- 不能傳檔案（非圖）。
- 已驗證成員維持現況。

### 6.3 每日則數與發言間隔

未驗證在所有公開／需審核社團合計：

| 帳號年齡 | 每天可傳幾則社團文字 | 兩則之間最少間隔 |
| --- | ---: | --- |
| 未滿 24 小時 | 15 | 30 秒（Slowmode） |
| 第 2–7 天 | 40 | 15 秒 |
| 第 8 天起仍未驗證 | 80 | 無額外間隔 |
| 已驗證 | 不另限（班級／僅限同校也不另限） | 無 |

超過時文案與私訊相同，不顯示剩餘則數。幹部對未驗證成員另外禁言時，禁言優先。

### 6.4 能不能看成員名單

現況：`groups/{id}/members` 規則是 active 成員可讀；App 會再去拉名錄的姓名與系所。一開放，未驗證的人就有完整可掃的名單。

| 誰 | 看得到什麼 |
| --- | --- |
| 未驗證成員 | **不能 list** 成員集合。群資訊只顯示人數、幹部暱稱（owner／moderator）。訊息氣泡上看得到發言者暱稱與未驗證標示，不能點進個人檔看學號或學校 |
| 已驗證、但群是公開或需審核 | 可看名單，但每列只有 `publicProfiles` 的暱稱、頭像、`identityStatus`，**沒有**名錄真名、系所、學號、學校 |
| 已驗證、且群是僅限同校或班級 | 維持現況，可用名錄 |
| 該群幹部 | 可看完整管理名單（含 `joinedAt`、禁言狀態、identityStatus），仍不把 `studentId` 傳給客戶端；真名只在僅限同校／班級時從名錄讀 |

### 6.5 能不能從群裡直接私訊別人

| 動作 | 未驗證 | 已驗證 |
| --- | --- | --- |
| 從完整成員名單點「傳訊」 | 沒有名單，所以不行 | 公開／需審核群：走平台私訊請求，不開校內 DM。僅限同校：維持現況 |
| 從某則訊息長按「傳私訊」 | 冷靜期內不行。期滿後可以，一律進對方的訊息請求，且帶未驗證標示 | 可以；若對方是一般帳號，同樣進請求 |
| 幹部私訊申請者 | 不適用 | 可以，走請求 |

群裡不提供「對所有人廣播私訊」或複製 uid 列表。這是 Telegram 隱藏名單要擋的掃人路徑。

---

## 7. 社團管理工具

只有 `canManageGroup`（owner、moderator、以及現有的 admin／instructor 角色）能用。班級群不開放把一般帳號加進來，下列「加入申請」對班級群不存在。

### 7.1 審核加入申請

- 申請存在 `groups/{groupId}/joinRequests/{uid}`，狀態 `pending`／`approved`／`denied`。
- 申請者可寫一句 80 字以內的自我介紹，不得含網址。
- 幹部看到：暱稱、未驗證標示、申請時間、介紹。看不到學號、真名、學校。
- **核准**：寫入 `members`（`status: 'active'`、`role: 'member'`）、更新 `users/{uid}/groups` 鏡像（社團鏡像**不要**再強制用校內 `schoolId` 才能被一般帳號查到，見第 8 節）、申請改 `approved`。
- **拒絕**：申請改 `denied`；七天內同一人不能再申請同一群。
- 公開群沒有申請步驟，但仍寫成員文件，並套冷靜期。
- 被平台封鎖的人不能申請、不能加入公開群。

### 7.2 踢人

- 幹部可把成員改為 `status: 'left'`，註記 `removedBy`、`removedAt`。Owner 不能被踢（現有 `leaveGroup` 已禁止 owner 自己退，踢人也要比照）。
- 被踢的人立刻不能讀群聊、貼文、成員。
- 七天內不能再加入或申請同一群（與好友婉拒冷卻同一精神）。
- 不提供「一鍵清除其歷史訊息」當預設；幹部可逐則刪自己有權刪的訊息（現有作者或幹部可刪貼文／留言）。群聊訊息刪除另走 callable，本階段至少要能刪單則。

### 7.3 禁言

- 幹部設定 `members/{uid}.mutedUntil`（timestamp）。選項：10 分鐘、1 小時、24 小時、7 天。
- 禁言期間可讀、不可寫群聊與貼文。輸入框：**你目前被禁言，直到 {時間}。**
- 未驗證的自動禁言（檢舉門檻觸發）與幹部手動禁言用同一欄位，較晚到期者為準。
- 幹部可提前解除。不能禁言 owner。

### 7.4 檢舉後自動隱藏的門檻

私訊不自動隱藏別人對話裡的內容（那是一對一）。社團群要擋擴散：

| 條件 | 系統做什麼 | 不做什麼 |
| --- | --- | --- |
| 同一則群訊被 **3 個不同成員**檢舉 | 對作者與幹部以外的人隱藏（`hiddenByReports: true`）。作者看到「這則訊息因檢舉而隱藏」。幹部看到原文與檢舉數 | 不自動踢人、不自動封鎖 |
| 同一人在同一群、24 小時內被 **5 個不同成員**檢舉（可跨多則） | 自動禁言 24 小時，並通知幹部 | 不自動改 `joinPolicy`、不解散群 |
| 幹部點「不是問題」 | 取消隱藏與因門檻加上的禁言 | 不刪檢舉紀錄（後台仍看得到） |
| 幹部點「確認違規」 | 維持隱藏，可再踢人 | — |

檢舉人要是該群 active 成員。同一人對同一則只能檢舉一次。未進群的人不能檢舉群訊，避免被外部灌檢舉。

---

## 8. 隱私：學號、真名、學校

未驗證的人（含一般帳號，以及已驗證學生在看一般帳號時）**不能**看到對方的學號、學校核發真名、學校名稱、系所、校內職務、學校 email。**在公開／需審核社團群裡同樣適用**，不能只防私訊。

| 資料 | 現況 | 開聊天與社團之後 |
| --- | --- | --- |
| `users/{uid}` 的 `studentId`、`schoolId`、`email`、`displayName` | 只有本人讀 | 維持。聊天與群組 UI 不得改去讀這份文件來顯示對方 |
| `schools/{schoolId}/directory/{uid}` | 只有該校會員讀；含 `displayName`、`avatarUrl`、`department`、`roleLabel` | 維持。平台私訊與公開／需審核社團改讀 `publicProfiles` |
| `schools/{schoolId}/members/{uid}` | 本人、該校 editor、服務角色 | 維持。不能靠進社團來推論某人是否在籍某一校 |
| `schools/{schoolId}/handles/{handle}` | 該校會員才能 get 單筆 | 維持。平台代號另存 |
| 對話文件上的 `schoolId` | 現在必填 | 平台私訊不寫任一方的 `schoolId`。校內 DM 與班級群聊才有 |
| 社團 `groups/{id}.schoolId` | 建立時必填 | 仍可存在（社團掛在哪一校）。公開目錄若要標校園，只標**社團所屬校園**，不當成員個人學校。成員氣泡禁止再標學校 |

平台對外只露出 `publicProfiles/{uid}`：`nickname`、`avatarUrl`（可空）、`identityStatus`（`unverified` 或 `school_verified`）、`handle`（可空）。沒有學號、沒有 legal name、沒有 schoolId、沒有 email。

已驗證學生的 `nickname` 預設不要用名錄真名。第一次進入平台私訊或公開／需審核社團時，請本人填 2–24 字暱稱；沒填就不能對一般帳號送出，也不能加入公開／需審核社團。僅限同校的班級／社團仍可用名錄姓名。

群聊若把所有 uid 寫進 `conversations.memberIds`，讀對話的人就拿到完整名單。公開社團的群聊**不要**靠 `memberIds` 授權，改看 `groupId` 對應的 active 成員（見 8.1）。

匯出帳號對平台私訊與公開社團改以成員關係為準；匯出檔可含自己的學號，不要把對方的學號、學校寫進去。

---

## 9. 資料怎麼存

canonical 仍是 Firestore 的 app-native 聊天與群組（見 `docs/architecture/firebase-data-boundaries.md`）。敏感檢查（配額、連結、請求、加入審核、封鎖、檢舉門檻）放 Fly 上的既有 Functions 執行環境，不把 Cloud Functions 佈到 Spark 的 `campus-one-tw`。客戶端規則是拒絕越權，不是唯一的業務驗證。

### 9.1 既有集合怎麼改

**`conversations/{conversationId}`**

新增欄位，舊校內文件維持可讀：

| 欄位 | 說明 |
| --- | --- |
| `scope` | `'school'` 或 `'platform'`。舊文件沒有此欄視同 `'school'` |
| `schoolId` | 僅校內 DM／班級群聊必填。平台私訊與公開／需審核社團群聊**禁止**把成員的學校寫在對話上；社團群聊用 `groupId` |
| `type` | 維持 `'dm'` / `'group_chat'` |
| `memberIds` | **僅 DM 使用**（剛好兩人）。社團 `group_chat` 不要再維護全體 memberIds |
| `status` | DM：`'pending_request'` / `'accepted'` / `'declined'` / `'blocked'`。舊校內 DM 視同 `'accepted'` |
| `requestedBy` | 請求發送者 uid；僅 pending 的 DM 需要 |
| `groupId` | 群聊必填，且必須對應真實群組 |
| `hiddenByReports` 等 | 單則訊息欄位，見子集合 |
| `lastMessageText` 等 | 維持現況（預覽截斷、lastReadBy、typingUsers、onlineUsers） |

平台 DM id：`dm_platform_{uidA}_{uidB}`（兩 uid 字典序）。社團群聊 id：`group_{groupId}`。與現有 `dm_{schoolId}_{uidA}_{uidB}` 並列。`deriveDmConversationId` 要加平台版，兩端 Web／App 相同。

建立規則：

- 校內 DM：維持現在的 `schoolId != null && isSchoolMember(schoolId)`，且兩個成員都是該校 active；`status` 只能是 `'accepted'`。
- 平台 DM：已登入即可**經由 callable** 建立；客戶端直接 `create` 拒絕。文件不得含 `schoolId`。初始 `status == 'pending_request'`。
- 班級群聊：`groupId` 指向 `type == 'course'`，讀寫改為 `isActiveGroupMember(groupId)`，且成員必須該校已驗證。
- 社團群聊：讀寫改為 `isActiveGroupMember(groupId)`。`type == 'club'` 且 `joinPolicy` 為 open／request 時，不要求校籍。`memberIds` 可空或只放系統欄位，不能當名單來源。
- `update`：不能改 `scope`、`schoolId`、`groupId`。DM 的 `memberIds` 不能改。pending 時禁止更新 `typingUsers`／`onlineUsers`。

訊息子集合：

- 讀：DM 仍須在 `memberIds`；群聊改為該 `groupId` 的 active 成員。`hiddenByReports == true` 時，只有作者與 `canManageGroup` 能讀原文，其他人讀到占位「這則訊息因檢舉而隱藏」。
- 建立：走 callable 較妥（配額、冷靜期、連結、禁言）。規則層至少擋：未驗證不能寫 image／含網址的文字；`mutedUntil > now` 不能寫；冷靜期內不能寫。
- 既有全域 `messages/{docId}` 維持原規則，新功能不要再往這裡寫。

**`users/{uid}`**

不開放給對方讀。可補本人可寫的 `chatNickname`，對外仍以伺服器同步後的 `publicProfiles` 為準。

**`schools/{schoolId}/directory/{uid}`、`members`、`handles`**

規則不放寬。測試必須包含：一般帳號 get／list 名錄與成員都失敗。

**`friendships` / `friendBlocks`**

不改語意。平台私訊不依賴好友關係。

**`groups/{groupId}`**

新增：

| 欄位 | 說明 |
| --- | --- |
| `joinPolicy` | `'open'` / `'request'` / `'school_verified'`。缺欄視同 `'school_verified'` |
| `linkedEventId` | 可選，活動群才填 |
| `isPublished` | 已有。公開目錄要用 |

讀取：

- active 成員可讀（維持）。
- 已登入且 `type == 'club'` 且 `joinPolicy` 為 `open` 或 `request` 且 `isPublished == true` 時，可讀**主文件**（名稱、簡介、人數、joinPolicy），不能因此讀 `members`、作業、知識庫。
- `type == 'course'` 維持只有成員可讀。

建立：維持要校籍（一般帳號不能開社團）。`type == 'course'` 寫入時強制 `joinPolicy == 'school_verified'`。

更新：`canManageGroup` 可改 `joinPolicy`、`isPublished`、簡介；不能改 `schoolId`、`type`。把班級改成公開必須被規則拒絕。

**`groups/{id}/members/{uid}`**

- `create` 仍對客戶端 `false`，由 callable 寫。
- `read`：`get` 自己的那筆；`list` 僅幹部，或（僅限同校／班級且觀看者已驗證）。公開／需審核群的已驗證成員若要看名單，改走 callable 回傳 `publicProfiles` 投影，不要直接 list 出可拼湊的 uid 再去撞名錄。
- `update`：幹部可改 `status`、`role`（限 moderator／member）、`mutedUntil`。不能改成 owner。本人不能把自己改成幹部。

新增欄位：`mutedUntil`、`removedBy`、`identityStatus`（伺服器在加入時快照，之後驗證狀態以 `publicProfiles` 為準）。

**`users/{uid}/groups/{groupId}` 鏡像**

現況 App 用 `schoolId == 目前學校` 過濾，一般帳號會空。公開／需審核社團的鏡像改為：

- `schoolId` 可空或仍記社團掛載校（給已驗證學生篩自己的校內社團）。
- 另加 `joinPolicy`、`groupType`。
- 一般帳號查「我的群組」改 `status == 'active'`，**不要**再 AND 一個他沒有的 schoolId。

**`joinGroupByCode`**

- `type == 'course'`：維持要該校 active 校籍。
- `joinPolicy == 'school_verified'`：維持要該校校籍。
- `open`／`request`：不要求校籍；`request` 只建申請不建成員。一般帳號呼叫時不必再傳對方的 schoolId 當授權依據（可傳用來對碼，但 Functions 以群文件為準）。

### 9.2 新集合

| 路徑 | 誰讀誰寫 | 欄位 |
| --- | --- | --- |
| `publicProfiles/{uid}` | 已登入可 get 單筆；禁止 list 全庫。寫入僅伺服器 | `nickname`, `avatarUrl`, `identityStatus`, `handle`, `updatedAt` |
| `platformHandles/{handle}` | 已登入可 get 單筆；禁止 list | `uid`, `nickname`, `updatedAt` |
| `userBlocks/{blockerUid}_{blockedUid}` | 只有 blocker 能 get／delete／create；禁止 list | `blockerUid`, `blockedUid`, `createdAt` |
| `messageReports/{reportId}` | 本人 create；之後不能改刪。客戶端 read false | `reporterUid`, `targetUid`, `conversationId`, `groupId?`, `messageId?`, `reason`, `detail`, `createdAt` |
| `users/{uid}/messagingQuota/{yyyy-mm-dd}` | 本人讀；寫入僅伺服器 | `requestsSent`, `messagesSent`, `imagesSent`, `clubMessagesSent`, `clubImagesSent`, `resetAt` |
| `groups/{groupId}/joinRequests/{uid}` | 申請者 create 自己的 pending；get 自己的。幹部 list／update。客戶端不能把別人的改成 approved | `uid`, `status`, `intro`, `createdAt`, `decidedAt?`, `decidedBy?` |
| `publicClubs/{groupId}` | 可選的伺服器投影，方便公開目錄查詢（`joinPolicy`、`name`、`memberCount`、`campusLabel`）。客戶端不能寫 | 不含成員 uid、不含學號 |

`messageRequests` 不另開集合。DM 列表用 `memberIds` array-contains 本人且 `status == 'pending_request'`。

### 9.3 索引

現有 `conversations` 索引是 `schoolId + type + memberIds`（array-contains）`+ updatedAt`。要補：

- `scope` ASC, `status` ASC, `memberIds` CONTAINS, `updatedAt` DESC
- `type` ASC, `memberIds` CONTAINS, `updatedAt` DESC
- `groups`：`type` ASC, `joinPolicy` ASC, `isPublished` ASC, `updatedAt` DESC（公開目錄；若用 `publicClubs` 投影則改投影上的索引）
- `joinRequests`：`status` ASC, `createdAt` DESC（collection group 或子集合）

沒有 READY 的新索引前，不能切正式流量到平台列表或公開社團目錄。

### 9.4 規則會受什麼影響（摘要）

1. 建立對話不再等於「一定是校籍」；群聊授權從 `memberIds` 改為（或並行）`isActiveGroupMember(groupId)`。
2. 新增 `isSchoolVerified()`；班級群與 `school_verified` 社團繼續用它。`open`／`request` 社團用「已登入且為 active 成員」。
3. 平台私訊與社團加入的 create 對客戶端關閉。
4. Storage：群聊附件還要 `status` 不是禁言中、對話／群允許圖片，且未驗證有張數與大小限制。pending 私訊與冷靜期內禁止寫 Storage。
5. `groups/{id}` 對已登入者開放**有限度**讀主文件，但 `members`、作業、知識庫不放寬。
6. `users/{uid}` 繼續不可被對方讀。
7. 刪帳要清 `publicProfiles`、`platformHandles`、自己當 blocker 的 `userBlocks`、自己的 joinRequests；共享群訊仍依現有保留契約。

### 9.5 Functions（Fly）

建議 callable（名稱可在實作時微調）：

- `requestPlatformMessage`、`acceptPlatformMessage`、`declinePlatformMessage`
- `blockUser` / `unblockUser`
- `reportMessage`（私訊與群訊共用，群訊順便計票、達門檻隱藏／禁言）
- `sendPlatformMessage`、`sendGroupMessage`
- `upsertPublicProfile`
- `joinPublicClub` / `requestClubJoin` / `decideClubJoin`
- `kickClubMember` / `muteClubMember`
- `setClubJoinPolicy`
- 既有 `joinGroupByCode`、`leaveGroup`、`createGroup` 依第 9.1 節加分級，不另開平行加入碼 API

不要為了這件事去改 CI 的 `deploy-functions` 條件。

---

## 10. 要補哪些測試

沒有這些測試，不能把規則佈到正式專案。測試通過也不代表已上線。

### 10.1 Firestore／Storage 規則測試

加在 `backend/tests/security-rules.test.js`（現有對話案例與群組案例附近）：

私訊（維持前一版）：

- 一般帳號客戶端 create 校內 DM 或平台 DM 都失敗。
- 一般帳號讀 directory、members、handles list、別人的 `users/{peer}`（含 `studentId`）都失敗。
- 一般帳號 get `publicProfiles` 成功；不能寫入 `studentId`／`schoolId`。
- pending 平台 DM：雙方可讀；接收方客戶端改 status 失敗；未驗證寫 image 或網址失敗。
- accepted 後未驗證仍不能寫 Storage；已驗證可寫。
- `userBlocks`、`messageReports` 的讀寫邊界。
- 舊契約：缺少 schoolId 的校內式 create 仍失敗；非成員讀訊息仍失敗。

社團／班級：

- 一般帳號不能客戶端 `set` `groups/{id}/members/{uid}`。
- `type == 'course'` 即使有人把 `joinPolicy` 改成 `open`，規則拒絕該 update；一般帳號讀班級主文件失敗。
- 缺 `joinPolicy` 的舊社團：一般帳號讀主文件失敗（視同 school_verified）。
- `joinPolicy == 'open'` 且 `isPublished`：已登入可讀主文件；list `members` 失敗；get 自己的 member 成功；get 別人的 member 失敗。
- 未驗證對公開社團群聊：冷靜期內 create 訊息失敗；含 `https://` 失敗；`mutedUntil` 在未來時失敗。
- 幹部可 update `mutedUntil`；一般成員不行。
- 申請：本人可 create 自己的 pending；不能 create 別人的；不能把自己改成 approved。
- Storage：公開社團裡未驗證在冷靜期上傳失敗；已驗證成員成功。
- `joinGroupByCode` 單元測試維持「沒有 active 校籍不能加入 school_verified／course」；另增「open 社團不要求校籍、request 只寫申請」。

`pnpm test:rules` 繼續用隔離專案 `demo-campus-security`。不要為了本文件去改 `ONLINE_ORDERING_ENABLED`。

### 10.2 單元測試

| 檔案 | 要補的行為 |
| --- | --- |
| `apps/web/src/lib/privateMessages.test.ts` | 沒有校籍時平台 session 仍可建立；拒絕平台文件帶 `schoolId` |
| `conversationAccess` 兩端 | 平台 DM id、`group_{id}` 與校內 id 不同 |
| `Messaging.test.tsx` | 未登入文案；未驗證標籤；請求列表；社團橫幅文案 |
| 配額／連結／冷靜期純函式 | 帳號年齡、進群 10 分鐘、網址檢測、檢舉 3／5 門檻 |
| `backend/functions/groupMembership.test.js` | course／school_verified 仍要校籍；open 加入；request 不增加 memberCount |
| `createGroup` 相關測試 | course 強制 school_verified；新建 club 預設 request |
| `userDataExport.test.js` | 公開社團可依成員匯出；不含對方 studentId／schoolId |
| App `GroupMembersScreen` 測試 | 未驗證看不到名單；公開群已驗證列只有暱稱 |

Web `MessagingSession` 要能表達平台模式。校內通知可維持要校籍。`GroupsScreen` 不能再只查 `schoolId == school.id`。

### 10.3 E2E

現有 Maestro `09_messages.yaml` 實際是課程加入碼，不要把一般帳號塞進去。另增：

1. `09_platform_message_request.yaml`：私訊請求、擋連結、接受、橫幅、封鎖（前一版範圍）。
2. `10_public_club_join.yaml`：一般帳號在公開目錄看到需審核社團 → 申請 → 幹部核准 → 冷靜期內不能發言 → 期滿可發言、不能傳連結、看不到成員名單、從氣泡送出的私訊進請求匣。班級加入碼以一般帳號操作必須失敗。

正式環境不跑這些 E2E 寫入。測試帳號限模擬器。不要求改 Maestro workflow 的觸發條件。

---

## 11. 分階段上線

每一階段寫清「什麼情況可以進下一階段」與「什麼情況退回」。退回以規則與 callable 關閉發送／加入為主。本文件的提交不啟動任何階段。**任何階段都不把班級群開放給一般帳號。**

### 階段 0 — 僅文件（本次）

- 做：本設計（含社團分級）。
- 不做：改規則、改 CI、部署、寫正式資料、開環境變數。
- 可進入階段 1：實作時仍以本文件與當時程式為準，有出入先改文件。
- 退回：不適用。

### 階段 1 — 規則、索引、測試、callable，不開使用者入口

- 做：第 9、10 節。畫面仍維持沒有校籍就開不了聊天、加不進群。
- 可進入階段 2：`pnpm test:rules` 與相關單元測試全綠；新索引 READY；模擬器走完私訊請求與「open／request／course」三種加入。
- 退回：一般帳號能讀 directory／`studentId`，或能 list 公開社團成員。退回動作：不合併規則；若誤佈，回到「建立對話與加入群組必須校籍」。

### 階段 2 — 內部帳號看得到畫面

- 做：未驗證標示、訊息請求、社團申請／核准、冷靜期、禁言、檢舉隱藏。callable 只允許內部測試 UID。
- 可進入階段 3：內部走完第 10.3 節兩條流程；沒有學號或真名畫在公開群；沒有改到 `ci.yml` deploy 條件。
- 退回：洩漏名錄真名／學號／個人學校，或客戶端能略過申請直接寫 members。退回動作：關閉測試 UID，入口改回階段 1。

### 階段 3 — 小範圍公開：私訊 + 需審核社團，不開「公開立刻加入」

- 做：拿掉測試 UID 清單。未驗證私訊用最嚴配額（每天 3 人／10 則／不能傳圖）。幹部可把**新**社團設成 `request` 讓一般帳號申請；既有沒改設定的社團仍是僅限同校。`open` 對正式使用者先關閉（選了也當成 request），直到階段 4。
- 可進入階段 4：連續 7 天，成立檢舉低於平台私訊＋公開社團則數的 1%；沒有未驗證讀到學號／真名／個人學校；沒有班級群被一般帳號加入。
- 退回：詐騙轉帳、大量垃圾申請、隱私事故、或班級群被加進去。退回動作：未驗證改為只能讀已加入的群、不能新申請、不能新私訊請求；`setClubJoinPolicy` 拒絕改成 open／request。

### 階段 4 — 開放「公開立刻加入」，並依帳號年齡放寬配額

- 做：允許 `joinPolicy == 'open'`；啟用私訊與社團的年齡表；接受後／冷靜期後允許有限張數圖片。未驗證連結仍禁止。
- 可維持：再觀察 14 天，成立檢舉仍低於 1%，且沒有未驗證傳連結成功、沒有從名單被掃去群發私訊。
- 退回：公開加入後濫用明顯上升。退回動作：全體 `open` 在伺服器改按 `request` 執行（已在群裡的人可留）；圖片改回 0；必要時停未驗證發言、只留閱讀。不因此關閉已驗證校內 DM 與班級群。

---

## 12. 還需要顧晉瑋決定的問題

最多五題。沒拍板前，實作先用「建議」欄。

1. **已經在運作的舊社團，要不要一上線就讓一般帳號申請？**  
   建議：不要。沒有 `joinPolicy` 的一律當僅限同校，幹部自己改成需審核或公開才對外。避免資管學會這種原本的校內群突然湧進校外帳號。

2. **公開社團目錄要不要寫「這是哪一校的社團」？**  
   建議：可以寫社團掛載的校園名稱（例如「靜宜大學」），因為那是社團屬性，不是某個人的學籍。成員氣泡與名單仍禁止出現個人學校、真名、學號。

3. **未驗證的人能不能從群內某則訊息對已驗證學生發私訊？**  
   建議：冷靜期結束後可以，但一律進訊息請求，且對方看到未驗證標示。不能從完整名單點人（名單不給看）。

4. **檢舉幾次要自動隱藏、幾次要自動禁言？**  
   建議：同一則被 3 個不同成員檢舉就對其他人隱藏；同一人 24 小時內在同群被 5 人檢舉則禁言 24 小時。不自動踢人，留給幹部決定。

5. **讀書會（`groups.type == 'study'`）要不要跟社團同一套分級？**  
   建議：同一套欄位可以設定，但預設維持僅限同校。讀書會常有課業討論，不應當成公開社團。活動群（掛 `linkedEventId` 的 club）才跟公開社團走同一預設（新建＝需審核）。

---

## 13. 這次與後續都不做的事

- 不改正式 Firestore 資料、不跑 seed 對正式專案、不部署規則或網頁。
- 不修改 `.github/workflows/ci.yml` 的 `deploy-functions`（目前僅 `main` 且 `workflow_dispatch` 才跑）。
- 不新增或設定 `ONLINE_ORDERING_ENABLED`、`NEXT_PUBLIC_ONLINE_ORDERING`。
- 不讓一般帳號讀課表名單、成績、點名、校內好友、校內代號、班級群。
- 不把活動報名名單自動變成聊天成員。
- 不把 Nuni 的貼文檢舉 API 直接拿來當私訊／群訊檢舉。
- 不在本階段做未驗證傳檔案、語音，或已讀回執給未接受的私訊請求。

---

## 14. 實作時會動到的主要檔案（預覽，本次未改）

- `backend/firestore/firestore.rules`、`firestore.indexes.json`
- `backend/storage/storage.rules`
- `backend/tests/security-rules.test.js`
- `backend/functions/groupMembership.js`、`index.js` 的 `createGroup`
- `apps/web/src/lib/privateMessages.ts`、`conversationAccess.ts`、`components/messaging/Messaging.tsx`、`app/groups/groupService.ts`
- `apps/mobile/src/utils/conversationAccess.ts`、`screens/ChatScreen.tsx`、`screens/DmsScreen.tsx`、`screens/GroupsScreen.tsx`、`screens/GroupMembersScreen.tsx`、`data/firebaseSource.ts`、`services/messaging.ts`
- Fly 上的 Functions 寫入入口（`docs/deploy/functions-on-fly.md`）

對照：`docs/research/screenshot-import.md` 仍寫「找同學要學校帳號」。本設計開放**平台私訊**與**幹部設為公開／需審核的社團**，不開放校內找同學、空堂邀約或班級名單。那份文件在實作階段 2 前應加一句互參。
