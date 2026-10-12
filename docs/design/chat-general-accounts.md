# 一般帳號開放聊天（含私訊）

2026-10-12。顧晉瑋決定：只用 Google、Apple 或 Email 登入、沒綁學校的一般帳號，也可以用聊天，包括私訊。這份只寫設計，**不改正式站資料、不部署、不改 `.github/workflows/ci.yml` 的 deploy 條件，也不設定 `ONLINE_ORDERING_ENABLED` 或 `NEXT_PUBLIC_ONLINE_ORDERING`**。後續實作另開工作，本文不是上線授權。

---

## 1. 為什麼要改、現在卡在哪

目前聊天整條鏈都假設「已登入、而且是該校在籍會員」。一般帳號能看公車、公告、餐廳等公開功能，一進對話就被擋下來。

對得上程式的現況：

| 位置 | 現況 | 對一般帳號的後果 |
| --- | --- | --- |
| `backend/firestore/firestore.rules` 的 `conversations` | 建立時必須 `schoolId != null`，且 `isSchoolMember(schoolId)`（`schools/{schoolId}/members/{uid}.status == 'active'`） | 沒有校籍不能建對話 |
| 同一段規則的讀取／寫訊息 | 只要 `request.auth.uid` 在 `memberIds` 即可 | 若被寫進成員名單就能讀；問題在進不去 |
| Web `apps/web/src/lib/privateMessages.ts` | `watchMessagingSession` 要求 `users/{uid}.schoolId` 存在，且該校 `members/{uid}.status == 'active'` 才給 session | 沒綁學校連收件匣都開不成 |
| Web `Messaging.tsx` | 未登入文案是「登入學校帳號後，就能查看你的對話與通知。」列表寫「最近更新的 100 個**校內**對話」 | 產品語言把聊天等同學校帳號 |
| 對方名字 | Web 讀 `schools/{schoolId}/directory/{uid}`；App `ChatScreen` / `DmsScreen` 走 `fetchSchoolDirectoryProfiles`。directory 規則只給校籍會員讀 | 一般帳號讀不到校內名錄；校內名錄也不該給未驗證的人看 |
| DM 文件 id | `deriveDmConversationId(schoolId, a, b)` → `dm_{schoolId}_{uidA}_{uidB}`（兩端相同） | 沒有 schoolId 就沒有穩定 id |
| App `firebaseSource.createConversation` | 沒有 `schoolId` 直接丟「缺少 schoolId，無法建立對話」 | 一般帳號建不了私訊或群聊 |
| `friendships` / `friendBlocks` / 找人代號 | 建立與讀取都要 `isSchoolMember` | 不能靠現有好友、封鎖、校內代號來找一般帳號 |
| 群組 | 建立群組要校籍；`joinGroupByCode` 在交易裡檢查該校 `members` 為 `active`；成員文件不能由客戶端建立 | 一般帳號加不進班級群或社團群 |
| 附件 | Storage `conversations/{id}/messages/...` 與 `.../media/...` 只要是對話成員就能上傳（圖／檔上限 20MB） | 一旦進得去，未驗證帳號也能傳圖 |
| 配額、訊息請求、平台級封鎖／檢舉 | 沒有這些集合。現有 `friendBlocks` 綁學校；POI `reports` 是景點檢舉；Nuni 社群檢舉走另一套貼文 API | 陌生人私訊沒有緩衝層 |

「已驗證身分」在本文件的意思，跟現有授權一致：該 Firebase UID 在至少一所學校的 `schools/{schoolId}/members/{uid}.status == 'active'`。Nuni 學校資格若是 `pending`、`rejected`、`revoked`，或根本沒申請，都還是一般帳號。驗證成功是在**既有平台帳號上加上學校保證**，不另開聊天身分。

「一般帳號」：已用 Google、Apple 或 Email 登入平台，但沒有任何一校的 active 校籍。沒登入的人仍然不能聊天。Apple／Email 目前不是完整產品入口（平台登入以 Google 為主）；權限表不為它們另寫一套，只要還沒通過學校核對，都算一般帳號。

`users/{uid}` 只有本人能讀，裡面可有 `displayName`、`studentId`、`schoolId`、`email`。校內名錄另有 `department`、`roleLabel`。這些都不能因為開了聊天，就讓未驗證的人看見。

---

## 2. 誰可以傳給誰

原則：一般帳號只走**平台私訊**。班級群、社團群、校內好友與校內名錄維持校籍。陌生人（含一般帳號）的第一則私訊先進對方的「訊息請求」，接受後才變成正式對話。

