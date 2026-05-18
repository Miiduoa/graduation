/**
 * Demo Courses Mock — 5 門課程的深度資料，所有 chip 都能在 demo 時看到豐富內容
 *
 * 設計：每門課含完整的 modules / materials / homeworks / exams / discussions
 *      / peer reviews / score items / attendance sessions / announcements / notes
 *
 * 使用：8 個 chip 的 screen 在 TronClass session 沒生效時自動 fallback 到這。
 * 對應靜宜 1142 學期範例課程（以 `DEMO_COURSES` 為準）：
 *   71378 機器學習 / 71282 計算機概論(二) / 71240 資訊數學(二)
 *   71393 作業研究 / 77418 關愛我們共同家園微學分
 */

const NOW = new Date('2026-05-13T10:00:00+08:00').getTime();
const D = (offsetDays: number) =>
  new Date(NOW + offsetDays * 86_400_000).toISOString();

// ─────────────────────────────────────────────────────────
// Types — 與 TronClass adapter 對齊但純本地
// ─────────────────────────────────────────────────────────

export interface MockCourse {
  id: number;
  name: string;
  course_code: string;
  instructor: string;
  credit: number;
  semester: string;
  color: string;
  iconEmoji: string;
}

export interface MockModule {
  id: number;
  courseId: number;
  name: string;
  sort: number;
  description?: string;
}

export interface MockMaterial {
  id: number;
  courseId: number;
  moduleId: number;
  title: string;
  type: 'pdf' | 'video' | 'web_link' | 'page' | 'audio';
  durationSec?: number;
  sizeBytes?: number;
  progress: number; // 0-1
  url?: string;
}

export interface MockHomework {
  id: number;
  courseId: number;
  moduleId: number;
  title: string;
  description: string;
  dueAt: string;
  submitted: boolean;
  graded: boolean;
  score: number | null;
  totalScore: number;
  feedback: string | null;
  isLate: boolean;
}

export interface MockExam {
  id: number;
  courseId: number;
  moduleId: number;
  title: string;
  type: 'quiz' | 'exam';
  startAt: string;
  endAt: string;
  durationMin: number;
  questionCount: number;
  totalScore: number;
  studentScore: number | null;
  submitted: boolean;
  isPractice: boolean;
}

export interface MockDiscussion {
  id: number;
  courseId: number;
  title: string;
  authorName: string;
  postedAt: string;
  replyCount: number;
  viewCount: number;
  hasTeacherEndorsement: boolean;
}

export interface MockPeerReview {
  id: number;
  courseId: number;
  assignmentTitle: string;
  targetAnonymousName: string;
  submitted: boolean;
  dueAt: string;
}

export interface MockScoreItem {
  id: number;
  courseId: number;
  name: string;
  type: 'homework' | 'exam' | 'quiz' | 'attendance' | 'participation';
  weight: number; // 0-100
  studentScore: number | null;
  totalScore: number;
}

export interface MockAttendanceSession {
  id: string;
  courseId: number;
  startedAt: string;
  active: boolean;
  attendeeCount: number;
  totalCount: number;
  myStatus: 'present' | 'late' | 'absent' | 'excused' | null;
  mode: 'rotating_qr' | 'number_code' | 'geofence';
}

export interface MockAnnouncement {
  id: number;
  courseId: number;
  title: string;
  content: string;
  postedAt: string;
  isImportant: boolean;
}

// ─────────────────────────────────────────────────────────
// 5 門課程主資料
// ─────────────────────────────────────────────────────────

export const DEMO_COURSES: MockCourse[] = [
  {
    id: 71378,
    name: '機器學習',
    course_code: '114271103A004358',
    instructor: '張怡君',
    credit: 3,
    semester: '1142',
    color: '#22C55E',
    iconEmoji: '🤖',
  },
  {
    id: 71282,
    name: '計算機概論(二)',
    course_code: '114271101A004784',
    instructor: '王孝熙',
    credit: 2,
    semester: '1142',
    color: '#FF2D55',
    iconEmoji: '💻',
  },
  {
    id: 71240,
    name: '資訊數學(二)',
    course_code: '114271101A009714',
    instructor: '王俊傑',
    credit: 2,
    semester: '1142',
    color: '#FF9500',
    iconEmoji: '🔢',
  },
  {
    id: 71393,
    name: '作業研究',
    course_code: '114271103A005172',
    instructor: '康贊清',
    credit: 3,
    semester: '1142',
    color: '#5856D6',
    iconEmoji: '📊',
  },
  {
    id: 77418,
    name: '關愛我們共同家園微學分(跨域與設計)',
    course_code: '1142641J1R012849',
    instructor: '楊品裕',
    credit: 1,
    semester: '1142',
    color: '#AF52DE',
    iconEmoji: '🌍',
  },
];

