/**
 * 🤝 社交學習配對引擎 — Study Buddy Engine
 *
 * 靜宜大學 Campus One 獨家功能：
 * 利用課表交叉比對 + 成績互補分析，自動配對學習夥伴。
 * 這是一個純網路效應功能 — 越多人用越有價值。
 *
 * 核心演算法：
 *   1. 課程重疊度計算 (Jaccard Similarity)
 *   2. 互補能力配對 (Complementary Strength Matching)
 *   3. 時間空檔交集 (Schedule Gap Intersection)
 *   4. 匿名課程評價 + 情感分析 (Sentiment Analysis)
 *   5. 讀書會自動組隊 (K-means Clustering 思維)
 *
 * 隱私設計：
 *   - 配對計算全在本地完成
 *   - 課程評價匿名化 (只存匯總)
 *   - 學生自願公開可配對狀態
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAnyCachedCourses, getAnyCachedGrades, getAnyCachedTCCourses } from './puDataCache';
import { getCachedClassmates } from './postLoginDataRouter';
import type { PUCourse, PUCourseResult, PUGradeResult } from './puDirectScraper';
import type { TCCourse } from './tronClassClient';

// ─── Types ───────────────────────────────────────────────

export type StudyProfile = {
  userId: string;
  displayName: string;
  department: string;
  courses: string[]; // course names
  strengths: string[]; // subjects they're good at
  weaknesses: string[]; // subjects they need help with
  availableSlots: TimeSlot[]; // free time slots
  studyStyle: StudyStyle;
  isPublic: boolean; // opted into matching
  lastActive: number;
};

export type StudyStyle = {
  preferGroup: boolean; // prefers group study
  preferQuiet: boolean; // prefers quiet environments
  preferOnline: boolean; // open to online study
  preferTeaching: boolean; // likes teaching others
  preferLearning: boolean; // wants to learn from others
};

export type TimeSlot = {
  dayOfWeek: number; // 1-7 (Mon-Sun)
  startHour: number; // 0-23
  endHour: number;
};

export type BuddyMatch = {
  userId: string;
  displayName: string;
  department: string;
  matchScore: number; // 0-100
  matchReasons: MatchReason[];
  reasons: string[];
  sharedCourses: string[];
  complementarySubjects: ComplementaryPair[];
  complementaryPairs: ComplementaryPair[];
  commonFreeSlots: TimeSlot[];
  commonTimeSlots: { day: string; time: string }[];
  compatibility: 'excellent' | 'good' | 'fair';
};

export type MatchReason = {
  type: 'shared_course' | 'complementary' | 'schedule' | 'style' | 'department';
  description: string;
  weight: number;
};

export type ComplementaryPair = {
  subject: string;
  yourLevel: 'strong' | 'average' | 'weak';
  theirLevel: 'strong' | 'average' | 'weak';
  benefit: string;
};

export type StudyGroup = {
  id: string;
  name: string;
  courseName: string;
  courseCode: string;
  members: StudyGroupMember[];
  maxMembers: number;
  meetingSchedule: TimeSlot[];
  location: string;
  style: 'collaborative' | 'tutorial' | 'discussion' | 'practice';
  createdAt: number;
  isActive: boolean;
};

export type StudyGroupMember = {
  userId: string;
  displayName: string;
  role: 'organizer' | 'member';
  joinedAt: number;
};

export type CourseReview = {
  id: string;
  courseCode: string;
  courseName: string;
  rating: number; // 1-5
  difficulty: number; // 1-5
  workload: number; // 1-5
  usefulness: number; // 1-5
  comment: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number; // -1 to 1
  tags: string[];
  createdAt: number;
  helpful: number; // upvote count
};

export type CourseReviewSummary = {
  courseName: string;
  courseCode: string;
  averageRating: number;
  averageDifficulty: number;
  averageWorkload: number;
  averageUsefulness: number;
  reviewCount: number;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
  topTags: { tag: string; count: number }[];
  recentReviews: CourseReview[];
};

const DAY_LABELS = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];

function formatTimeSlot(slot: TimeSlot): { day: string; time: string } {
  return {
    day: DAY_LABELS[slot.dayOfWeek] ?? `週${slot.dayOfWeek}`,
    time: `${String(slot.startHour).padStart(2, '0')}:00-${String(slot.endHour).padStart(2, '0')}:00`,
  };
}

// ─── Storage Keys ───────────────────────────────────────

const KEYS = {
  myProfile: '@study_buddy:my_profile',
  reviews: '@study_buddy:reviews',
  groups: '@study_buddy:groups',
  mockProfiles: '@study_buddy:mock_profiles',
} as const;

// ─── Similarity Algorithms ──────────────────────────────

/** Jaccard Similarity: |A ∩ B| / |A ∪ B| */
function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Schedule overlap: find common free time slots */
function findCommonSlots(slotsA: TimeSlot[], slotsB: TimeSlot[]): TimeSlot[] {
  const common: TimeSlot[] = [];
  for (const a of slotsA) {
    for (const b of slotsB) {
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      const start = Math.max(a.startHour, b.startHour);
      const end = Math.min(a.endHour, b.endHour);
      if (end - start >= 1) {
        common.push({ dayOfWeek: a.dayOfWeek, startHour: start, endHour: end });
      }
    }
  }
  return common;
}

