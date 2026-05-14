/**
 * Discussion Engine — TronClass parity P1-8
 *
 * 計算課程討論串的熱度、回答品質、合作精神分。
 * 純函式。
 */

export interface DiscussionReply {
  id: string;
  authorUid: string;
  /** ISO datetime */
  postedAt: string;
  textLength: number;
  upvotes: number;
  /** 老師或學生標 useful 的次數 */
  markedUseful: number;
  /** 老師認證的回答 */
  endorsedByTeacher?: boolean;
}

export interface DiscussionThread {
  id: string;
  authorUid: string;
  title: string;
  postedAt: string;
  replies: DiscussionReply[];
  viewCount: number;
  resolved?: boolean;
}

export interface ThreadMetric {
  threadId: string;
  title: string;
  heat: number; // 0-100
  resolvedScore: number; // 0-100
  topAnswerUid: string | null;
  bestReplyId: string | null;
}

export interface UserContribution {
  uid: string;
  threadsStarted: number;
  repliesPosted: number;
  totalUsefulMarks: number;
  teacherEndorsements: number;
  cooperationScore: number; // 0-100
}

/**
 * 算單一 thread 的「熱度」與「最佳回答」
 */
export function computeThreadMetric(thread: DiscussionThread): ThreadMetric {
  // heat：view + replies + upvotes
  const replyCount = thread.replies.length;
  const upvoteSum = thread.replies.reduce((a, r) => a + r.upvotes, 0);
  const heat = Math.min(
    100,
    Math.round(Math.log(1 + thread.viewCount) * 6 + replyCount * 4 + upvoteSum * 2),
  );

  // resolvedScore：若有 endorsed reply 或 ≥1 useful mark 就視為已解決
  const hasEndorsed = thread.replies.some((r) => r.endorsedByTeacher);
  const totalUseful = thread.replies.reduce((a, r) => a + r.markedUseful, 0);
  const resolvedScore = hasEndorsed ? 100 : Math.min(100, totalUseful * 25);

  // bestReply：endorsed > most useful > most upvotes > longest reply
  const sorted = [...thread.replies].sort((a, b) => {
    if (a.endorsedByTeacher !== b.endorsedByTeacher) return a.endorsedByTeacher ? -1 : 1;
    if (a.markedUseful !== b.markedUseful) return b.markedUseful - a.markedUseful;
    if (a.upvotes !== b.upvotes) return b.upvotes - a.upvotes;
    return b.textLength - a.textLength;
  });
  const best = sorted[0] ?? null;

  return {
    threadId: thread.id,
    title: thread.title,
    heat,
    resolvedScore,
    topAnswerUid: best?.authorUid ?? null,
    bestReplyId: best?.id ?? null,
  };
}

/**
 * 算每個使用者在這批 threads 內的合作精神分
 */
export function computeUserContributions(threads: DiscussionThread[]): UserContribution[] {
  const map = new Map<string, UserContribution>();
  function getOrInit(uid: string): UserContribution {
    let u = map.get(uid);
    if (!u) {
      u = {
        uid,
        threadsStarted: 0,
        repliesPosted: 0,
        totalUsefulMarks: 0,
        teacherEndorsements: 0,
        cooperationScore: 0,
      };
      map.set(uid, u);
    }
    return u;
  }

  for (const t of threads) {
    const author = getOrInit(t.authorUid);
    author.threadsStarted += 1;
    for (const r of t.replies) {
      const a = getOrInit(r.authorUid);
      a.repliesPosted += 1;
      a.totalUsefulMarks += r.markedUseful;
      if (r.endorsedByTeacher) a.teacherEndorsements += 1;
    }
  }

  // 合作精神分：30% 提問 + 40% 回答 + 20% 有用 + 10% 老師認證
  for (const u of map.values()) {
    const ask = Math.min(u.threadsStarted, 5) * 6; // 0-30
    const ans = Math.min(u.repliesPosted, 8) * 5; // 0-40
    const useful = Math.min(u.totalUsefulMarks, 4) * 5; // 0-20
    const endorsed = Math.min(u.teacherEndorsements, 2) * 5; // 0-10
    u.cooperationScore = Math.min(100, ask + ans + useful + endorsed);
  }

  return Array.from(map.values()).sort((a, b) => b.cooperationScore - a.cooperationScore);
}