### 2.1 私訊

| 發送方 | 接收方 | 可不可以 | 怎麼進對話 |
| --- | --- | --- | --- |
| 一般帳號 | 已驗證學生（任一校） | 可以 | 對方「訊息請求」。接受後才是正式對話 |
| 已驗證學生 | 一般帳號 | 可以 | 一般帳號的「訊息請求」。學生端仍看到未驗證標示 |
| 一般帳號 | 一般帳號 | 可以 | 雙方都走訊息請求 |
| 已驗證學生 | 同一所學校、已驗證的學生 | 可以，維持現況 | 沿用 `dm_{schoolId}_…`，不強制再走請求（彼此已能從校內名錄／好友／代號找到） |
| 已驗證學生 | 另一所學校、已驗證的學生 | 可以 | 視為陌生人，走平台私訊與訊息請求，不共用任一方的校內名錄 |
| 未登入 | 任何人 | 不行 | 維持現況 |

補充：

- 被封鎖的人不能再送請求，也不能寫入已存在的對話。平台封鎖見第 4 節，與現有校內 `friendBlocks` 分開。
- 兩人只會有一份平台私訊文件。先送請求的人寫入；對方接受後同一份文件改成正式對話，不另開 id。
- 同一所學校的兩名已驗證學生，繼續用現有校內 DM，避免把舊對話拆成兩份。
- 學生與一般帳號之間**不用**校內 DM id。即使該學生之後換學校、或一般帳號後來通過驗證，這份平台對話仍在；通過驗證不自動把舊訊息搬進校內 DM。

誰可以「找到」對方來傳第一則：

- 一般帳號不能查 `schools/{schoolId}/directory`、`schools/{schoolId}/handles`、學號、課程名單。
- 一般帳號可用自己設定的**平台聊天代號**（不是校內 handles）被找到，或從對方分享的個人聊天連結進入。
- 已驗證學生可從校內名錄找同學（維持現況）；要找一般帳號，只能用對方給的平台代號或連結，不能用學號反查。
- 店面留言、公開貼文若之後要加「傳訊」入口，只能開平台私訊請求，不能把作者的學號、學校、真名帶過去。

### 2.2 班級群

對應現有 `groups.type == 'course'`（課群、班級）。成員來自校務名單、教師加入，或 `joinGroupByCode`；後者已強制該校 active 校籍。群組文件的讀取是 `isActiveGroupMember`；成員子文件不能由客戶端建立。

| 規則 | 說明 |
| --- | --- |
| 誰進得去 | 該班／該課的 active 成員，且本身是該校已驗證身分 |
| 一般帳號 | 不能加入、不能被加進 `groups/{id}/members`、不能出現在 `group_chat` 的 `memberIds` |
| 聊天內容 | 只有 active 成員能讀寫。作業、點名、成績、名單仍走原契約，不因私訊開放而露出 |
| 老師／助教想聯絡校外的人 | 用平台私訊，不要把對方拉進班級群 |
| 一般帳號之後通過驗證 | 驗證加上課籍之後，才能用既有加入流程進班；舊的平台私訊不會變成班級群紀錄 |

班級群維持校內，是因為它綁課表、作業與名單。開放一般帳號會讓未驗證的人看到同學與課程脈絡。

### 2.3 社團群組

對應現有 `groups.type == 'club'`（以及同樣走加入碼的 `study`）。建立群組與加入碼目前都要校籍；社團群不是公開聊天室。

| 規則 | 說明 |
| --- | --- |
| 誰進得去 | 該社團的 active 成員，且本身是該校已驗證身分 |
| 一般帳號 | 不能進社團群、不能看成員名單、不能看群內訊息與貼文 |
| 幹部聯絡還沒驗證的人 | 用平台私訊（訊息請求）。招收說明可以傳，社團內部討論不行 |
| 通過驗證之後 | 用既有加入碼／幹部審核進社，才能進社團群 |
| 與班級群的差別 | 班級群連「邀請校外」都不開放；社團群允許幹部用**私訊**對外說明，但群本身仍只給社員 |

`group_chat` 若綁定某個 `groups/{groupId}`，所有 `memberIds` 都必須是該群 active 成員。規則與 Functions 都要擋「把一般帳號寫進群聊成員」。

---

## 3. 畫面怎麼標出「未驗證身分」