// ─────────────────────────────────────────────────────────
// 教材模組 + 教材檔案
// ─────────────────────────────────────────────────────────

export const DEMO_MODULES: MockModule[] = [
  // 機器學習 8 個 module
  { id: 118997, courseId: 71378, name: '第一週：課程簡介與環境設定', sort: 1, description: 'Python、NumPy、Pandas 環境' },
  { id: 119000, courseId: 71378, name: '第二週：監督式學習基礎', sort: 2, description: '線性回歸、決策樹' },
  { id: 119003, courseId: 71378, name: '第三週：分類演算法', sort: 3, description: 'KNN、SVM、邏輯回歸' },
  { id: 125726, courseId: 71378, name: '第四週：分群與非監督', sort: 4, description: 'K-means、Hierarchical' },
  { id: 125729, courseId: 71378, name: '第五週：深度學習導論', sort: 5 },
  { id: 126110, courseId: 71378, name: '作業專區', sort: 6 },
  { id: 126164, courseId: 71378, name: '期末微專題', sort: 7 },
  { id: 126479, courseId: 71378, name: '1142 機器學習期中考', sort: 8 },
  // 計算機概論二 4 個 module
  { id: 20001, courseId: 71282, name: '第一單元：電腦組織', sort: 1 },
  { id: 20002, courseId: 71282, name: '第二單元：作業系統概念', sort: 2 },
  { id: 20003, courseId: 71282, name: '第三單元：網路與資安', sort: 3 },
  { id: 20004, courseId: 71282, name: '期中考', sort: 4 },
  // 資訊數學二 3 個 module
  { id: 30001, courseId: 71240, name: '線性代數基礎', sort: 1 },
  { id: 30002, courseId: 71240, name: '矩陣運算', sort: 2 },
  { id: 30003, courseId: 71240, name: '特徵值與特徵向量', sort: 3 },
  // 作業研究 5 個 module
  { id: 40001, courseId: 71393, name: '線性規劃', sort: 1 },
  { id: 40002, courseId: 71393, name: '單純形法', sort: 2 },
  { id: 40003, courseId: 71393, name: '對偶理論', sort: 3 },
  { id: 40004, courseId: 71393, name: '整數規劃', sort: 4 },
  { id: 40005, courseId: 71393, name: '網路最佳化', sort: 5 },
  // 關愛家園 2 個 module
  { id: 50001, courseId: 77418, name: '永續環境議題', sort: 1 },
  { id: 50002, courseId: 77418, name: '在地實踐', sort: 2 },
];

