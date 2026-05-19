/**
 * Demo Courses Adapter — 把 demoCoursesMock 翻成 TronClass-compatible 形狀
 *
 * 8 個 chip screen 在偵測到 demo courseId 時直接 short-circuit 用 demo，
 * 不打 TronClass、不依賴登入狀態。讓 demo 永遠是 polished 的飽滿體驗。
 *
 * 設計原則：
 * - 函式名稱對應 `tronClassClient.ts` 的 `tc*` 函式（demo* prefix）
 * - 回傳形狀盡量對齊 TC，但只填 screen 真的會用的欄位
 * - 任何「找不到」一律回空陣列/null，避免 throw 讓 screen 處理空狀態
 */
import type { TCCourse, TCDiscussionPost } from '../services/tronClassClient';

import {
  DEMO_COURSES,
  getDemoCourseById,
  getDemoModulesByCourse,
  getDemoMaterialsByCourse,
  getDemoHomeworksByCourse,
  getDemoExamsByCourse,
  getDemoDiscussionsByCourse,
  getDemoPeerReviewsByCourse,
  getDemoScoreItemsByCourse,
  getDemoAttendanceByCourse,
  type MockCourse,
  type MockMaterial,
} from './demoCoursesMock';

// ─────────────────────────────────────────────────────────
// Demo course detection
// ─────────────────────────────────────────────────────────

const DEMO_COURSE_IDS = new Set(DEMO_COURSES.map((c) => c.id));

/** True if the given courseId is one of the 5 demo courses (71378/71282/71240/71393/77418) */
export function isDemoCourseId(courseId: number | string | undefined | null): boolean {
  if (courseId == null) return false;
  const id = typeof courseId === 'string' ? Number(courseId.replace(/^tc:/, '')) : Number(courseId);
  return DEMO_COURSE_IDS.has(id);
}