只要對話裡有任何一方不是已驗證身分，就要標。已驗證對已驗證的校內對話，不顯示這組標示。色票跟 `docs/design/design-system.md`：紙白底、次要文字 `--muted`／`theme.colors.muted`，警示用語意提醒色，不能只靠顏色、也不另做紫色標籤。

無障礙名稱必須包含「未驗證身分」，不能只剩圖示。

### 3.1 頭像

現況：Web 列表用名字第一個字當圓形字頭（`Messaging.tsx` 的 `styles.avatar`）；App 對話頂端目前主要是文字標題，列表同樣靠名錄的 `displayName`／`avatarUrl`。

未驗證時：

- 圓形頭像仍只顯示**平台暱稱**的第一個字，或本人上傳的平台頭像。
- 右下疊一枚約 16px 的灰底圓章，圖示用問號或「未驗證」盾牌（`Ionicons` 的 `shield-outline` 可接受）。
- 圓章對螢幕閱讀器的名稱：「未驗證身分」。
- 沒有平台頭像時不要去讀校內名錄或 Google 大頭照裡可能帶出的真名。
- 已驗證且這場是校內對話：維持現況，不加這枚圓章。已驗證學生在**平台私訊**裡對外也只顯示平台暱稱頭像，避免校內證件照流到未驗證的人。

### 3.2 名字旁

出現位置：對話列表的標題列、訊息氣泡上方的發送者名稱（App `ChatScreen` 已有 `senderName`）、Web 對話標題。

- 暱稱後面緊接一枚文字標籤，文案固定為 **「未驗證身分」**。
- 標籤樣式：次要文字、細框，不要做成「訪客」或「校外人士」（那會讓人以為是學校核發的校外身分）。
- 已驗證學生在平台私訊的顯示名是平台暱稱，**名字旁不寫學校、系所、學號、職稱**。校內對話仍可用名錄的 `displayName`／`roleLabel`。
- 自己看自己：設定頁可寫「其他人會看到：未驗證身分」。聊天氣泡裡自己的訊息不必每則都標。

### 3.3 對話頂端

現況：App `ChatScreen` 用 `headerTitle` 顯示對方名字與「正在輸入⋯」／「在線」；Web 對話頁是 `<h2>` 對方名字。App 已有引用貼文橫幅 `refBanner`，未驗證橫幅可放在同一層、搜尋列下方。

對方是未驗證時，對話頁頂端固定一條橫幅（不可滑掉，直到對方通過驗證）：

- 標題：**對方尚未通過學校身分驗證**
- 內文：**這不是學校核對過的帳號。請不要提供學號、證件、密碼或轉帳資料。**
- 橫幅右側次要動作：「檢舉」與「封鎖」，見第 4 節。
- 自己是未驗證、對方已驗證時，改顯示：**你的帳號尚未通過學校身分驗證。對方會看到未驗證標示。通過驗證後，才能加入班級群與社團群組。**
- 雙方都未驗證：用第一條（對方未驗證）為主；自己的狀態在設定頁說明即可。
- 訊息請求尚未接受前，頂端加上：**這是訊息請求。你接受之後，才會出現在正式對話列表。**

列表頁（App `DmsScreen`、Web `/dms`）未驗證的列，除了名字旁標籤，預覽文字前可加「請求 · 」直到接受。不要在列表露出學號或學校名。

---

## 4. 防詐騙與防騷擾

現有私訊是成員即可互寫，沒有請求層、沒有每日上限、沒有擋連結。`friendBlocks` 還要校籍，一般帳號用不到。開聊天必須先補下面四層，不能只改畫面。

### 4.1 訊息請求

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

請求還沒接受時，接收方不必為了看內容而先成為「正式成員可互寫」；規則上發送方只能 append 請求訊息，不能改對方資料、不能傳圖（見 4.4）。

### 4.2 檢舉與封鎖

新增平台級資料，不復用校內 `friendBlocks`，也不把私訊檢舉寫進景點 `schools/{schoolId}/pois/{id}/reports`。

封鎖：

- 集合見第 6 節。一人一筆，只有封鎖者能讀、能解除。
- 封鎖後：對方不能送請求、不能寫已有對話、不能用平台代號搜到你。你這側對話可改為「已封鎖」，內容仍在，但輸入框改為「已封鎖這個人」。
- 解除封鎖不會自動恢復請求；要對方再送一次。
- 校內 `friendBlocks` 繼續服務校內好友；兩邊任一存在，私訊都要拒絕。Functions 寫入前兩邊都查。

檢舉：