export const DEMO_MATERIALS: MockMaterial[] = [
  // 機器學習
  { id: 60001, courseId: 71378, moduleId: 118997, title: '01_課程大綱與評分標準.pdf', type: 'pdf', sizeBytes: 524288, progress: 1.0 },
  { id: 60002, courseId: 71378, moduleId: 118997, title: '02_Python 環境安裝指南.pdf', type: 'pdf', sizeBytes: 1048576, progress: 1.0 },
  { id: 60003, courseId: 71378, moduleId: 118997, title: 'Anaconda 安裝教學影片', type: 'video', durationSec: 624, progress: 0.85 },
  { id: 60004, courseId: 71378, moduleId: 119000, title: '03_線性回歸理論.pdf', type: 'pdf', sizeBytes: 2097152, progress: 0.75 },
  { id: 60005, courseId: 71378, moduleId: 119000, title: '範例程式碼.zip', type: 'pdf', sizeBytes: 524288, progress: 0.0 },
  { id: 60006, courseId: 71378, moduleId: 119003, title: 'scikit-learn 官方教學', type: 'web_link', url: 'https://scikit-learn.org/', progress: 0.5 },
  { id: 60007, courseId: 71378, moduleId: 119003, title: 'KNN 演算法說明影片', type: 'video', durationSec: 1230, progress: 0.0 },
  { id: 60008, courseId: 71378, moduleId: 125726, title: 'K-means 數學推導.pdf', type: 'pdf', sizeBytes: 1572864, progress: 0.0 },
  { id: 60009, courseId: 71378, moduleId: 125729, title: 'TensorFlow 入門.pdf', type: 'pdf', sizeBytes: 3145728, progress: 0.0 },
  // 計概二
  { id: 60101, courseId: 71282, moduleId: 20001, title: 'CPU 與記憶體架構.pdf', type: 'pdf', progress: 0.9 },
  { id: 60102, courseId: 71282, moduleId: 20002, title: 'Linux 基本指令.pdf', type: 'pdf', progress: 0.4 },
  { id: 60103, courseId: 71282, moduleId: 20002, title: 'Bash 操作練習', type: 'page', progress: 0.0 },
  { id: 60104, courseId: 71282, moduleId: 20003, title: '加密演算法簡介.pdf', type: 'pdf', progress: 0.0 },
  // 資訊數學二
  { id: 60201, courseId: 71240, moduleId: 30001, title: '向量空間.pdf', type: 'pdf', progress: 0.6 },
  { id: 60202, courseId: 71240, moduleId: 30002, title: '矩陣運算範例.pdf', type: 'pdf', progress: 0.3 },
  // 作業研究
  { id: 60301, courseId: 71393, moduleId: 40001, title: '線性規劃導論.pdf', type: 'pdf', progress: 1.0 },
  { id: 60302, courseId: 71393, moduleId: 40002, title: '單純形法計算範例.pdf', type: 'pdf', progress: 0.7 },
  { id: 60303, courseId: 71393, moduleId: 40004, title: '分支定界法.pdf', type: 'pdf', progress: 0.0 },
  // 關愛家園
  { id: 60401, courseId: 77418, moduleId: 50001, title: '聯合國 SDGs 介紹.pdf', type: 'pdf', progress: 1.0 },
  { id: 60402, courseId: 77418, moduleId: 50002, title: '靜宜大學永續校園實踐影片', type: 'video', durationSec: 480, progress: 0.0 },
];

// ─────────────────────────────────────────────────────────
// 作業
// ─────────────────────────────────────────────────────────

