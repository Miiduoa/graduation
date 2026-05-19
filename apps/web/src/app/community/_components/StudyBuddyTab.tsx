'use client';

/**
 * 校園社群 — 學伴（Web）
 *
 * 與 mobile/StudyBuddyPanel 對齊：
 *  - 課程評價（Firestore-backed）：列表、聚合、有幫助 toggle、撰寫評價
 *  - 讀書會：因 web 端沒有 TronClass 課表來源、無法自動配對學伴，因此提供
 *    「跨平台讀書會列表」並讓使用者透過 Modal 建立；資料寫到
 *    schools/{sid}/studyGroups（與 mobile 端 studyBuddyEngine 對齊 schema）。
 *  - 配對 (buddy match)：web 端不做，導向到 mobile 設定課表後再啟用。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import {
  submitCourseReview,
  listCourseReviews,
  aggregateReviews,
  toggleReviewHelpful,
  type CourseReviewDoc,
  type CourseReviewAggregate,
} from '@/lib/community/firestore';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';

type SubTab = 'review' | 'group';

const DAY_LABELS = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];

type WebStudyGroup = {
  id: string;
  name: string;
  courseName: string;
  courseCode: string;
  location: string;
  style: 'collaborative' | 'tutorial' | 'discussion' | 'practice';
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  maxMembers: number;
  members: string[];
  organizerUid: string;
  organizerName?: string;
  createdAt?: unknown;
};

const STYLE_LABEL: Record<WebStudyGroup['style'], string> = {
  collaborative: '協作式',
  tutorial: '教學式',
  discussion: '討論式',
  practice: '練習式',
};

export function StudyBuddyTab(props: { schoolId: string }) {
  const { schoolId } = props;
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<SubTab>('review');

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 16,
        }}
      >
        {(['review', 'group'] as SubTab[]).map((k) => {
          const on = subTab === k;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => setSubTab(k)}
              style={{
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: on ? '3px solid var(--brand, #5856D6)' : '3px solid transparent',
                color: on ? 'var(--brand, #5856D6)' : 'var(--muted)',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              {k === 'review' ? '課程評價' : '讀書會'}
            </button>
          );
        })}
      </div>

      {subTab === 'review' ? (
        <CourseReviewSection schoolId={schoolId} myUid={user?.uid ?? null} />
      ) : (
        <StudyGroupSection schoolId={schoolId} myUid={user?.uid ?? null} myName={user?.displayName ?? null} />
      )}

      <div
        className="card"
        style={{
          marginTop: 24,
          padding: 14,
          fontSize: 12,
          color: 'var(--muted)',
          background: 'var(--panel2, #F2F2F7)',
        }}
      >
        💡 學伴自動配對（依課表互補 / 共同空堂）目前僅在 <strong>mobile App</strong> 提供，
        因 web 端尚未串 TronClass 課表。已建立的讀書會與課程評價會在兩端同步顯示。
      </div>
    </div>
  );
}

// ─── Course Reviews ─────────────────────────────────────

function CourseReviewSection(props: { schoolId: string; myUid: string | null }) {
  const { schoolId, myUid } = props;
  const [reviews, setReviews] = useState<CourseReviewDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) {
      setReviews([]);
      return;
    }
    const rows = await listCourseReviews(schoolId, { lim: 80 });
    setReviews(rows);
  }, [schoolId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return reviews;
    return reviews.filter((r) => `${r.courseName} ${r.courseCode}`.toLowerCase().includes(q));
  }, [reviews, filter]);
  const agg = useMemo(() => aggregateReviews(filtered), [filtered]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <input
          type="search"
          className="input"
          placeholder="篩選課程名稱／代碼"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, maxWidth: 420 }}
        />
        <button
          type="button"
          className="btn primary"
          onClick={() => setShowModal(true)}
          style={{ fontSize: 13, padding: '8px 16px' }}
        >
          ＋ 寫評價
        </button>
      </div>

      {agg.totalCount > 0 && <ReviewSummary agg={agg} />}

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>載入中…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>尚無評價</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>點上方「＋ 寫評價」分享你修過的課</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.slice(0, 30).map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              myUid={myUid}
              onHelpful={async () => {
                if (!myUid) {
                  alert('請先登入');
                  return;
                }
                try {
                  await toggleReviewHelpful(schoolId, r.id, myUid);
                  await load();
                } catch (e: any) {
                  alert(`操作失敗：${e?.message ?? String(e)}`);
                }
              }}
            />
          ))}
        </div>
      )}

      {showModal && (
        <ReviewModal
          schoolId={schoolId}
          myUid={myUid}
          onClose={() => setShowModal(false)}
          onSubmitted={async () => {
            setShowModal(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ReviewSummary({ agg }: { agg: CourseReviewAggregate }) {
  const sentTotal = Math.max(1, agg.sentiment.positive + agg.sentiment.neutral + agg.sentiment.negative);
  const pct = (n: number) => Math.round((n / sentTotal) * 100);
  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--brand, #5856D6)' }}>
          {agg.avgRating.toFixed(1)}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>/ 5 · {agg.totalCount} 則</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <StatPill label="難度" value={agg.avgDifficulty.toFixed(1)} />
        <StatPill label="工作量" value={agg.avgWorkload.toFixed(1)} />
        <StatPill label="實用" value={agg.avgUsefulness.toFixed(1)} />
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 12,
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          background: 'var(--panel2, #F2F2F7)',
        }}
      >
        <div style={{ flex: agg.sentiment.positive || 0, background: '#34C759' }} />
        <div style={{ flex: agg.sentiment.neutral || 0, background: 'var(--muted)' }} />
        <div style={{ flex: agg.sentiment.negative || 0, background: '#FF9500' }} />
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, fontWeight: 700, marginTop: 6 }}>
        <span style={{ color: '#34C759' }}>正面 {pct(agg.sentiment.positive)}%</span>
        <span style={{ color: 'var(--muted)' }}>中立 {pct(agg.sentiment.neutral)}%</span>
        <span style={{ color: '#FF9500' }}>負面 {pct(agg.sentiment.negative)}%</span>
      </div>
      {agg.topTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {agg.topTags.map((t) => (
            <span
              key={t.tag}
              style={{
                fontSize: 11,
                color: 'var(--brand, #5856D6)',
                background: 'rgba(88,86,214,0.15)',
                padding: '2px 8px',
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              {t.tag} · {t.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--panel2, #F2F2F7)',
        padding: '6px 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function ReviewCard({
  review,
  myUid,
  onHelpful,
}: {
  review: CourseReviewDoc;
  myUid: string | null;
  onHelpful: () => void | Promise<void>;
}) {
  const helpedByMe = !!(myUid && Array.isArray(review.helpfulBy) && review.helpfulBy.includes(myUid));
  const sentColor =
    review.sentiment === 'positive' ? '#34C759' : review.sentiment === 'negative' ? '#FF9500' : 'var(--muted)';

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{review.courseName}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{review.courseCode}</div>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: sentColor,
            background: `${sentColor}22`,
            padding: '2px 8px',
            borderRadius: 999,
          }}
        >
          {review.sentiment === 'positive' ? '正面' : review.sentiment === 'negative' ? '負面' : '中立'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} style={{ color: '#FF9500', fontSize: 13 }}>
            {n <= Math.round(review.rating) ? '★' : '☆'}
          </span>
        ))}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>
          {review.anonymous ? review.aliasSnapshot ?? '匿名同學' : review.authorUid?.slice(0, 8) ?? '成員'}
        </span>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{review.comment}</p>
      {review.tags?.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {review.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11,
                color: 'var(--brand, #5856D6)',
                background: 'rgba(88,86,214,0.10)',
                padding: '2px 8px',
                borderRadius: 999,
                fontWeight: 700,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => void onHelpful()}
        style={{
          marginTop: 10,
          padding: '6px 12px',
          borderRadius: 999,
          border: helpedByMe ? '1px solid var(--brand, #5856D6)' : '1px solid var(--border)',
          background: helpedByMe ? 'var(--brand, #5856D6)' : 'var(--surface)',
          color: helpedByMe ? '#fff' : 'var(--muted)',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        👍 有幫助 · {review.helpful ?? 0}
      </button>
    </div>
  );
}

function ReviewModal(props: {
  schoolId: string;
  myUid: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [rating, setRating] = useState(0);
  const [difficulty, setDifficulty] = useState(0);
  const [workload, setWorkload] = useState(0);
  const [usefulness, setUsefulness] = useState(0);
  const [comment, setComment] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!props.myUid) {
      alert('請先登入');
      return;
    }
    if (!courseName.trim()) {
      alert('請填課程名稱');
      return;
    }
    if (rating < 1) {
      alert('請至少給 1 顆星');
      return;
    }
    setBusy(true);
    try {
      await submitCourseReview({
        schoolId: props.schoolId,
        courseCode: courseCode.trim() || courseName.trim(),
        courseName: courseName.trim(),
        rating,
        difficulty,
        workload,
        usefulness,
        comment: comment.trim(),
        tags: tagsRaw.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean),
        anonymous,
        authorUid: anonymous ? null : props.myUid,
        aliasSnapshot: anonymous ? '匿名同學' : undefined,
      });
      props.onSubmitted();
    } catch (e: any) {
      alert(`送出失敗：${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={props.onClose}
    >
      <div
        className="card"
        style={{ padding: 24, width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>寫課程評價</h2>
          <button
            type="button"
            onClick={props.onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
          >
            ×
          </button>
        </div>

        <Label>課程名稱 *</Label>
        <input className="input" value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="例：程式設計（一）" style={{ width: '100%' }} />

        <Label>課程代碼（可選）</Label>
        <input className="input" value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="例：CSIE1001" style={{ width: '100%' }} />

        <Label>整體評分 *</Label>
        <StarRow rating={rating} onChange={setRating} size={26} />

        <Label>難度</Label>
        <StarRow rating={difficulty} onChange={setDifficulty} size={20} />

        <Label>工作量</Label>
        <StarRow rating={workload} onChange={setWorkload} size={20} />

        <Label>實用性</Label>
        <StarRow rating={usefulness} onChange={setUsefulness} size={20} />

        <Label>評論</Label>
        <textarea
          className="input"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          placeholder="分享給學弟妹這門課的真實感受⋯"
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
        />

        <Label>標籤（逗號分隔，最多 6 個）</Label>
        <input
          className="input"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="例：必修, 老師很罩, 期末 project"
          style={{ width: '100%' }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          匿名評價
        </label>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={props.onClose}>取消</button>
          <button type="button" className="btn primary" disabled={busy} onClick={submit}>
            {busy ? '送出中…' : '送出評價'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6 }}>{children}</label>
  );
}

function StarRow({ rating, onChange, size = 24 }: { rating: number; onChange: (r: number) => void; size?: number }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: '#FF9500',
            fontSize: size,
            padding: 0,
          }}
          aria-label={`${n} 顆星`}
        >
          {n <= rating ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

// ─── Study Groups ───────────────────────────────────────

function StudyGroupSection(props: { schoolId: string; myUid: string | null; myName: string | null }) {
  const { schoolId, myUid, myName } = props;
  const [groups, setGroups] = useState<WebStudyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) {
      setGroups([]);
      return;
    }
    const db = getDb();
    try {
      const snap = await getDocs(
        query(
          collection(db, 'schools', schoolId, 'studyGroups'),
          orderBy('createdAt', 'desc'),
          limit(60),
        ),
      );
      setGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WebStudyGroup, 'id'>) })));
    } catch {
      try {
        const snap = await getDocs(query(collection(db, 'schools', schoolId, 'studyGroups'), limit(60)));
        setGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WebStudyGroup, 'id'>) })));
      } catch {
        setGroups([]);
      }
    }
  }, [schoolId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onJoin = async (g: WebStudyGroup) => {
    if (!myUid) {
      alert('請先登入');
      return;
    }
    if (g.members.includes(myUid)) {
      alert('你已是成員');
      return;
    }
    if (g.members.length >= g.maxMembers) {
      alert('讀書會已滿員');
      return;
    }
    try {
      const db: Firestore = getDb();
      await updateDoc(doc(db, 'schools', schoolId, 'studyGroups', g.id), {
        members: arrayUnion(myUid),
        updatedAt: serverTimestamp(),
      });
      await load();
    } catch (e: any) {
      alert(`加入失敗：${e?.message ?? String(e)}`);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--muted)' }}>
          跨平台讀書會列表，點下方按鈕建立新讀書會（資料寫入 schools/{schoolId}/studyGroups）
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => setShowModal(true)}
          style={{ fontSize: 13, padding: '8px 16px' }}
        >
          ＋ 建立讀書會
        </button>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>載入中…</div>
      ) : groups.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>暫無讀書會</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>建立第一場讀書會，等同學報名</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 10 }}>
          {groups.map((g) => {
            const isMember = !!(myUid && g.members.includes(myUid));
            const isFull = g.members.length >= g.maxMembers;
            return (
              <div key={g.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {g.courseName} · {g.courseCode}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--brand, #5856D6)',
                      background: 'rgba(88,86,214,0.15)',
                      padding: '2px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {STYLE_LABEL[g.style]}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--panel2, #F2F2F7)', marginTop: 10 }}>
                  <div
                    style={{
                      width: `${(g.members.length / g.maxMembers) * 100}%`,
                      height: '100%',
                      background: 'var(--brand, #5856D6)',
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {g.members.length} / {g.maxMembers} 成員 · {DAY_LABELS[g.dayOfWeek]} {String(g.startHour).padStart(2, '0')}:00–
                  {String(g.endHour).padStart(2, '0')}:00 · 📍 {g.location}
                </div>
                <button
                  type="button"
                  className="btn primary"
                  disabled={isMember || isFull}
                  onClick={() => onJoin(g)}
                  style={{
                    marginTop: 10,
                    width: '100%',
                    fontSize: 13,
                    background: isMember ? '#34C759' : isFull ? 'var(--muted)' : 'var(--brand, #5856D6)',
                  }}
                >
                  {isMember ? '✓ 已加入' : isFull ? '已滿員' : '申請加入'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <CreateGroupModal
          schoolId={schoolId}
          myUid={myUid}
          myName={myName}
          onClose={() => setShowModal(false)}
          onCreated={async () => {
            setShowModal(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function CreateGroupModal(props: {
  schoolId: string;
  myUid: string | null;
  myName: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [location, setLocation] = useState('圖書館 B1 討論室');
  const [style, setStyle] = useState<WebStudyGroup['style']>('collaborative');
  const [day, setDay] = useState(3);
  const [startHour, setStartHour] = useState(14);
  const [endHour, setEndHour] = useState(16);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!props.myUid) {
      alert('請先登入');
      return;
    }
    if (!name.trim() || !courseName.trim()) {
      alert('讀書會名稱與課程名稱必填');
      return;
    }
    if (endHour <= startHour) {
      alert('結束時間需大於開始時間');
      return;
    }
    setBusy(true);
    try {
      const db: Firestore = getDb();
      await addDoc(collection(db, 'schools', props.schoolId, 'studyGroups'), {
        name: name.trim(),
        courseName: courseName.trim(),
        courseCode: courseCode.trim() || courseName.trim(),
        location: location.trim() || '待定',
        style,
        dayOfWeek: day,
        startHour,
        endHour,
        maxMembers: 6,
        members: [props.myUid],
        organizerUid: props.myUid,
        organizerName: props.myName ?? '組長',
        createdAt: serverTimestamp(),
      });
      props.onCreated();
    } catch (e: any) {
      alert(`建立失敗：${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={props.onClose}
    >
      <div
        className="card"
        style={{ padding: 24, width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>建立讀書會</h2>
          <button
            type="button"
            onClick={props.onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
          >
            ×
          </button>
        </div>

        <Label>讀書會名稱 *</Label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：演算法戰隊" style={{ width: '100%' }} />

        <Label>課程名稱 *</Label>
        <input className="input" value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="例：演算法" style={{ width: '100%' }} />

        <Label>課程代碼（可選）</Label>
        <input className="input" value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="例：CSIE2001" style={{ width: '100%' }} />

        <Label>地點</Label>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} style={{ width: '100%' }} />

        <Label>風格</Label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['collaborative', 'tutorial', 'discussion', 'practice'] as WebStudyGroup['style'][]).map((k) => {
            const on = style === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setStyle(k)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: on ? '1px solid var(--brand, #5856D6)' : '1px solid var(--border)',
                  background: on ? 'var(--brand, #5856D6)' : 'var(--surface)',
                  color: on ? '#fff' : 'var(--text)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {STYLE_LABEL[k]}
              </button>
            );
          })}
        </div>

        <Label>每週見面時間</Label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => {
            const on = day === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: on ? '1px solid var(--brand, #5856D6)' : '1px solid var(--border)',
                  background: on ? 'var(--brand, #5856D6)' : 'var(--surface)',
                  color: on ? '#fff' : 'var(--text)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {DAY_LABELS[d]}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <div style={{ flex: 1 }}>
            <Label>開始</Label>
            <HourInput value={startHour} onChange={setStartHour} />
          </div>
          <div style={{ flex: 1 }}>
            <Label>結束</Label>
            <HourInput value={endHour} onChange={setEndHour} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={props.onClose}>取消</button>
          <button type="button" className="btn primary" disabled={busy} onClick={submit}>
            {busy ? '建立中…' : '建立讀書會'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HourInput({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        onClick={() => onChange(Math.max(7, value - 1))}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          cursor: 'pointer',
        }}
      >
        −
      </button>
      <span style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 16 }}>
        {String(value).padStart(2, '0')}:00
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(22, value + 1))}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          cursor: 'pointer',
        }}
      >
        +
      </button>
    </div>
  );
}