- 對話頁與請求頁都要有「檢舉」。
- 理由固定選項（單選，可附 200 字說明）：垃圾訊息、詐騙或索取轉帳、騷擾、假冒身分、不當內容、其他。
- 檢舉不自動封鎖，但送出後詢問「要不要一併封鎖」。
- 寫入只能本人建立、不能改、不能刪；管理員另以後台讀取。本階段不發明新的公開審核台。

### 4.3 新帳號每天能傳幾則、之後怎麼放寬

上限只約束**未驗證**帳號，用 `users/{uid}.createdAt` 算帳號年齡。計數放在伺服器寫的當日配額文件，客戶端不能自己改。日期用 Asia/Taipei。通過任一校驗證後改走已驗證那一列，舊的未驗證上限不再適用。

「則」= 成功寫入的訊息（含請求裡的文字）。請求次數另外算：一天內對多少個**不同的人**發出第一次請求。

| 帳號年齡 | 每天可對多少人發出請求 | 每天可傳幾則文字 | 接受後每天可傳幾張圖 |
| --- | ---: | ---: | ---: |
| 未滿 24 小時 | 3 | 10 | 0（請求期本來就不能傳圖） |
| 第 2–7 天 | 5 | 20 | 1 |
| 第 8–30 天 | 8 | 40 | 3 |
| 超過 30 天仍未驗證 | 12 | 80 | 5 |
| 已驗證（任一校 active） | 不另限請求人數（校內 DM 維持現況；對外平台私訊每天最多 30 人） | 200 | 沿用 Storage 20MB／則，不另做張數門檻 |

放寬方式：到了上表的年齡就自動用新上限，不需人工核准。若該帳號當日被檢舉且管理員標為成立，當日剩餘額度歸零，並連續 7 天改用「未滿 24 小時」那一列；7 天內再成立一次檢舉，暫停平台私訊發送 30 天（仍可讀已接受的對話）。

超過上限時，輸入框改為不可送出，文案：**今天送出的訊息已達上限，明天再試。通過學校身分驗證後，上限會放寬。** 不要顯示剩餘則數給可能拿來探測規則的人看。

已驗證學生對一般帳號發送，受「對外平台私訊每天最多 30 人」約束，避免用校內帳號大量掃一般帳號。

### 4.4 未驗證帳號的連結與圖片

請求尚未接受：

- 只能傳純文字，最長仍比照現況 4000 字（Web `sendPrivateMessage`）。
- 內容若含 `http://`、`https://`、`www.` 或明顯網址（含沒有協定的 `example.com/path`），整則拒絕，文案：**未驗證身分在對方接受前不能傳送連結。**
- 不能傳 `type: 'image' | 'file'`，也不能寫 Storage 對話路徑。

對方接受之後、但仍未驗證：

- 連結仍禁止，直到通過學校驗證。文案：**通過學校身分驗證後才能傳送連結。**
- 圖片依 4.3 的每日張數；檔案（非圖）維持禁止。
- 圖片送出前壓成一般相片，不用對話 20MB 上限當未驗證的實際上限；未驗證單張最多 2MB。

已驗證：維持現有文字／圖片／檔案與 Storage 規則。

檢查放在 Fly 上的寫入入口（見第 6 節），規則再擋客戶端直接 `set` 帶連結或 `type: 'image'` 的未驗證訊息。現有 App `appendChatMessage`／`ChatScreen` 客戶端直接寫入，一般帳號這條路要改走 callable，不能沿用。

---

## 5. 隱私：學號、真名、學校

未驗證的人（含一般帳號，以及已驗證學生在看一般帳號時）**不能**看到對方的學號、學校核發真名、學校名稱、系所、校內職務、學校 email。

| 資料 | 現況 | 開聊天之後 |
| --- | --- | --- |
| `users/{uid}` 的 `studentId`、`schoolId`、`email`、`displayName` | 只有本人讀 | 維持。聊天UI不得改去讀這份文件來顯示對方 |
| `schools/{schoolId}/directory/{uid}` | 只有該校會員讀；含 `displayName`、`avatarUrl`、`department`、`roleLabel` | 維持。平台私訊改讀 `publicProfiles` |
| `schools/{schoolId}/members/{uid}` | 本人、該校 editor、服務角色 | 維持。一般帳號不能靠聊天推論對方是否在籍某一校 |
| `schools/{schoolId}/handles/{handle}` | 該校會員才能 get 單筆 | 維持。平台代號另存，見第 6 節 |
| 對話文件上的 `schoolId` | 現在必填 | 平台私訊不寫任一方的 `schoolId`。校內 DM 才有 |