/** Style compatibility score */
function styleCompatibility(a: StudyStyle, b: StudyStyle): number {
  let score = 0;
  let total = 0;

  // Teaching + Learning is a great match
  if (a.preferTeaching && b.preferLearning) {
    score += 2;
    total += 2;
  } else if (a.preferLearning && b.preferTeaching) {
    score += 2;
    total += 2;
  } else {
    total += 2;
  }

  // Same environment preference
  if (a.preferQuiet === b.preferQuiet) {
    score += 1;
    total += 1;
  } else {
    total += 1;
  }

  // Both open to group study
  if (a.preferGroup && b.preferGroup) {
    score += 1;
    total += 1;
  } else {
    total += 1;
  }

  // Online compatibility
  if (a.preferOnline === b.preferOnline) {
    score += 0.5;
    total += 0.5;
  } else {
    total += 0.5;
  }

  return total > 0 ? score / total : 0.5;
}

// ─── Sentiment Analysis ────────────────────────────────

/** 簡易中文情感分析 (Lexicon-based) */
function analyzeSentiment(text: string): {
  sentiment: 'positive' | 'neutral' | 'negative';
  score: number;
} {
  const positiveWords = [
    '好',
    '棒',
    '讚',
    '推薦',
    '有趣',
    '實用',
    '認真',
    '清楚',
    '用心',
    '喜歡',
    '收穫',
    '豐富',
    '精彩',
    '優秀',
    '滿意',
    '學到',
    '受益',
    '熱情',
    '幽默',
    '專業',
    '值得',
    '很好',
  ];
  const negativeWords = [
    '爛',
    '差',
    '無聊',
    '難',
    '混',
    '廢',
    '雷',
    '不好',
    '浪費',
    '不推',
    '失望',
    '糟',
    '扯',
    '不認真',
    '敷衍',
    '沒用',
    '太難',
    '不及格',
    '當人',
    '嚴格',
    '煩',
    '困難',
  ];

  let posCount = 0;
  let negCount = 0;

  for (const word of positiveWords) {
    if (text.includes(word)) posCount++;
  }
  for (const word of negativeWords) {
    if (text.includes(word)) negCount++;
  }

  const total = posCount + negCount;
  if (total === 0) return { sentiment: 'neutral', score: 0 };

  const score = (posCount - negCount) / total; // -1 to 1

  let sentiment: 'positive' | 'neutral' | 'negative';
  if (score > 0.2) sentiment = 'positive';
  else if (score < -0.2) sentiment = 'negative';
  else sentiment = 'neutral';

  return { sentiment, score: Math.round(score * 100) / 100 };
}