/** Normalize a route param to numeric courseId */
export function toDemoCourseId(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  const s = String(raw).replace(/^tc:/, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function materialTypeToUploadType(t: MockMaterial['type']): {
  type: string; // TC activity type
  uploadType: string;
  uploadExt: string;
} {
  switch (t) {
    case 'video':
      return { type: 'online_video', uploadType: 'video', uploadExt: 'mp4' };
    case 'web_link':
      return { type: 'web_link', uploadType: 'link', uploadExt: '' };
    case 'page':
      return { type: 'page', uploadType: 'page', uploadExt: '' };
    case 'audio':
      return { type: 'audio', uploadType: 'audio', uploadExt: 'mp3' };
    case 'pdf':
    default:
      return { type: 'material', uploadType: 'document', uploadExt: 'pdf' };
  }
}

// ─────────────────────────────────────────────────────────
// Modules / Materials / Exams / Homeworks
// ─────────────────────────────────────────────────────────

export function demoFetchModules(courseId: number) {
  return getDemoModulesByCourse(courseId).map((m) => ({
    id: m.id,
    course_id: courseId,
    name: m.name,
    sort: m.sort,
    is_hidden: false,
    syllabuses: [] as Array<{ id: number; name?: string }>,
  }));
}

export function demoFetchCourseActivities(courseId: number) {
  return getDemoMaterialsByCourse(courseId).map((mat) => {
    const meta = materialTypeToUploadType(mat.type);
    return {
      id: mat.id,
      title: mat.title,
      type: meta.type,
      module_id: mat.moduleId,
      start_time: null as string | null,
      end_time: null as string | null,
      uploads: [
        {
          id: mat.id + 900_000,
          name: mat.title + (meta.uploadExt ? `.${meta.uploadExt}` : ''),
          key: `demo-key-${mat.id}`,
          type: meta.uploadType,
          size: mat.sizeBytes ?? 0,
          allow_download: true,
        },
      ],
    };
  });
}

export function demoFetchCourseExams(courseId: number) {
  // 把該課的 score_items 對應到 exam，找到 weight
  const scoreItems = getDemoScoreItemsByCourse(courseId);
  return getDemoExamsByCourse(courseId).map((e) => {
    // 嘗試找對應的 scoreItem（exam 名或同類型）
    const matched = scoreItems.find(
      (s) =>
        (s.type === 'exam' || s.type === 'quiz') &&
        (s.name.includes(e.title.slice(0, 4)) ||
          (e.title.includes('期中') && s.name.includes('期中')) ||
          (e.title.includes('期末') && s.name.includes('期末'))),
    );
    return {
      id: e.id,
      title: e.title,
      type: e.isPractice ? 'quiz' : 'exam',
      module_id: e.moduleId,
      start_time: e.startAt,
      end_time: e.endAt,
      total_score: e.totalScore,
      submit_times: 1,
      submitted_times: e.submitted ? 1 : 0,
      is_closed: new Date(e.endAt).getTime() < Date.now(),
      score_percentage: matched ? String(matched.weight) : (e.isPractice ? '0' : '30'),
    };
  });
}

export function demoFetchHomeworkActivities(courseId: number) {
  return getDemoHomeworksByCourse(courseId).map((hw) => ({
    id: hw.id,
    title: hw.title,
    type: 'homework',
    module_id: hw.moduleId,
    end_time: hw.dueAt,
    start_time: null as string | null,
    is_closed: new Date(hw.dueAt).getTime() < Date.now() && !hw.submitted,
    submitted: hw.submitted,
    submitted_status: hw.submitted ? (hw.isLate ? 'late' : 'submitted') : '',
    homework_submissions: hw.submitted ? [hw.id * 10] : [],
    score_published: hw.graded,
    student_score: hw.score,
    total_score: hw.totalScore,
    weight: null as number | null,
    student_submitted_at: hw.submitted ? hw.dueAt : null,
    student_is_late: hw.isLate,
  }));
}

// ─────────────────────────────────────────────────────────
// Detail / submission level — for HomeworkCard / ExamCard expansions
// ─────────────────────────────────────────────────────────

export function demoFetchHomeworkDetail(courseId: number, homeworkId: number) {
  const hw = getDemoHomeworksByCourse(courseId).find((h) => h.id === homeworkId);
  if (!hw) return null;
  return {
    id: hw.id,
    course_id: courseId,
    type: 'homework',
    title: hw.title,
    description: hw.description,
    start_time: null as string | null,
    end_time: hw.dueAt,
    score: hw.score,
    total_score: hw.totalScore,
    status: hw.submitted ? 'submitted' : 'pending',
    weight: null as number | null,
    allow_late: true,
    late_penalty_percent: 10,
    attachments: [] as Array<{ id: number; name: string; url: string; size: number | null; mime_type: string | null }>,
    rubric: null,
    submission_type: 'file_upload',
    max_submissions: 3,
  };
}

export function demoFetchHomeworkSubmissions(courseId: number, homeworkId: number) {
  const hw = getDemoHomeworksByCourse(courseId).find((h) => h.id === homeworkId);
  if (!hw || !hw.submitted) return [];
  return [
    {
      id: hw.id * 10,
      homework_id: hw.id,
      student_id: 1,
      submitted_at: hw.dueAt,
      status: 'submitted',
      score: hw.score,
      total_score: hw.totalScore,
      feedback: hw.feedback,
      attachments: [] as Array<{ id: number; name: string; url: string; size: number | null; mime_type: string | null }>,
      is_late: hw.isLate,
      graded_at: hw.graded ? hw.dueAt : null,
    },
  ];
}

export function demoFetchExamSubmissions(examId: number) {
  // 找該 exam
  let exam: ReturnType<typeof getDemoExamsByCourse>[number] | null = null;
  for (const c of DEMO_COURSES) {
    const list = getDemoExamsByCourse(c.id);
    const found = list.find((e) => e.id === examId);
    if (found) {
      exam = found;
      break;
    }
  }
  if (!exam || !exam.submitted) {
    return {
      exam_score: null,
      exam_final_score: null,
      exam_score_rule: 'highest',
      submissions: [],
    };
  }
  return {
    exam_score: exam.studentScore,
    exam_final_score: exam.studentScore,
    exam_score_rule: 'highest',
    submissions: [
      {
        id: exam.id * 10,
        exam_id: exam.id,
        score: String(exam.studentScore ?? 0),
        created_at: exam.startAt,
        submitted_at: exam.endAt,
        submit_method: 'manual',
      },
    ],
  };
}

export function demoFetchExamDetail(courseId: number, examId: number) {
  const exam = getDemoExamsByCourse(courseId).find((e) => e.id === examId);
  if (!exam) return null;
  return {
    id: exam.id,
    course_id: courseId,
    title: exam.title,
    description: null as string | null,
    start_time: exam.startAt,
    end_time: exam.endAt,
    duration_minutes: exam.durationMin,
    question_count: exam.questionCount,
    total_score: exam.totalScore,
    max_attempts: exam.isPractice ? 99 : 1,
    show_answers: exam.isPractice,
    attempted: exam.submitted,
  };
}

export function demoFetchExamAttempts(_courseId: number, _examId: number) {
  // demo 不提供逐題作答紀錄，回空陣列
  return [] as Array<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────
// Discussions
// ─────────────────────────────────────────────────────────

export function demoFetchDiscussions(courseId: number) {
  return getDemoDiscussionsByCourse(courseId).map((d) => ({
    id: d.id,
    course_id: courseId,
    title: d.title,
    description: d.hasTeacherEndorsement
      ? `${d.authorName} 發起 · 老師已置頂 / 推薦回覆`
      : `${d.authorName} 發起的討論`,
    post_count: d.replyCount,
    created_at: d.postedAt,
    last_post_at: d.postedAt,
    is_locked: false,
  }));
}

/** Demo 討論貼文 — 靜態示範回覆串（無 API 時使用） */
export function demoFetchDiscussionPosts(courseId: number, discussionId: number): TCDiscussionPost[] {
  const threads = getDemoDiscussionsByCourse(courseId);
  const thread = threads.find((d) => d.id === discussionId);
  if (!thread) {
    const now = new Date().toISOString();
    return [
      {
        id: discussionId,
        discussion_id: discussionId,
        author_id: 0,
        author_name: '我',
        content:
          '這是你在 Demo 模式中建立的討論串。連線環境下會顯示 TronClass 的完整回覆與附件。',
        created_at: now,
        updated_at: null,
        parent_id: null,
        likes_count: 0,
        attachments: [],
      },
    ];
  }

  const t0 = new Date(thread.postedAt).getTime();
  const mk = (
    postId: number,
    offsetMin: number,
    author: string,
    content: string,
    parentId: number | null,
    likes: number,
  ): TCDiscussionPost => ({
    id: postId,
    discussion_id: discussionId,
    author_id: postId,
    author_name: author,
    content,
    created_at: new Date(t0 + offsetMin * 60_000).toISOString(),
    updated_at: null,
    parent_id: parentId,
    likes_count: likes,
    attachments: [],
  });

  const baseId = discussionId * 1000;
  const opener = `關於「${thread.title}」：\n\n想聽聽大家的經驗與做法，也歡迎補充參考資料。`;
  const out: TCDiscussionPost[] = [
    mk(baseId + 1, 0, thread.authorName, opener, null, Math.min(8, 2 + thread.replyCount)),
    mk(baseId + 2, 38, '同學｜佳玲', '我這邊先檢查資料前處理與超參數，通常能改善訓練穩定度。', null, 4),
    mk(baseId + 3, 95, '同學｜冠宇', '+1，也可以先把 batch size 調小試試看。', null, 2),
  ];

  if (thread.hasTeacherEndorsement) {
    out.push(
      mk(
        baseId + 4,
        200,
        '教師補充',
        '謝謝大家討論。建議對照講義第 7 章的例子，並附上你們的實驗設定截圖會更容易診斷。',
        null,
        12,
      ),
    );
  } else {
    out.push(
      mk(
        baseId + 4,
        180,
        '同學｜承翰',
        '若有錯誤訊息或 log，貼上來大家幫忙一起看會更快。',
        null,
        1,
      ),
    );
  }

  return out;
}

// ─────────────────────────────────────────────────────────
// Peer Reviews
// ─────────────────────────────────────────────────────────

export function demoFetchPeerReviews(courseId: number) {
  return getDemoPeerReviewsByCourse(courseId).map((p) => ({
    id: p.id,
    assignment_title: p.assignmentTitle,
    target_submission_id: p.id + 5000,
    target_anonymous_name: p.targetAnonymousName,
    rubric: null,
    submitted: p.submitted,
  }));
}

// ─────────────────────────────────────────────────────────
// Score items / Self score
// ─────────────────────────────────────────────────────────

export function demoFetchScoreItems(courseId: number) {
  return getDemoScoreItemsByCourse(courseId).map((s) => ({
    id: s.id,
    title: s.name,
    name: s.name,
    score: s.studentScore,
    student_score: s.studentScore,
    total_score: s.totalScore,
    weight: s.weight,
    type: s.type,
  }));
}

export function demoFetchSelfScore(courseId: number) {
  const items = getDemoScoreItemsByCourse(courseId);
  const graded = items.filter((s) => s.studentScore !== null);
  if (graded.length === 0) return null;
  let earned = 0;
  let used = 0;
  for (const it of graded) {
    if (it.studentScore !== null) {
      earned += (it.studentScore / it.totalScore) * it.weight;
      used += it.weight;
    }
  }
  return {
    course_id: courseId,
    final_score: used > 0 ? Math.round((earned / used) * 100 * 10) / 10 : null,
    letter_grade: null,
    rank: null,
    total_students: 30,
  };
}

// ─────────────────────────────────────────────────────────
// Attendance sessions
// ─────────────────────────────────────────────────────────

export function demoListAttendanceSessions(courseId: number) {
  return getDemoAttendanceByCourse(courseId).map((a) => ({
    id: a.id,
    courseId: courseId,
    startedAt: new Date(a.startedAt),
    active: a.active,
    attendeeCount: a.attendeeCount,
    totalCount: a.totalCount,
    myStatus: a.myStatus,
    mode: a.mode,
  }));
}

// ─────────────────────────────────────────────────────────
// Course catalog & meta
// ─────────────────────────────────────────────────────────

export function demoFetchCourses() {
  return DEMO_COURSES.map((c) => ({
    id: c.id,
    name: c.name,
    course_code: c.course_code,
    course_type: 1,
    credit: String(c.credit),
    department: { id: 100, name: '資訊管理學系' },
    instructors: [{ id: 1, name: c.instructor }],
    klass: { id: c.id + 1000, name: c.name },
    grade: { id: 4, name: '4年級' },
    semester: { code: '114-2', id: 59, name: c.semester },
    academic_year: { code: '114', id: 14, name: '114' },
    start_date: '2026-02-24',
    end_date: '2026-06-28',
    compulsory: false,
    course_attributes: { published: true, student_count: 30, teaching_class_name: null },
    study_completeness: 65,
    is_mute: false,
    org_id: 1,
    color: c.color,
    iconEmoji: c.iconEmoji,
  }));
}

export function getDemoCourseDisplay(courseId: number) {
  return getDemoCourseById(courseId);
}

/** 將 DEMO_COURSES 轉成 LearnStack / CoursesHome 使用的 TCCourse（離線口試用） */
export function demoCoursesAsTCCourses(): TCCourse[] {
  return DEMO_COURSES.map(mockCourseToTCCourse);
}

function mockCourseToTCCourse(c: MockCourse): TCCourse {
  return {
    id: c.id,
    name: c.name,
    course_code: c.course_code,
    department: null,
    instructors: [{ id: 0, name: c.instructor }],
    credit: c.credit,
    semester: { code: c.semester, id: 0, name: `${c.semester}` },
    klass: null,
    grade: null,
    course_outline: null,
    start_date: null,
    end_date: null,
    status: 'ongoing',
    role: 'student',
    student_count: 30,
    classroom_schedule: null,
  };
}

/**
 * 若尚無任何 TronClass 正向 course id，補上五門離線 demo 課（保留既有 PU 負 id 課程在後方）。
 */
export function mergeDemoTronClassCoursesIfEmpty(courses: TCCourse[]): TCCourse[] {
  const hasTronClassCourse = courses.some((row) => row.id > 0);
  if (hasTronClassCourse) return courses;

  const demos = demoCoursesAsTCCourses();
  const demoIds = new Set(demos.map((d) => d.id));
  const rest = courses.filter((c) => !demoIds.has(c.id));
  return [...demos, ...rest];
}