平台對外只露出 `publicProfiles/{uid}`：`nickname`、`avatarUrl`（可空）、`identityStatus`（`unverified` 或 `school_verified`）、`handle`（可空）。沒有學號、沒有 legal name、沒有 schoolId、沒有 email。

已驗證學生的 `nickname` 預設不要用名錄真名。第一次進入平台私訊時，請本人填 2–24 字暱稱；沒填就不能對一般帳號送出。校內對話仍可用名錄姓名。

對話與請求的預覽、推播、搜尋索引都只能用暱稱與訊息摘要，不能把學號或校名拼進去。匯出帳號（既有 `userDataExport` 已按成員與學校過濾 conversations）對平台私訊改以 `memberIds` 為準，匯出檔可含自己的學號，但不要把對方的學號、學校寫進去。

---

## 6. 資料怎麼存

canonical 仍是 Firestore 的 app-native 聊天（見 `docs/architecture/firebase-data-boundaries.md`）。敏感檢查（配額、連結、請求接受、封鎖）放 Fly 上的既有 Functions 執行環境，不把 Cloud Functions 佈到 Spark 的 `campus-one-tw`。客戶端規則是拒絕越權，不是唯一的業務驗證。

### 6.1 既有集合怎麼改

**`conversations/{conversationId}`**

新增欄位，舊校內文件維持可讀：

| 欄位 | 說明 |
| --- | --- |
| `scope` | `'school'` 或 `'platform'`。舊文件沒有此欄視同 `'school'` |
| `schoolId` | 僅 `scope == 'school'` 必填。平台私訊**禁止**此欄 |
| `type` | 維持 `'dm'` / `'group_chat'` |
| `memberIds` | 維持；DM 必須剛好兩人 |
| `status` | `'pending_request'` / `'accepted'` / `'declined'` / `'blocked'`。舊校內 DM 視同 `'accepted'` |
| `requestedBy` | 請求發送者 uid；僅 pending 需要 |
| `groupId` | 僅群聊可填，且必須對應真實群組 |
| `lastMessageText` 等 | 維持現況（預覽截斷、lastReadBy、typingUsers、onlineUsers） |

平台 DM id：`dm_platform_{uidA}_{uidB}`（兩 uid 字典序）。與現有 `dm_{schoolId}_{uidA}_{uidB}` 並列，不要混用。`deriveDmConversationId` 要加平台版，兩端 Web／App 相同。

建立規則（取代「一定要校籍」）：

- `scope == 'school'`：維持現在的 `schoolId != null && isSchoolMember(schoolId)`，且兩個成員都是該校 active；`status` 只能是 `'accepted'`。
- `scope == 'platform'`：已登入即可**經由 callable** 建立；客戶端直接 `create` 拒絕。文件不得含 `schoolId`。初始 `status == 'pending_request'`，`requestedBy == request.auth.uid`。
- 群聊：維持只能由校籍、且 `groupId` 指向該人為 active 的群。一般帳號不能出現在 `memberIds`。
- `update`：成員不能改 `memberIds`、`scope`、`schoolId`、`groupId`。`status` 從 pending → accepted／declined／blocked 只允許接收方經 callable。pending 時禁止更新 `typingUsers`／`onlineUsers`（避免請求期就露出在線）。

訊息子集合 `conversations/{id}/messages/{messageId}`：

- 讀：仍須在 `memberIds`。pending 時雙方可讀請求內容。
- 建立：`senderId == request.auth.uid` 且在成員中。pending 時只允許 `type == 'text'`，且內容不得通過網址檢查。未驗證發送者的 `type` 不得為 image／file。
- 既有全域 `messages/{docId}`（用 `conversationId` 欄位）維持原規則，但新功能不要再往這裡寫；正式路徑是巢狀子集合（Web 已走這條）。

**`users/{uid}`**

不開放給對方讀。可補本人可寫的 `chatNickname`（2–24 字），但對外顯示仍以伺服器同步後的 `publicProfiles` 為準，避免客戶端寫一份、畫面上又讀另一份。

**`schools/{schoolId}/directory/{uid}`、`members`、`handles`**

規則不放寬。測試必須包含：一般帳號 get／list 名錄與成員都失敗。

**`friendships` / `friendBlocks`**

不改語意。平台私訊不依賴好友關係。

**`groups` 與 `joinGroupByCode`**

不為一般帳號放寬。現有測試（加入碼要 active 校籍）繼續當回歸。