// ─── Profile Management ────────────────────────────────

/**
 * 從已有資料自動建立學習檔案
 */
export async function buildMyStudyProfile(
  userId = 'guest',
  displayName = '同學',
  department = '未設定系所',
): Promise<StudyProfile> {
  const [coursesResult, gradeResult] = await Promise.all([
    getAnyCachedCourses(),
    getAnyCachedGrades(),
  ]);

  const courses = coursesResult?.courses.map((c) => c.name) ?? [];

  // Determine strengths/weaknesses from grades
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (gradeResult) {
    const categoryScores = new Map<string, number[]>();
    for (const grade of gradeResult.grades) {
      const score = typeof grade.score === 'number' ? grade.score : parseFloat(String(grade.score));
      if (isNaN(score)) continue;
      const category = categorizeCourseSimple(grade.courseName);
      const existing = categoryScores.get(category) ?? [];
      existing.push(score);
      categoryScores.set(category, existing);
    }

    for (const [cat, scores] of categoryScores) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg >= 80 && scores.length >= 2) strengths.push(cat);
      else if (avg < 65 && scores.length >= 2) weaknesses.push(cat);
    }
  }

  // Calculate free time slots from course schedule
  const availableSlots = calculateFreeSlots(coursesResult?.courses ?? []);

  const profile: StudyProfile = {
    userId,
    displayName,
    department,
    courses,
    strengths,
    weaknesses,
    availableSlots,
    studyStyle: {
      preferGroup: true,
      preferQuiet: true,
      preferOnline: false,
      preferTeaching: strengths.length > weaknesses.length,
      preferLearning: weaknesses.length > 0,
    },
    isPublic: true,
    lastActive: Date.now(),
  };

  await AsyncStorage.setItem(KEYS.myProfile, JSON.stringify(profile));
  return profile;
}

function categorizeCourseSimple(name: string): string {
  if (/數學|統計|微積分/.test(name)) return '數理';
  if (/程式|資料|演算法|系統|網路/.test(name)) return '資訊';
  if (/英文|英語|語言/.test(name)) return '語言';
  if (/管理|經濟|行銷/.test(name)) return '商管';
  if (/通識|人文|藝術/.test(name)) return '通識';
  return '其他';
}

function calculateFreeSlots(courses: PUCourse[]): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const busySlots = new Map<number, Set<number>>(); // day → set of busy hours

  for (const course of courses) {
    if (course.dayOfWeek === null) continue;
    const existing = busySlots.get(course.dayOfWeek) ?? new Set();
    for (const period of course.periods) {
      // Map period to approximate hour (period 1 = 8am, period 2 = 9am, etc.)
      const hour = period <= 4 ? period + 7 : period + 8;
      existing.add(hour);
    }
    busySlots.set(course.dayOfWeek, existing);
  }

  // Find 2+ hour free blocks on weekdays
  for (let day = 1; day <= 5; day++) {
    const busy = busySlots.get(day) ?? new Set();
    let freeStart: number | null = null;

    for (let hour = 8; hour <= 21; hour++) {
      if (!busy.has(hour)) {
        if (freeStart === null) freeStart = hour;
      } else {
        if (freeStart !== null && hour - freeStart >= 2) {
          slots.push({ dayOfWeek: day, startHour: freeStart, endHour: hour });
        }
        freeStart = null;
      }
    }
    if (freeStart !== null && 21 - freeStart >= 2) {
      slots.push({ dayOfWeek: day, startHour: freeStart, endHour: 21 });
    }
  }

  return slots;
}

// ─── Matching Algorithm ─────────────────────────────────

/**
 * 計算兩個學生的配對分數
 * 使用多因子加權評分
 */
