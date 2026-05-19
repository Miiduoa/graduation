/**
 * 校園社群 — 課程評價（Firestore-backed）
 *
 * 取代 studyBuddyEngine.ts 內舊版的 AsyncStorage 寫法 —— 那種設計只在本機
 * 留下個人評價，無法被同學看到，不是「社群評價」。
 *
 * Schema:
 *   schools/{schoolId}/courseReviews/{autoId}
 *     - courseCode: string
 *     - courseName: string
 *     - rating | difficulty | workload | usefulness: 1..5
 *     - comment: string
 *     - sentiment: 'positive' | 'neutral' | 'negative'
 *     - sentimentScore: -1..1
 *     - tags: string[]
 *     - authorUid: string
 *     - anonymous: boolean
 *     - aliasSnapshot?: string
 *     - createdAt: Timestamp
 *     - helpful: number
 *     - helpfulBy: string[]
 */
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { getDb } from '../firebase';

export type CourseReviewSentiment = 'positive' | 'neutral' | 'negative';

export type CourseReviewDoc = {
  id: string;
  courseCode: string;
  courseName: string;
  rating: number;
  difficulty: number;
  workload: number;
  usefulness: number;
  comment: string;
  sentiment: CourseReviewSentiment;
  sentimentScore: number;
  tags: string[];
  authorUid?: string | null;
  anonymous: boolean;
  aliasSnapshot?: string | null;
  helpful?: number;
  helpfulBy?: string[];
  createdAt?: Timestamp | Date | unknown;
};

function reviewsCol(db: Firestore, schoolId: string) {
  return collection(db, 'schools', schoolId, 'courseReviews');
}

/** 簡化的情緒分類（中文常見正負詞） */
export function analyzeReviewSentiment(comment: string): {
  sentiment: CourseReviewSentiment;
  score: number;
} {
  const text = comment.toLowerCase();
  const positives = ['推', '讚', '不錯', '好', '收穫', '實用', '清楚', '有趣', '硬要說推', 'good'];
  const negatives = ['雷', '爛', '糟', '無聊', '不推', '混', '太難', '當掉', '無料', 'bad'];
  let score = 0;
  for (const k of positives) if (text.includes(k)) score += 1;
  for (const k of negatives) if (text.includes(k)) score -= 1;
  if (score > 0) return { sentiment: 'positive', score: Math.min(1, score / 3) };
  if (score < 0) return { sentiment: 'negative', score: Math.max(-1, score / 3) };
  return { sentiment: 'neutral', score: 0 };
}

export async function submitCourseReview(input: {
  schoolId: string;
  courseCode: string;
  courseName: string;
  rating: number;
  difficulty: number;
  workload: number;
  usefulness: number;
  comment: string;
  tags?: string[];
  anonymous?: boolean;
  authorUid?: string | null;
  aliasSnapshot?: string;
}): Promise<string> {
  const db = getDb();
  const ref = reviewsCol(db, input.schoolId);
  const { sentiment, score } = analyzeReviewSentiment(input.comment);
  const docRef = await addDoc(ref, {
    courseCode: input.courseCode,
    courseName: input.courseName,
    rating: clamp(input.rating, 0, 5),
    difficulty: clamp(input.difficulty, 0, 5),
    workload: clamp(input.workload, 0, 5),
    usefulness: clamp(input.usefulness, 0, 5),
    comment: input.comment.trim(),
    sentiment,
    sentimentScore: score,
    tags: dedupe((input.tags ?? []).map((t) => t.trim()).filter(Boolean)).slice(0, 6),
    anonymous: input.anonymous ?? true,
    authorUid: input.anonymous ? null : (input.authorUid ?? null),
    aliasSnapshot: input.anonymous ? (input.aliasSnapshot ?? '匿名同學') : null,
    helpful: 0,
    helpfulBy: [],
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function listCourseReviews(
  schoolId: string,
  opts?: { courseCode?: string; courseName?: string; lim?: number },
): Promise<CourseReviewDoc[]> {
  const db = getDb();
  const max = opts?.lim ?? 80;
  try {
    const filters: any[] = [];
    if (opts?.courseCode) filters.push(where('courseCode', '==', opts.courseCode));
    if (opts?.courseName && !opts.courseCode) filters.push(where('courseName', '==', opts.courseName));
    const snap = await getDocs(
      query(reviewsCol(db, schoolId), ...filters, orderBy('createdAt', 'desc'), limit(max)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CourseReviewDoc, 'id'>) }));
  } catch {
    // 缺索引時降級為不排序、必要時前端排序
    const snap = await getDocs(query(reviewsCol(db, schoolId), limit(Math.min(max, 50))));
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CourseReviewDoc, 'id'>) }));
    return rows.filter((r) => {
      if (opts?.courseCode && r.courseCode !== opts.courseCode) return false;
      if (opts?.courseName && r.courseName !== opts.courseName) return false;
      return true;
    });
  }
}

export type CourseReviewAggregate = {
  totalCount: number;
  avgRating: number;
  avgDifficulty: number;
  avgWorkload: number;
  avgUsefulness: number;
  sentiment: { positive: number; neutral: number; negative: number };
  topTags: { tag: string; count: number }[];
};

export function aggregateReviews(rows: CourseReviewDoc[]): CourseReviewAggregate {
  if (rows.length === 0) {
    return {
      totalCount: 0,
      avgRating: 0,
      avgDifficulty: 0,
      avgWorkload: 0,
      avgUsefulness: 0,
      sentiment: { positive: 0, neutral: 0, negative: 0 },
      topTags: [],
    };
  }
  const sum = rows.reduce(
    (acc, r) => {
      acc.rating += r.rating;
      acc.difficulty += r.difficulty;
      acc.workload += r.workload;
      acc.usefulness += r.usefulness;
      acc.sentiment[r.sentiment] = (acc.sentiment[r.sentiment] ?? 0) + 1;
      for (const t of r.tags ?? []) acc.tagCounts.set(t, (acc.tagCounts.get(t) ?? 0) + 1);
      return acc;
    },
    {
      rating: 0,
      difficulty: 0,
      workload: 0,
      usefulness: 0,
      sentiment: { positive: 0, neutral: 0, negative: 0 } as Record<CourseReviewSentiment, number>,
      tagCounts: new Map<string, number>(),
    },
  );
  const n = rows.length;
  return {
    totalCount: n,
    avgRating: round1(sum.rating / n),
    avgDifficulty: round1(sum.difficulty / n),
    avgWorkload: round1(sum.workload / n),
    avgUsefulness: round1(sum.usefulness / n),
    sentiment: sum.sentiment,
    topTags: [...sum.tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };
}

export async function toggleReviewHelpful(schoolId: string, reviewId: string, uid: string) {
  const db = getDb();
  const ref = doc(db, 'schools', schoolId, 'courseReviews', reviewId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('評價不存在');
    const data = snap.data() as Record<string, unknown>;
    const arr = Array.isArray(data.helpfulBy) ? (data.helpfulBy as string[]) : [];
    if (arr.includes(uid)) {
      tx.update(ref, { helpfulBy: arrayRemove(uid), helpful: increment(-1) });
    } else {
      tx.update(ref, { helpfulBy: arrayUnion(uid), helpful: increment(1) });
    }
  });
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