### 6.2 新集合

| 路徑 | 誰讀誰寫 | 欄位 |
| --- | --- | --- |
| `publicProfiles/{uid}` | 已登入可 get 單筆；禁止 list 全庫。建立／更新由伺服器依本人暱稱與驗證狀態寫入 | `nickname`, `avatarUrl`, `identityStatus`, `handle`, `updatedAt` |
| `platformHandles/{handle}` | 已登入可 get 單筆完整代號；禁止 list。寫入僅本人且代號格式與校內 handles 相同量級（3–32，`[a-z0-9_.-]`），但存在不同集合，避免跟校內代號撞名時洩漏學校 | `uid`, `nickname`, `updatedAt` |
| `userBlocks/{blockerUid}_{blockedUid}` | 只有 `blockerUid == request.auth.uid` 能 get／delete／create；禁止 list。不需要 schoolId | `blockerUid`, `blockedUid`, `createdAt` |
| `messageReports/{reportId}` | 建立者可 create（`reporterUid == auth.uid`）；之後不能改刪。讀取僅管理員後台（本階段規則 `read: if false` 給客戶端，後台用 Admin SDK） | `reporterUid`, `targetUid`, `conversationId`, `messageId?`, `reason`, `detail`, `createdAt` |
| `users/{uid}/messagingQuota/{yyyy-mm-dd}` | 只有本人讀；寫入僅伺服器 | `requestsSent`, `messagesSent`, `imagesSent`, `resetAt` |

`messageRequests` 不另開集合，避免與 `conversations` 雙寫。列表用查詢：`memberIds` array-contains 本人，且 `status == 'pending_request'`。正式列表則 `status == 'accepted'`。

### 6.3 索引

現有 `conversations` 索引是 `schoolId + type + memberIds`（array-contains）`+ updatedAt`。平台私訊沒有 `schoolId`，要補：

- `scope` ASC, `status` ASC, `memberIds` CONTAINS, `updatedAt` DESC
- `type` ASC, `memberIds` CONTAINS, `updatedAt` DESC（給不篩 schoolId 的平台列表）

沒有 READY 的新索引前，不能切正式流量到平台列表查詢。

### 6.4 規則會受什麼影響（摘要）

1. `isConversationMember` 仍以 `memberIds` 為準，但建立對話不再等於「一定是校籍」。
2. 必須新增例如 `isSchoolVerified()`（任一校或指定校的 active members），供群聊、校內 DM、名錄沿用。
3. 平台私訊的 create 對客戶端關閉，避免略過配額與請求狀態。
4. Storage：`conversationMember` 之外，寫入 `messages/...` 與 `media/...` 還要對話 `status == 'accepted'`，且未驗證使用者禁止寫入這兩條路徑。
5. `users/{uid}` 繼續不可被對方讀；不能為了聊天把個人檔案改成公開。
6. 刪帳流程（`accountDeletion`）要一併清 `publicProfiles`、`platformHandles`、`userBlocks` 自己當 blocker 的文件；共享訊息仍依現有「明確保留共享訊息」契約，不在本設計放寬或收緊。

### 6.5 Functions（Fly）

建議 callable（名稱可在實作時微調，但職責固定）：

- `requestPlatformMessage`：建立或附加 pending 對話。檢查封鎖、婉拒冷卻、配額、連結、身分。
- `acceptPlatformMessage` / `declinePlatformMessage`
- `blockUser` / `unblockUser`
- `reportMessage`
- `sendPlatformMessage`：accepted 之後未驗證者的文字／有限圖片
- `upsertPublicProfile`：暱稱與平台代號

校內已驗證互傳可暫時沿用客戶端寫入（現況），但新的平台路徑一律 callable。不要為了這件事去改 CI 的 `deploy-functions` 條件。

---

## 7. 要補哪些測試

沒有這些測試，不能把規則佈到正式專案。測試通過也不代表已上線。

### 7.1 Firestore／Storage 規則測試

加在 `backend/tests/security-rules.test.js`（現有對話案例約在「deny message reads for users outside the conversation」「deny conversation creation when schoolId is missing」「allow conversation members to update nested message readBy only」附近）：

