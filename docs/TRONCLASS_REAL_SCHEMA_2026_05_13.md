# TronClass 靜宜部署實際 schema（2026-05-13 線上驗證）

> 透過 Claude in Chrome 連到 https://tronclass.pu.edu.tw/ 登入後 fetch 抓真實 response 寫下來。
> 不再用猜的 schema，這份是源頭真實 truth。

## 1. `POST /api/my-courses` — 我的課程列表

**Body**: `{ conditions?: { status: string[] }, page, page_size }`
- 空 body 或不送 conditions → 回**全部歷史** courses（含已結束學期，共 64 筆）
- `conditions: { status: ['ongoing'] }` → 14 門進行中
- `conditions: { status: ['ended'] }` → 已結束
- `conditions: { status: ['notStarted'] }` → 尚未開始

**Response**: `{ courses: TCCourse[], total: number }`（**沒有 paging 物件，只有 total**）

**TCCourse**:
```json
{
  "id": 77418,
  "name": "關愛我們共同家園微學分(跨域與設計)",
  "course_code": "1142641J1R012849",
  "course_type": 1,
  "credit": "1.0",
  "department": { "id": 129, "name": "通識涵養課程" },
  "instructors": [{ "id": 8961, "name": "楊品裕" }, ...],
  "klass": { "id": 5177, "name": "跨域與設計一R" },
  "grade": { "id": 6, "name": "1年級" },
  "semester": { "code": "114-2", "id": 59, "name": "1142" },
  "academic_year": { "code": "114", "id": 14, "name": "114" },
  "start_date": "2026-02-24",
  "end_date": "2026-06-28",
  "compulsory": false,
  "course_attributes": { "published": true, "student_count": 26, "teaching_class_name": null },
  "study_completeness": 100,
  "is_mute": false,
  "org_id": 1
}
```

## 2. `GET /api/courses/{id}/modules`

**Response**: `{ modules: TCModule[] }`

**TCModule**:
```json
{
  "id": 118997,
  "name": "第一週",
  "sort": 2,
  "is_hidden": 0,        // ⚠ 是 number (0/1)，不是 boolean
  "lesson_time_id": 0,
  "sticky_time": null,
  "syllabuses": [],
  "imported_from": null
}
```

## 3. `GET /api/courses/{id}/activities`（含 ?type=courseware_activity / ?type=forum）

**Response**: `{ activities: TCActivity[] }`

**TCActivity**:
```json
{
  "id": 464469,
  "course_id": 77418,
  "module_id": 0,          // 0 = 未分章節
  "title": "簡樸生活",
  "type": "material",       // material / web_link / video / online_video / page / forum / homework / exam / ...
  "unique_key": "material-464469",
  "sort": 60500,
  "is_started": true,
  "is_in_progress": true,
  "is_closed": false,
  "published": true,
  "uploads": [
    {
      "id": 6049866,
      "name": "The_Enoughness_Hack_(5).pdf",
      "key": "...",
      "type": "document",
      "size": 20759930,
      "allow_download": false,
      "status": "ready"
    }
  ],
  "data": {
    "description": "",
    "link": "https://reurl.cc/xK5baE",   // web_link type 才有
    "publish_time": "2026-05-11T03:07:00Z"
  },
  "completion_criterion": "觀看或下載所有參考文件附件",
  "completion_criterion_key": "view"
}
```

## 4. `GET /api/courses/{id}/homework-activities?page_size=N`

**Response**: `{ homework_activities: TCHomework[], total, page, page_size }`

**TCHomework**（關鍵欄位）:
```json
{
  "id": 465558,
  "title": "2026/05/29 MQTT-NodeRED-通訊節點",
  "type": "homework",
  "submitted": false,           // ⭐ 學生是否已交（直接 boolean）
  "submitted_status": "",        // 空字串 / 'submitted' / 'late'
  "score_published": false,
  "score_percentage": "0.00",   // 字串，本份作業在課程加權中的占比
  "submit_times": null,
  "user_submit_count": 0,
  "deadline": "2026-05-29T15:59:00Z",
  "end_time": "2026-05-29T15:59:00Z",
  "start_time": null,
  "is_closed": false,
  "is_in_progress": true,
  "module_id": 126110,
  "teaching_unit_id": 71378,
  "can_make_up_homework": false,
  "uploads": [...],
  "data": {
    "description": "...",
    "homework_type": "file_upload",
    "publish_time": "2026-05-12T06:09:00Z"
  }
}
```