export const DEMO_HOMEWORKS: MockHomework[] = [
  // 機器學習 7 份
  { id: 465001, courseId: 71378, moduleId: 119000, title: 'HW1：用 NumPy 實作線性回歸', description: '不可用 scikit-learn，自己手刻 gradient descent', dueAt: D(-30), submitted: true, graded: true, score: 92, totalScore: 100, feedback: '梯度推導正確，註解清楚。', isLate: false },
  { id: 465002, courseId: 71378, moduleId: 119003, title: 'HW2：KNN 分類器', description: '用鳶尾花資料集練習', dueAt: D(-20), submitted: true, graded: true, score: 88, totalScore: 100, feedback: '少了 k 值的調整實驗', isLate: false },
  { id: 465003, courseId: 71378, moduleId: 125726, title: 'HW3：K-means 分群實作', description: 'Hierarchical Clustering 比較', dueAt: D(-10), submitted: true, graded: true, score: 95, totalScore: 100, feedback: '完整且有視覺化', isLate: false },
  { id: 465004, courseId: 71378, moduleId: 125729, title: 'HW4：MNIST CNN', description: '使用 TensorFlow 訓練', dueAt: D(-3), submitted: true, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
  { id: 465558, courseId: 71378, moduleId: 126110, title: '2026/05/29 MQTT-NodeRED-通訊節點', description: '用 NodeRED 串接 MQTT broker，完成 IoT pipeline', dueAt: D(16), submitted: false, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
  { id: 465005, courseId: 71378, moduleId: 126164, title: '期末微專題：自選資料集分析', description: '完整 ML pipeline + 報告', dueAt: D(45), submitted: false, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
  { id: 465006, courseId: 71378, moduleId: 119003, title: '期中考_補救作業', description: '針對期中考錯題補強', dueAt: D(8), submitted: false, graded: false, score: null, totalScore: 30, feedback: null, isLate: false },
  // 計概二 3 份
  { id: 466001, courseId: 71282, moduleId: 20001, title: '單元一作業：CPU 指令週期', description: '說明 fetch-decode-execute', dueAt: D(-12), submitted: true, graded: true, score: 85, totalScore: 100, feedback: '舉例豐富', isLate: false },
  { id: 466002, courseId: 71282, moduleId: 20002, title: '單元二作業：Linux 指令練習', description: '20 題基本指令', dueAt: D(-2), submitted: true, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
  { id: 466003, courseId: 71282, moduleId: 20003, title: '單元三作業：基礎加密', description: 'AES vs RSA 比較', dueAt: D(14), submitted: false, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
  // 資訊數學二 2 份
  { id: 467001, courseId: 71240, moduleId: 30001, title: '線性代數習題一', description: '習題 1.1 - 1.5', dueAt: D(-15), submitted: true, graded: true, score: 78, totalScore: 100, feedback: '部分證明步驟可更嚴謹', isLate: false },
  { id: 467002, courseId: 71240, moduleId: 30002, title: '矩陣運算作業', description: '證明對稱矩陣性質', dueAt: D(5), submitted: false, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
  // 作業研究 5 份
  { id: 468001, courseId: 71393, moduleId: 40001, title: '線性規劃模型建立', description: '生產組合最佳化', dueAt: D(-25), submitted: true, graded: true, score: 90, totalScore: 100, feedback: '建模清楚', isLate: false },
  { id: 468002, courseId: 71393, moduleId: 40002, title: '單純形法手算', description: '5 個 LP 問題', dueAt: D(-18), submitted: true, graded: true, score: 75, totalScore: 100, feedback: '計算錯誤兩題', isLate: true },
  { id: 468003, courseId: 71393, moduleId: 40003, title: '對偶問題分析', description: 'Shadow price 解釋', dueAt: D(-5), submitted: true, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
  { id: 468004, courseId: 71393, moduleId: 40004, title: '整數規劃應用', description: '排程問題', dueAt: D(12), submitted: false, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
  { id: 468005, courseId: 71393, moduleId: 40005, title: '網路最短路徑', description: 'Dijkstra 演算法應用', dueAt: D(28), submitted: false, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
  // 關愛家園 1 份
  { id: 469001, courseId: 77418, moduleId: 50002, title: '永續校園心得', description: '500 字心得 + 一張行動照片', dueAt: D(7), submitted: false, graded: false, score: null, totalScore: 100, feedback: null, isLate: false },
];

// ─────────────────────────────────────────────────────────
// 測驗
// ─────────────────────────────────────────────────────────

export const DEMO_EXAMS: MockExam[] = [
  // 機器學習
  { id: 55547, courseId: 71378, moduleId: 126479, title: '機器學習期中考', type: 'exam', startAt: D(-26), endAt: D(-26), durationMin: 90, questionCount: 25, totalScore: 100, studentScore: 87, submitted: true, isPractice: false },
  { id: 55548, courseId: 71378, moduleId: 126479, title: '期中考前複習（練習用）', type: 'quiz', startAt: D(-32), endAt: D(-26), durationMin: 60, questionCount: 15, totalScore: 50, studentScore: 42, submitted: true, isPractice: true },
  // 計概二
  { id: 56001, courseId: 71282, moduleId: 20004, title: '計概期中考', type: 'exam', startAt: D(-20), endAt: D(-20), durationMin: 80, questionCount: 30, totalScore: 100, studentScore: 79, submitted: true, isPractice: false },
  { id: 56002, courseId: 71282, moduleId: 20001, title: '單元一小考', type: 'quiz', startAt: D(-28), endAt: D(-28), durationMin: 30, questionCount: 10, totalScore: 100, studentScore: 92, submitted: true, isPractice: false },
  // 作業研究
  { id: 58001, courseId: 71393, moduleId: 40002, title: '作研期中考', type: 'exam', startAt: D(-15), endAt: D(-15), durationMin: 90, questionCount: 5, totalScore: 100, studentScore: 68, submitted: true, isPractice: false },
  { id: 58002, courseId: 71393, moduleId: 40005, title: '網路最佳化小考', type: 'quiz', startAt: D(10), endAt: D(10), durationMin: 40, questionCount: 8, totalScore: 100, studentScore: null, submitted: false, isPractice: false },
];

// ─────────────────────────────────────────────────────────
// 討論串
// ─────────────────────────────────────────────────────────

export const DEMO_DISCUSSIONS: MockDiscussion[] = [
  { id: 70001, courseId: 71378, title: 'Clustering? Hierarchical Clustering? k-means?', authorName: '楊涵真', postedAt: D(-2), replyCount: 12, viewCount: 87, hasTeacherEndorsement: true },
  { id: 70002, courseId: 71378, title: 'HW4 MNIST CNN 訓練不收斂怎麼辦？', authorName: '王同學', postedAt: D(-1), replyCount: 5, viewCount: 38, hasTeacherEndorsement: false },
  { id: 70003, courseId: 71378, title: '推薦的機器學習延伸閱讀', authorName: '張怡君（老師）', postedAt: D(-5), replyCount: 18, viewCount: 156, hasTeacherEndorsement: true },
  { id: 70101, courseId: 71282, title: '單元二作業第 12 題卡住了', authorName: '小華', postedAt: D(-1), replyCount: 7, viewCount: 42, hasTeacherEndorsement: false },
  { id: 70201, courseId: 71393, title: '對偶理論的經濟解釋是什麼？', authorName: '阿明', postedAt: D(-3), replyCount: 4, viewCount: 28, hasTeacherEndorsement: true },
  { id: 70202, courseId: 71393, title: '整數規劃 vs 線性規劃應用情境', authorName: '康贊清（老師）', postedAt: D(-7), replyCount: 9, viewCount: 56, hasTeacherEndorsement: true },
];

// ─────────────────────────────────────────────────────────
// 互評
// ─────────────────────────────────────────────────────────

export const DEMO_PEER_REVIEWS: MockPeerReview[] = [
  { id: 80001, courseId: 71378, assignmentTitle: 'HW3 K-means 互評', targetAnonymousName: '匿名同學 A', submitted: false, dueAt: D(5) },
  { id: 80002, courseId: 71378, assignmentTitle: 'HW3 K-means 互評', targetAnonymousName: '匿名同學 B', submitted: true, dueAt: D(5) },
  { id: 80101, courseId: 71393, assignmentTitle: '對偶問題互評', targetAnonymousName: '匿名同學 C', submitted: false, dueAt: D(3) },
];

// ─────────────────────────────────────────────────────────
// 評分項目（用於成績總覽加權計算）
// ─────────────────────────────────────────────────────────

export const DEMO_SCORE_ITEMS: MockScoreItem[] = [
  // 機器學習：作業 30% + 期中 30% + 期末專題 30% + 出席 10%
  { id: 91001, courseId: 71378, name: '作業（4 份平均）', type: 'homework', weight: 30, studentScore: 92, totalScore: 100 },
  { id: 91002, courseId: 71378, name: '期中考', type: 'exam', weight: 30, studentScore: 87, totalScore: 100 },
  { id: 91003, courseId: 71378, name: '期末微專題', type: 'exam', weight: 30, studentScore: null, totalScore: 100 },
  { id: 91004, courseId: 71378, name: '出席與參與', type: 'attendance', weight: 10, studentScore: 95, totalScore: 100 },
  // 計概二
  { id: 92001, courseId: 71282, name: '作業（3 份）', type: 'homework', weight: 30, studentScore: 85, totalScore: 100 },
  { id: 92002, courseId: 71282, name: '期中考', type: 'exam', weight: 35, studentScore: 79, totalScore: 100 },
  { id: 92003, courseId: 71282, name: '期末考', type: 'exam', weight: 35, studentScore: null, totalScore: 100 },
  // 資訊數學二
  { id: 93001, courseId: 71240, name: '作業', type: 'homework', weight: 40, studentScore: 78, totalScore: 100 },
  { id: 93002, courseId: 71240, name: '期中考', type: 'exam', weight: 30, studentScore: null, totalScore: 100 },
  { id: 93003, courseId: 71240, name: '期末考', type: 'exam', weight: 30, studentScore: null, totalScore: 100 },
  // 作業研究
  { id: 94001, courseId: 71393, name: '作業（5 份）', type: 'homework', weight: 25, studentScore: 83, totalScore: 100 },
  { id: 94002, courseId: 71393, name: '期中考', type: 'exam', weight: 30, studentScore: 68, totalScore: 100 },
  { id: 94003, courseId: 71393, name: '期末考', type: 'exam', weight: 35, studentScore: null, totalScore: 100 },
  { id: 94004, courseId: 71393, name: '參與', type: 'participation', weight: 10, studentScore: 90, totalScore: 100 },
  // 關愛家園
  { id: 95001, courseId: 77418, name: '心得與行動', type: 'homework', weight: 60, studentScore: null, totalScore: 100 },
  { id: 95002, courseId: 77418, name: '參與', type: 'participation', weight: 40, studentScore: 90, totalScore: 100 },
];

// ─────────────────────────────────────────────────────────
// 點名 sessions（含個人狀態）
// ─────────────────────────────────────────────────────────

export const DEMO_ATTENDANCE: MockAttendanceSession[] = [
  // 機器學習 12 週
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((week, i) => ({
    id: `att_71378_w${week}`,
    courseId: 71378,
    startedAt: D(-7 * (12 - week)),
    active: false,
    attendeeCount: 24 + (i % 3),
    totalCount: 26,
    myStatus: (week === 4 ? 'absent' : week === 8 ? 'late' : 'present') as 'present' | 'late' | 'absent',
    mode: 'rotating_qr' as const,
  })),
  // 計概二 10 週
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((week, i) => ({
    id: `att_71282_w${week}`,
    courseId: 71282,
    startedAt: D(-7 * (10 - week)),
    active: false,
    attendeeCount: 35 + (i % 4),
    totalCount: 38,
    myStatus: (week === 6 ? 'late' : 'present') as 'present' | 'late',
    mode: 'number_code' as const,
  })),
  // 作業研究 11 週
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((week, i) => ({
    id: `att_71393_w${week}`,
    courseId: 71393,
    startedAt: D(-7 * (11 - week)),
    active: false,
    attendeeCount: 27 + (i % 2),
    totalCount: 28,
    myStatus: (week === 3 || week === 9 ? 'absent' : 'present') as 'present' | 'absent',
    mode: 'rotating_qr' as const,
  })),
];

// ─────────────────────────────────────────────────────────
// 公告
// ─────────────────────────────────────────────────────────

export const DEMO_ANNOUNCEMENTS: MockAnnouncement[] = [
  { id: 100001, courseId: 71378, title: '【重要】期末微專題說明會', content: '5/20 第五堂課公布期末微專題題目與評分標準，務必到場。', postedAt: D(-1), isImportant: true },
  { id: 100002, courseId: 71378, title: 'HW4 MNIST 截止延長至 5/15', content: '考慮 Anaconda 環境設定有同學遇到困難，作業截止延長兩天。', postedAt: D(-3), isImportant: false },
  { id: 100101, courseId: 71282, title: '單元三補充教材已上傳', content: '加密演算法的補充資料請至教材區下載。', postedAt: D(-2), isImportant: false },
  { id: 100201, courseId: 71393, title: '【重要】作研期末考時間異動', content: '原定 6/10 期末考改為 6/12，時間 09:00-11:00。', postedAt: D(-5), isImportant: true },
];

// ─────────────────────────────────────────────────────────
// 快取查詢 helpers
// ─────────────────────────────────────────────────────────

export function getDemoCourseById(id: number): MockCourse | undefined {
  return DEMO_COURSES.find((c) => c.id === id);
}

export function getDemoModulesByCourse(courseId: number): MockModule[] {
  return DEMO_MODULES.filter((m) => m.courseId === courseId).sort((a, b) => a.sort - b.sort);
}

export function getDemoMaterialsByCourse(courseId: number): MockMaterial[] {
  return DEMO_MATERIALS.filter((m) => m.courseId === courseId);
}

export function getDemoHomeworksByCourse(courseId: number): MockHomework[] {
  return DEMO_HOMEWORKS.filter((h) => h.courseId === courseId);
}

export function getDemoExamsByCourse(courseId: number): MockExam[] {
  return DEMO_EXAMS.filter((e) => e.courseId === courseId);
}

export function getDemoDiscussionsByCourse(courseId: number): MockDiscussion[] {
  return DEMO_DISCUSSIONS.filter((d) => d.courseId === courseId);
}

export function getDemoPeerReviewsByCourse(courseId: number): MockPeerReview[] {
  return DEMO_PEER_REVIEWS.filter((p) => p.courseId === courseId);
}

export function getDemoScoreItemsByCourse(courseId: number): MockScoreItem[] {
  return DEMO_SCORE_ITEMS.filter((s) => s.courseId === courseId);
}

export function getDemoAttendanceByCourse(courseId: number): MockAttendanceSession[] {
  return DEMO_ATTENDANCE.filter((a) => a.courseId === courseId);
}

export function getDemoAnnouncementsByCourse(courseId: number): MockAnnouncement[] {
  return DEMO_ANNOUNCEMENTS.filter((a) => a.courseId === courseId);
}

/** 計算該課程的加權成績預估（用於 CourseScoresScreen 顯示） */
export function computeDemoWeightedScore(courseId: number): {
  weighted: number | null;
  graded: number;
  total: number;
} {
  const items = getDemoScoreItemsByCourse(courseId);
  let earned = 0;
  let used = 0;
  let graded = 0;
  for (const it of items) {
    if (it.studentScore !== null && it.totalScore > 0) {
      earned += (it.studentScore / it.totalScore) * it.weight;
      used += it.weight;
      graded += 1;
    }
  }
  return {
    weighted: used > 0 ? Math.round((earned / used) * 100 * 10) / 10 : null,
    graded,
    total: items.length,
  };
}