- 一般帳號（已登入、沒有任何 `schools/*/members` active）客戶端 create 校內 DM 或平台 DM 都失敗。
- 一般帳號讀 `schools/{schoolId}/directory/{uid}`、`members/{uid}`、名錄 list、handles list 都失敗。
- 一般帳號讀別人的 `users/{peer}` 失敗，含 `studentId`。
- 一般帳號 get 自己與對方的 `publicProfiles` 成功；文件若被誤寫 `studentId`／`schoolId`，客戶端也不可寫入這些欄位。
- Admin 預置一份 `scope: platform`, `status: pending_request` 的對話：雙方可讀訊息；接收方客戶端直接把 `status` 改成 accepted 失敗；未驗證發送方寫 `type: 'image'` 失敗；含 `https://` 的文字失敗。
- 同一份對話改為 accepted 後：雙方可寫文字；未驗證仍不能寫 Storage 對話路徑；已驗證可寫。
- 一般帳號不能 `set` `groups/{id}/members/{uid}`，也不能被已驗證學生用客戶端加進去。
- `userBlocks`：只能 blocker 讀自己的那筆；被封鎖者讀失敗；第三人讀失敗。
- `messageReports`：客戶端讀失敗；非本人的 reporterUid 建立失敗。
- 舊契約回歸：缺少 `schoolId` 的校內式 create 仍失敗；非成員讀巢狀訊息仍失敗；成員只能改 `readBy`。
- Storage：pending 對話上傳失敗；accepted 但未驗證上傳失敗；accepted 且已驗證維持成功。

`pnpm test:rules` 繼續用隔離專案 `demo-campus-security`。不要為了本文件去改 `ONLINE_ORDERING_ENABLED`。

### 7.2 單元測試

| 檔案 | 要補的行為 |
| --- | --- |
| `apps/web/src/lib/privateMessages.test.ts` | 沒有 `schoolId`／沒有校籍時，平台 session 仍可建立；校內列表與平台列表分開；`parseConversation` 拒絕把 `scope: platform` 的文件當成校內 DM，也拒絕平台文件帶 `schoolId` |
| `apps/web/src/lib/conversationAccess.test.ts` 與 App 對應檔 | `derivePlatformDmConversationId` 與校內 id 不同；同一對人雙向相同 |
| `apps/web/src/components/messaging/Messaging.test.tsx` | 未登入文案不再寫死「登入學校帳號」才能看平台請求；未驗證標籤與頂端橫幅文案；請求列表與正式列表分開 |
| App 聊天／列表測試 | 頭像圓章無障礙名稱、名字旁「未驗證身分」、橫幅三則文案、封鎖後不能輸入 |
| 配額／連結純函式（新檔即可） | 帳號年齡對應上限；網址檢測；未驗證 image type 拒絕 |
| `backend/functions/groupMembership.test.js` | 回歸：沒有 active 校籍不能 join |
| `backend/functions/userDataExport.test.js` | 平台對話可依成員匯出；匯出物件不含對方 `studentId`／`schoolId` |

Web 的 `MessagingSession` 要能表達 `{ uid, channel: 'platform' }` 或 `schoolId: null` 的平台模式，不能再把「沒有學校」一律丟 `permission`。校內通知（`watchAccountNotifications`）可維持要校籍。

### 7.3 E2E

現有 Maestro `apps/mobile/.maestro/flows/09_messages.yaml` 實際是課程群組加入碼，不是私訊。不要把一般帳號場景塞進這條煙霧測試。另增例如 `09_platform_message_request.yaml`（名稱實作時可調），至少覆蓋：

1. 一般帳號登入後看得到訊息入口，沒有校內名錄搜學號。
2. 對已驗證測試帳號送出請求；對方帳號在「訊息請求」看到暱稱與「未驗證身分」，正式列表還沒有這人。
3. 未接受前送連結被擋；對話頂端是請求說明。
4. 對方接受後，兩邊正式列表出現對話；頂端是「對方尚未通過學校身分驗證」橫幅。
5. 檢舉與封鎖可走完；封鎖後發送方不能再送。

Web 補 Playwright 或既有元件測試能跑的流程：`/dms` 平台請求、橫幅文案、嘗試開啟校內 DM 而無校籍時的拒絕狀態。Maestro 工作流程目前對 mobile 路徑才跑，本設計不要求改那份 workflow 的觸發條件。

正式環境不跑這些 E2E 寫入。測試帳號限模擬器。

---

## 8. 分階段上線

每一階段都要寫清「什麼情況可以進下一階段」與「什麼情況退回」。退回以規則與 callable 關閉發送為主，已寫入的請求不必洗資料。本文件的提交不啟動任何階段。

### 階段 0 — 僅文件（本次）

- 做：本設計。
- 不做：改規則、改 CI、部署、寫正式資料、開環境變數。
- 可進入階段 1：實作時仍以本文件與當時程式為準，有出入先改文件。
- 退回：不適用。