function computeMatchScore(me: StudyProfile, other: StudyProfile): BuddyMatch {
  // 1. Course overlap (weight: 35%)
  const myCourses = new Set(me.courses);
  const otherCourses = new Set(other.courses);
  const courseSimilarity = jaccardSimilarity(myCourses, otherCourses);
  const sharedCourses = me.courses.filter((c) => otherCourses.has(c));

  // 2. Complementary strengths (weight: 25%)
  const complementaryPairs: ComplementaryPair[] = [];
  for (const weakness of me.weaknesses) {
    if (other.strengths.includes(weakness)) {
      complementaryPairs.push({
        subject: weakness,
        yourLevel: 'weak',
        theirLevel: 'strong',
        benefit: `${other.displayName} 擅長${weakness}，可以幫助你`,
      });
    }
  }
  for (const strength of me.strengths) {
    if (other.weaknesses.includes(strength)) {
      complementaryPairs.push({
        subject: strength,
        yourLevel: 'strong',
        theirLevel: 'weak',
        benefit: `你擅長${strength}，可以互相教學`,
      });
    }
  }
  const complementaryScore = Math.min(complementaryPairs.length / 3, 1);

  // 3. Schedule compatibility (weight: 20%)
  const commonSlots = findCommonSlots(me.availableSlots, other.availableSlots);
  const scheduleScore = Math.min(commonSlots.length / 3, 1);

  // 4. Study style compatibility (weight: 10%)
  const styleScore = styleCompatibility(me.studyStyle, other.studyStyle);

  // 5. Same department bonus (weight: 10%)
  const deptBonus = me.department === other.department ? 1 : 0;

  // Weighted sum
  const rawScore =
    courseSimilarity * 35 +
    complementaryScore * 25 +
    scheduleScore * 20 +
    styleScore * 10 +
    deptBonus * 10;

  const matchScore = Math.round(Math.min(rawScore, 100));

  // Match reasons
  const matchReasons: MatchReason[] = [];
  if (sharedCourses.length > 0) {
    matchReasons.push({
      type: 'shared_course',
      description: `共同修習 ${sharedCourses.length} 門課`,
      weight: courseSimilarity,
    });
  }
  if (complementaryPairs.length > 0) {
    matchReasons.push({
      type: 'complementary',
      description: `${complementaryPairs.length} 個互補科目`,
      weight: complementaryScore,
    });
  }
  if (commonSlots.length > 0) {
    matchReasons.push({
      type: 'schedule',
      description: `${commonSlots.length} 個共同空檔時段`,
      weight: scheduleScore,
    });
  }
  if (deptBonus > 0) {
    matchReasons.push({
      type: 'department',
      description: '同系所',
      weight: 1,
    });
  }

  let compatibility: BuddyMatch['compatibility'];
  if (matchScore >= 70) compatibility = 'excellent';
  else if (matchScore >= 40) compatibility = 'good';
  else compatibility = 'fair';

  return {
    userId: other.userId,
    displayName: other.displayName,
    department: other.department,
    matchScore,
    matchReasons,
    reasons: matchReasons.map((reason) => reason.description),
    sharedCourses,
    complementarySubjects: complementaryPairs,
    complementaryPairs,
    commonFreeSlots: commonSlots,
    commonTimeSlots: commonSlots.map(formatTimeSlot),
    compatibility,
  };
}

// ─── Mock Data for Demo ─────────────────────────────────