## 5. `GET /api/courses/{id}/exams`

**Response**: `{ exams: TCExam[] }`

**TCExam**（關鍵欄位）:
```json
{
  "id": 55547,
  "title": "期中考前複習",
  "type": "exam",
  "is_practice_mode": true,    // true = 練習 / false = 正式考試
  "exam_submissions": [55547], // ⭐ 學生提交的 submission IDs；length > 0 = 已交
  "submit_times": 0,
  "score_percentage": "0.00",
  "score_rule": "highest",
  "score_type": "percentage",
  "start_time": "2026-03-26T02:00:00Z",
  "end_time": "2026-04-17T02:00:00Z",
  "is_closed": true,
  "is_started": true,
  "module_id": 125726,
  "publish_time": "2026-03-25T02:00:00Z"
}
```

## 6. `GET /api/exams/{eid}/submissions` — 學生個人考試分數

**Response**:
```json
{
  "exam_score": 0,
  "exam_final_score": null,
  "exam_score_rule": "highest",
  "submissions": [
    {
      "id": 1780286,
      "exam_id": 55547,
      "score": "0.0",
      "submit_method": "submitted_by_time_limit",
      "submit_method_text": "考試結束自動交卷",
      "submitted_at": "2026-04-17T02:00:00Z",
      "created_at": "2026-04-10T01:02:31Z"
    }
  ]
}
```

## 7. `GET /api/courses/{id}/score-items`（?with_score=true）

**Response**: `{ items: TCScoreItem[] }`

**TCScoreItem**:
```json
{
  "id": 211781,
  "name": "大四專題展心得，至少３組",
  "type": "homework_activity", // homework_activity / exam / ...
  "referrer_id": 421262,        // 對應 homework/exam.id
  "weight": null,
  "percentage": 0,
  "scored": false,
  "is_announce_score": false,
  "is_in_progress": false,
  "teaching_unit_id": 71378,
  "group_id": 0
}
```
**⚠ 注意：score-items 不含「學生個人分數」，只是配置；個人分數要從 exams/{id}/submissions 等取。**

## 8. 不存在的 endpoint（這些回 404 / 500）

- `/api/courses/{id}/self-score` → 404（**沒有這支**）
- `/api/courses/{id}/discussions` → 500（該課程未開討論時會 500，不是 404）
- `/api/courses/{id}/forums` → 404
- `/api/courses/{id}/attendance` → 404
- `/api/courses/{id}/lesson-times` → 404
- `/api/courses/{id}/student-score` → 404
- `/api/users/me` → 404（沒有 me alias）

**討論串的真實做法**：`type='forum'` 的 activity 也會出現在 `/api/courses/{id}/activities`（雖然 filter `?type=forum` 不準）

**點名的真實做法**：靜宜版 TronClass **沒有開放 attendance API** — 教師點名功能在學校系統，不是 TronClass。

## 9. 真實檔案下載 URL

- 預覽：`https://tronclass.pu.edu.tw/course/{cid}/content#/activity/{aid}`
- 直下載：`https://tronclass.pu.edu.tw/api/uploads/{upload_key}/blob`

## 10. 本輪修了 tronClassClient.ts 哪些

1. `tcFetchHomeworkActivities` — 全部對齊真實 schema：直接看 `submitted: boolean`，標準化輸出 `student_score_percentage / student_submitted_at / student_is_late`
2. `tcFetchCourseExams` — 用 `exam_submissions.length > 0` 判定已交，`is_practice_mode` 區分 quiz/exam
3. `tcFetchModules` — `is_hidden` 用 `Boolean()` 包裝（真實是 number）

## 11. 仍需要做的（你下次有空再來）

- `tcFetchSelfScore` 拿掉（404），改成 caller 端用 `tcFetchCourseExams + tcFetchExamSubmissions + tcFetchHomeworkActivities` 自己累加
- `tcFetchDiscussions` 改成抓 `activities?type=forum`（雖 filter 不準也比 500 好），UI 端再過濾 `type === 'forum'`
- 找出 TronClass 是否有「我的某課程個人成績」端點（最後手段）