### 階段 1 — 規則、索引、測試、callable，不開使用者入口

- 做：第 6、7 節的資料與測試；Fly callable 可佈到非正式環境。畫面仍維持「沒有校籍就開不了聊天」。
- 可進入階段 2：`pnpm test:rules`、Functions 與 Web／App 單元測試全綠；新索引在目標專案 READY；Storage 規則測試含未驗證上傳拒絕；手動用模擬器走完請求→接受→封鎖。
- 退回：任一規則測試失敗，或發現一般帳號能讀 directory／`studentId`。退回動作：不合併規則；若誤佈規則，立刻回到「建立對話必須校籍」的版本。

### 階段 2 — 內部帳號看得到畫面，外面對一般帳號仍關閉發送

- 做：Web／App 的未驗證標示、訊息請求匣、橫幅文案。callable 只允許內部測試 UID 清單（寫在伺服器，不是公開 env）。
- 可進入階段 3：內部走完第 7.3 節流程；檢舉／封鎖可用；沒有把學號或校名畫在平台私訊；沒有改到 `ci.yml` deploy 條件。
- 退回：畫面洩漏名錄真名、學號或學校；或內部帳號能靠客戶端直接 `set` 略過請求。退回動作：關閉測試 UID 清單，入口改回階段 1 的拒絕狀態。

### 階段 3 — 小範圍公開：一般帳號可送請求，上限用「未滿 24 小時」那一列當全體未驗證上限

- 做：拿掉測試 UID 清單，但未驗證一律先套最嚴配額（每天 3 人／10 則／不能傳圖），觀察檢舉。
- 可進入階段 4：至少連續 7 天，成立的檢舉低於平台私訊則數的 1%，且沒有「未驗證讀到學號／真名／學校」的事故；配額與連結擋下有紀錄可查。
- 退回：出現詐騙轉帳、大量垃圾請求、或隱私事故。退回動作：callable 對未驗證改為只讀（不能新請求、不能新訊息）；已接受的對話可讀。必要時平台私訊 create 全面改回規則拒絕。

### 階段 4 — 依帳號年齡放寬配額，仍禁止未驗證傳連結

- 做：啟用第 4.3 節完整年齡表；接受後允許有限張數圖片。
- 可維持：再觀察 14 天，成立檢舉仍低於 1%，且沒有未驗證傳連結成功的案例。
- 退回：濫用隨放寬明顯上升（成立檢舉倍增或出現未驗證傳連結）。退回動作：全體未驗證回到階段 3 的最嚴配額；圖片改回 0。不因此關閉已驗證校內 DM。

任何階段都不把班級群、社團群開放給一般帳號。若要改這點，另寫設計，不在本文件的放寬範圍。

---

## 9. 這次與後續都不做的事

- 不改正式 Firestore 資料、不跑 seed 對正式專案、不部署規則或網頁。
- 不修改 `.github/workflows/ci.yml` 的 `deploy-functions`（目前僅 `main` 且 `workflow_dispatch` 才跑）。
- 不新增或設定 `ONLINE_ORDERING_ENABLED`、`NEXT_PUBLIC_ONLINE_ORDERING`。
- 不讓一般帳號讀課表名單、成績、點名、校內好友、校內代號。
- 不把 Nuni 的貼文檢舉 API 直接拿來當私訊檢舉。
- 不在本階段做已讀回執給未接受的請求、語音訊息、或未驗證傳檔案。

---

## 10. 實作時會動到的主要檔案（預覽，本次未改）

- `backend/firestore/firestore.rules`、`firestore.indexes.json`
- `backend/storage/storage.rules`
- `backend/tests/security-rules.test.js`
- `apps/web/src/lib/privateMessages.ts`、`conversationAccess.ts`、`components/messaging/Messaging.tsx`
- `apps/mobile/src/utils/conversationAccess.ts`、`screens/ChatScreen.tsx`、`screens/DmsScreen.tsx`、`data/firebaseSource.ts`、`services/messaging.ts`
- Fly 上的 Functions 寫入入口（現有 `backend/functions`，佈署路徑見 `docs/deploy/functions-on-fly.md`）

對照產品權限：`docs/research/screenshot-import.md` 仍寫「找同學要學校帳號」。本設計只開放**平台私訊**，不開放校內找同學、空堂邀約或班級名單。那份文件在實作階段 2 前應加一句互參，避免兩份設計打架。