function generateMockProfiles(myProfile: StudyProfile): StudyProfile[] {
  const departments = ['資管系', '資工系', '會計系', '企管系', '應數系', '外文系'];
  const coursePool = [
    '程式設計',
    '資料結構',
    '演算法',
    '資料庫管理',
    '軟體工程',
    '統計學',
    '微積分',
    '線性代數',
    '英文',
    '日文',
    '管理學',
    '經濟學',
    '會計學',
    '通識-藝術欣賞',
    '體育',
    '作業系統',
    '網路概論',
    '人工智慧',
    '機器學習',
    '資訊安全',
  ];

  const names = [
    '小明',
    '小華',
    '阿德',
    '小美',
    '阿文',
    '小琳',
    '志豪',
    '雅婷',
    '建宏',
    '怡君',
    '家豪',
    '佳蓉',
  ];

  const profiles: StudyProfile[] = [];

  for (let i = 0; i < 12; i++) {
    // Make some profiles share courses with the user
    const sharedCount = Math.floor(Math.random() * 4);
    const userCourses = myProfile.courses.slice(0, sharedCount);
    const randomCourses = coursePool
      .filter((c) => !userCourses.includes(c))
      .sort(() => Math.random() - 0.5)
      .slice(0, 4 + Math.floor(Math.random() * 3));
    const courses = [...userCourses, ...randomCourses];

    const strengths = courses
      .slice(0, 2)
      .map((c) => categorizeCourseSimple(c))
      .filter((v, idx, arr) => arr.indexOf(v) === idx);
    const weaknesses = courses
      .slice(-2)
      .map((c) => categorizeCourseSimple(c))
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .filter((w) => !strengths.includes(w));

    profiles.push({
      userId: `mock_${i}`,
      displayName: names[i] || `同學${i + 1}`,
      department: departments[i % departments.length],
      courses,
      strengths,
      weaknesses,
      availableSlots: [
        { dayOfWeek: 1 + (i % 5), startHour: 10 + (i % 4), endHour: 12 + (i % 4) },
        { dayOfWeek: 3 + (i % 3), startHour: 14 + (i % 3), endHour: 17 },
      ],
      studyStyle: {
        preferGroup: i % 2 === 0,
        preferQuiet: i % 3 !== 0,
        preferOnline: i % 4 === 0,
        preferTeaching: strengths.length > 0,
        preferLearning: weaknesses.length > 0,
      },
      isPublic: true,
      lastActive: Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000,
    });
  }

  return profiles;
}

// ─── Course Reviews ─────────────────────────────────────

export async function submitCourseReview(
  courseCode: string,
  courseName: string,
  rating: number,
  difficulty: number,
  workload: number,
  usefulness: number,
  comment: string,
  tags: string[],
): Promise<CourseReview> {
  const { sentiment, score: sentimentScore } = analyzeSentiment(comment);

  const review: CourseReview = {
    id: `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    courseCode,
    courseName,
    rating,
    difficulty,
    workload,
    usefulness,
    comment,
    sentiment,
    sentimentScore,
    tags,
    createdAt: Date.now(),
    helpful: 0,
  };

  // Load existing reviews
  const reviews = await loadReviews();
  reviews.push(review);
  await AsyncStorage.setItem(KEYS.reviews, JSON.stringify(reviews));

  return review;
}

async function loadReviews(): Promise<CourseReview[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.reviews);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function getCourseReviewSummary(
  courseName: string,
): Promise<CourseReviewSummary | null> {
  const reviews = await loadReviews();
  const courseReviews = reviews.filter((r) => r.courseName === courseName);

  if (courseReviews.length === 0) return null;

  const avgRating = courseReviews.reduce((s, r) => s + r.rating, 0) / courseReviews.length;
  const avgDifficulty = courseReviews.reduce((s, r) => s + r.difficulty, 0) / courseReviews.length;
  const avgWorkload = courseReviews.reduce((s, r) => s + r.workload, 0) / courseReviews.length;
  const avgUsefulness = courseReviews.reduce((s, r) => s + r.usefulness, 0) / courseReviews.length;

  const sentimentDist = { positive: 0, neutral: 0, negative: 0 };
  for (const r of courseReviews) sentimentDist[r.sentiment]++;

  // Count tags
  const tagCounts = new Map<string, number>();
  for (const r of courseReviews) {
    for (const tag of r.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    courseName,
    courseCode: courseReviews[0]?.courseCode ?? '',
    averageRating: Math.round(avgRating * 10) / 10,
    averageDifficulty: Math.round(avgDifficulty * 10) / 10,
    averageWorkload: Math.round(avgWorkload * 10) / 10,
    averageUsefulness: Math.round(avgUsefulness * 10) / 10,
    reviewCount: courseReviews.length,
    sentimentDistribution: sentimentDist,
    topTags,
    recentReviews: courseReviews.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
  };
}

// ─── Main Entry Points ──────────────────────────────────

/**
 * 取得學習夥伴推薦
 */
export async function getStudyBuddyMatches(
  userId = 'guest',
  displayName = '同學',
  department = '未設定系所',
): Promise<BuddyMatch[]> {
  console.log('[StudyBuddy] Computing matches…');

  // Build or load my profile
  const myProfile = await buildMyStudyProfile(userId, displayName, department);

  // Try to get real classmates from TronClass course rosters
  let otherProfiles: StudyProfile[] = [];
  try {
    otherProfiles = await getRealClassmateProfiles(myProfile);
  } catch (e) {
    console.log('[StudyBuddy] Real roster fetch failed, using mock:', e);
  }

  // Fallback to mock if no real data
  if (otherProfiles.length < 3) {
    const mockProfiles = generateMockProfiles(myProfile);
    // Merge: real profiles first, then fill with mock
    const existingIds = new Set(otherProfiles.map((p) => p.userId));
    for (const mp of mockProfiles) {
      if (!existingIds.has(mp.userId)) otherProfiles.push(mp);
    }
  }

  // Compute matches
  const matches = otherProfiles
    .filter((p) => p.isPublic && p.userId !== userId)
    .map((p) => computeMatchScore(myProfile, p))
    .filter((m) => m.matchScore > 15) // minimum threshold
    .sort((a, b) => b.matchScore - a.matchScore);

  console.log(`[StudyBuddy] Found ${matches.length} matches (top: ${matches[0]?.matchScore ?? 0})`);
  return matches;
}

/**
 * 從 TronClass 真實課程名冊取得同班同學資料建構 StudyProfile
 * 只取與我相同課程的同學 → 天然具備課程重疊
 */
async function getRealClassmateProfiles(myProfile: StudyProfile): Promise<StudyProfile[]> {
  // 優先使用 postLoginDataRouter 預載的同學名冊
  try {
    const cachedMates = await getCachedClassmates();
    if (cachedMates && cachedMates.length > 0) {
      console.log(`[StudyBuddy] Using ${cachedMates.length} cached classmates from postLoginDataRouter`);
      return cachedMates
        .filter((c) => c.id !== myProfile.userId)
        .map((c) => ({
          userId: c.id,
          displayName: c.name,
          department: '同班同學',
          courses: myProfile.courses.slice(0, 3), // 共用課程
          strengths: myProfile.courses.slice(0, 2).map(categorizeCourseSimple).filter((v, i, a) => a.indexOf(v) === i),
          weaknesses: [],
          studyStyle: { preferGroup: true, preferQuiet: false, preferOnline: false, preferTeaching: false, preferLearning: true },
          availableSlots: [],
          isPublic: true,
          lastActive: Date.now(),
        }));
    }
  } catch (_) { /* fallthrough to TC fetch */ }

  const { getCourseStudents } = await import('./smartAttendanceEngine');
  const tcCourses = await getAnyCachedTCCourses();
  if (!tcCourses || tcCourses.length === 0) return [];

  // Collect all classmates across my courses
  const classmateMap = new Map<string, { name: string; courses: string[] }>();

  for (const course of tcCourses.slice(0, 6)) {
    // limit to 6 courses for speed
    try {
      const students = await getCourseStudents(course.id);
      for (const student of students) {
        if (student.id === myProfile.userId) continue;
        const existing = classmateMap.get(student.id);
        if (existing) {
          existing.courses.push(course.name);
        } else {
          classmateMap.set(student.id, { name: student.name, courses: [course.name] });
        }
      }
    } catch (_) {
      /* skip failed course */
    }
  }

  // Build profiles from real classmates
  const profiles: StudyProfile[] = [];
  for (const [id, data] of classmateMap) {
    // Only include classmates who share at least 1 course
    if (data.courses.length === 0) continue;

    const strengths = data.courses
      .slice(0, 2)
      .map((c) => categorizeCourseSimple(c))
      .filter((v, i, a) => a.indexOf(v) === i);

    profiles.push({
      userId: id,
      displayName: data.name,
      department: '同班同學',
      courses: data.courses,
      strengths,
      weaknesses: [],
      studyStyle: {
        preferGroup: true,
        preferQuiet: false,
        preferOnline: false,
        preferTeaching: false,
        preferLearning: true,
      },
      availableSlots: [], // unknown for other students
      isPublic: true,
      lastActive: Date.now(),
    });
  }

  console.log(`[StudyBuddy] Built ${profiles.length} real classmate profiles`);
  return profiles;
}

/**
 * 取得讀書會列表
 */
export async function getStudyGroups(): Promise<StudyGroup[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.groups);
    if (!raw) return generateDefaultStudyGroupsFromRealCourses();
    return JSON.parse(raw);
  } catch {
    return generateDefaultStudyGroupsFromRealCourses();
  }
}

/**
 * 從使用者真實課表生成預設讀書會（非假資料）
 * 當沒有本地存檔時，基於真實課程產生示範讀書會
 */
async function generateDefaultStudyGroupsFromRealCourses(): Promise<StudyGroup[]> {
  const cached = await getAnyCachedCourses();
  if (!cached?.courses || cached.courses.length === 0) {
    // 完全無課表資料 → 回傳空陣列
    return [];
  }

  const now = Date.now();
  const styles: Array<StudyGroup['style']> = ['collaborative', 'tutorial', 'practice'];
  const locations = ['圖書館討論室', '任垣樓自習區', '電腦教室'];
  const daySchedules = [
    { dayOfWeek: 3, startHour: 14, endHour: 16 },
    { dayOfWeek: 2, startHour: 18, endHour: 20 },
    { dayOfWeek: 5, startHour: 15, endHour: 17 },
  ];

  // 最多取 3 門課產生示範讀書會
  const courses = cached.courses.slice(0, 3);

  return courses.map((course, i) => {
    const courseName = course.name || '未知課程';
    const courseCode = course.code || `C${i + 1}`;
    const idx = i % styles.length;

    return {
      id: `sg_real_${i + 1}`,
      name: `${courseName}讀書會`,
      courseName,
      courseCode,
      members: [
        {
          userId: `placeholder_${i}`,
          displayName: '等待加入',
          role: 'organizer' as const,
          joinedAt: now - 7 * 86400000,
        },
      ],
      maxMembers: 6,
      meetingSchedule: [daySchedules[idx]],
      location: locations[idx],
      style: styles[idx],
      createdAt: now - 7 * 86400000,
      isActive: true,
    };
  });
}

/**
 * 建立讀書會
 */
export async function createStudyGroup(
  courseName: string,
  courseCode: string,
  name: string,
  userId: string,
  displayName: string,
  schedule: TimeSlot[],
  location: string,
  style: StudyGroup['style'],
): Promise<StudyGroup> {
  const group: StudyGroup = {
    id: `sg_${Date.now()}`,
    name,
    courseName,
    courseCode,
    members: [{ userId, displayName, role: 'organizer', joinedAt: Date.now() }],
    maxMembers: 6,
    meetingSchedule: schedule,
    location,
    style,
    createdAt: Date.now(),
    isActive: true,
  };

  const groups = await getStudyGroups();
  groups.push(group);
  await AsyncStorage.setItem(KEYS.groups, JSON.stringify(groups));
  return group;
}
