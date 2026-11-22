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

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import {
  COMMUNITY_FORM_PENDING_COPY,
  useCommunityFormSession,
  type CommunityFormCloseReason,
  type CommunityFormDisplay,
} from './useCommunityFormSession';
import formStyles from './CommunityForm.module.css';
import modalStyles from '@/components/ui/Modal.module.css';
import { CommunityLoadError, useCommunityLoad } from './useCommunityLoad';
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
  const [visitedGroups, setVisitedGroups] = useState(false);

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
              onClick={() => {
                if (k === 'group') setVisitedGroups(true);
                setSubTab(k);
              }}
              style={{
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: on ? '3px solid var(--brand)' : '3px solid transparent',
                color: on ? 'var(--brand)' : 'var(--muted)',
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

      <div hidden={subTab !== 'review'}>
        <CourseReviewSection
          key={`${schoolId}:${user?.uid ?? ''}`}
          schoolId={schoolId}
          myUid={user?.uid ?? null}
          active={subTab === 'review'}
        />
      </div>
      {visitedGroups && (
        <div hidden={subTab !== 'group'}>
          <StudyGroupSection
            key={`${schoolId}:${user?.uid ?? ''}`}
            schoolId={schoolId}
            myUid={user?.uid ?? null}
            myName={user?.displayName ?? null}
            active={subTab === 'group'}
          />
        </div>
      )}

      <p style={{ marginTop: 24, color: 'var(--muted)', fontSize: 13 }}>
        找找修過同一門課的同學心得，或建立讀書會一起準備。
      </p>
    </div>
  );
}

// ─── Course Reviews ─────────────────────────────────────

export function CourseReviewSection(props: {
  schoolId: string;
  myUid: string | null;
  active?: boolean;
}) {
  const { schoolId, myUid } = props;
  const [reviews, setReviews] = useState<CourseReviewDoc[]>([]);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const [formDisplay, setFormDisplay] = useState<CommunityFormDisplay>('closed');
  const writeReviewRef = useRef<HTMLButtonElement>(null);
  const firstReviewRef = useRef<HTMLButtonElement>(null);
  const restoreReviewFocus = useRef(false);

  useEffect(() => {
    if (formDisplay !== 'closed' || !restoreReviewFocus.current) return;
    restoreReviewFocus.current = false;
    if (props.active !== false && document.activeElement === document.body)
      writeReviewRef.current?.focus();
  }, [formDisplay, props.active]);

  const load = useCallback(async (isCurrent: () => boolean) => {
    if (!schoolId) {
      setReviews([]);
      return;
    }
    const rows = await listCourseReviews(schoolId, { lim: 80 });
    if (isCurrent()) setReviews(rows);
  }, [schoolId]);

  const { loading, error, refresh } = useCommunityLoad(
    load,
    '暫時無法讀取課程評價，請確認連線後重試。',
    props.active,
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return reviews;
    return reviews.filter((r) => `${r.courseName} ${r.courseCode}`.toLowerCase().includes(q));
  }, [reviews, filter]);
  const agg = useMemo(() => aggregateReviews(filtered), [filtered]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 14,
          alignItems: 'center',
        }}
      >
        <input
          ref={filterRef}
          type="search"
          aria-label="篩選課程名稱或代碼"
          className="input"
          placeholder="篩選課程名稱／代碼"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: '1 1 160px', minWidth: 0, maxWidth: 420 }}
        />
        <button
          ref={writeReviewRef}
          type="button"
          className="btn primary"
          onClick={() => setFormDisplay('open')}
          style={{ fontSize: 13, padding: '8px 16px' }}
        >
          ＋ 寫評價
        </button>
      </div>
      {formDisplay === 'pending-hidden' && (
        <p role="status" className={formStyles.hint}>
          評價表單與這次送出仍保留在本頁，可再按「寫評價」查看結果。
        </p>
      )}

      {error && <CommunityLoadError message={error} retry={refresh} />}
      {!error && agg.totalCount > 0 && <ReviewSummary agg={agg} />}

      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          載入中…
        </div>
      ) : error ? null : filtered.length === 0 ? (
        <div className={formStyles.empty}>
          <h3>{filter.trim() ? '找不到符合的課程評價' : '尚無評價'}</h3>
          <p role="status">
            {filter.trim()
              ? `沒有符合「${filter.trim()}」的課程名稱或代碼。試試其他關鍵字。`
              : '分享修課心得，幫助同學準備下一學期。'}
          </p>
          {filter.trim() ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setFilter('');
                filterRef.current?.focus();
              }}
            >
              清除搜尋
            </Button>
          ) : (
            <Button
              ref={firstReviewRef}
              type="button"
              variant="primary"
              onClick={() => setFormDisplay('open')}
            >
              寫第一則評價
            </Button>
          )}
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
                  await refresh();
                } catch {
                  alert('這次未能操作，請稍後再試。');
                }
              }}
            />
          ))}
        </div>
      )}

      {formDisplay !== 'closed' && (
        <ReviewModal
          open={props.active !== false && formDisplay === 'open'}
          schoolId={schoolId}
          myUid={myUid}
          onClose={(reason) => setFormDisplay(reason === 'pending' ? 'pending-hidden' : 'closed')}
          onSubmitted={async () => {
            restoreReviewFocus.current =
              formDisplay === 'open' ||
              (firstReviewRef.current !== null && document.activeElement === firstReviewRef.current);
            setFormDisplay('closed');
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function ReviewSummary({ agg }: { agg: CourseReviewAggregate }) {
  const sentTotal = Math.max(
    1,
    agg.sentiment.positive + agg.sentiment.neutral + agg.sentiment.negative,
  );
  const pct = (n: number) => Math.round((n / sentTotal) * 100);
  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--brand)' }}>
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
          background: 'var(--panel2)',
        }}
      >
        <div style={{ flex: agg.sentiment.positive || 0, background: 'var(--success)' }} />
        <div style={{ flex: agg.sentiment.neutral || 0, background: 'var(--muted)' }} />
        <div style={{ flex: agg.sentiment.negative || 0, background: 'var(--warning)' }} />
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, fontWeight: 700, marginTop: 6 }}>
        <span style={{ color: 'var(--success)' }}>正面 {pct(agg.sentiment.positive)}%</span>
        <span style={{ color: 'var(--muted)' }}>中立 {pct(agg.sentiment.neutral)}%</span>
        <span style={{ color: 'var(--warning)' }}>負面 {pct(agg.sentiment.negative)}%</span>
      </div>
      {agg.topTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {agg.topTags.map((t) => (
            <span
              key={t.tag}
              style={{
                fontSize: 11,
                color: 'var(--brand)',
                background: 'var(--accent-soft)',
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
        background: 'var(--panel2)',
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
  const helpedByMe = !!(
    myUid &&
    Array.isArray(review.helpfulBy) &&
    review.helpfulBy.includes(myUid)
  );
  const sentColor =
    review.sentiment === 'positive'
      ? 'var(--success)'
      : review.sentiment === 'negative'
        ? 'var(--warning)'
        : 'var(--muted)';

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
            {review.courseName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{review.courseCode}</div>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: sentColor,
            background: `color-mix(in srgb, ${sentColor} 13.33%, transparent)`,
            padding: '2px 8px',
            borderRadius: 999,
          }}
        >
          {review.sentiment === 'positive'
            ? '正面'
            : review.sentiment === 'negative'
              ? '負面'
              : '中立'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} style={{ color: 'var(--warning)', fontSize: 13 }}>
            {n <= Math.round(review.rating) ? '★' : '☆'}
          </span>
        ))}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>
          {review.anonymous
            ? (review.aliasSnapshot ?? '匿名同學')
            : (review.authorUid?.slice(0, 8) ?? '成員')}
        </span>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
        {review.comment}
      </p>
      {review.tags?.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {review.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11,
                color: 'var(--brand)',
                background: 'var(--accent-soft)',
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
          border: helpedByMe ? '1px solid var(--brand)' : '1px solid var(--border)',
          background: helpedByMe ? 'var(--brand)' : 'var(--surface)',
          color: helpedByMe ? 'var(--on-brand)' : 'var(--muted)',
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

export function ReviewModal(props: {
  open?: boolean;
  schoolId: string;
  myUid: string | null;
  onClose: (reason: CommunityFormCloseReason) => void;
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
  const [validated, setValidated] = useState(false);
  const courseRef = useRef<HTMLInputElement>(null);
  const ratingRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const session = useCommunityFormSession(props.onClose);

  function submit() {
    if (session.busy) return;
    if (!props.myUid) {
      session.setError('請先登入後再送出評價。');
      return;
    }
    setValidated(true);
    if (!courseName.trim()) {
      courseRef.current?.focus();
      return;
    }
    if (rating < 1) {
      ratingRef.current?.focus();
      return;
    }
    void session.submit(
      () =>
        submitCourseReview({
          schoolId: props.schoolId,
          courseCode: courseCode.trim() || courseName.trim(),
          courseName: courseName.trim(),
          rating,
          difficulty,
          workload,
          usefulness,
          comment: comment.trim(),
          tags: tagsRaw
            .split(/[,，、\s]+/)
            .map((tag) => tag.trim())
            .filter(Boolean),
          anonymous,
          authorUid: anonymous ? null : props.myUid,
          aliasSnapshot: anonymous ? '匿名同學' : undefined,
        }),
      props.onSubmitted,
      '暫時無法確認送出結果，內容已保留。請先查看列表是否已出現，再決定是否重試。',
    );
  }

  return (
    <Modal
      isOpen={props.open ?? true}
      onClose={session.requestClose}
      title="寫課程評價"
      size="lg"
      description="分享修課經驗。課程名稱與整體評分為必填，其餘可略過。"
      initialFocusRef={courseRef}
      showCloseButton={!session.busy}
      closeOnEsc={session.canClose}
      closeOnOverlayClick={session.canClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={session.requestClose}
            disabled={!session.canClose}
          >
            {session.busy && session.slow ? '先關閉' : '取消'}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={session.busy}>
            {session.busy ? '送出中…' : '送出評價'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className={formStyles.fields} disabled={session.busy}>
          <Input
            ref={courseRef}
            label="課程名稱"
            required
            value={courseName}
            placeholder="例：程式設計（一）"
            onChange={(event) => setCourseName(event.target.value)}
            error={validated && !courseName.trim() ? '請填寫課程名稱。' : undefined}
          />
          <Input
            label="課程代碼（選填）"
            value={courseCode}
            placeholder="例：CSIE1001"
            onChange={(event) => setCourseCode(event.target.value)}
          />
          <StarRow
            label="整體評分"
            rating={rating}
            onChange={setRating}
            required
            firstRef={ratingRef}
            error={validated && rating < 1 ? '請選擇整體評分。' : undefined}
          />
          <StarRow label="難度" rating={difficulty} onChange={setDifficulty} />
          <StarRow label="工作量" rating={workload} onChange={setWorkload} />
          <StarRow label="實用性" rating={usefulness} onChange={setUsefulness} />
          <Textarea
            label="評論（選填）"
            value={comment}
            rows={4}
            placeholder="分享課程內容、上課方式與準備建議。"
            onChange={(event) => setComment(event.target.value)}
          />
          <Input
            label="標籤（選填）"
            value={tagsRaw}
            hint="以逗號分隔，最多 6 個。"
            placeholder="例：必修、實作課程"
            onChange={(event) => setTagsRaw(event.target.value)}
          />
          <label className={formStyles.checkbox}>
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(event) => setAnonymous(event.target.checked)}
            />
            匿名評價
          </label>
        </fieldset>
        {session.busy && (
          <p role="status" className={modalStyles.notice}>
            {session.slow ? COMMUNITY_FORM_PENDING_COPY : '正在送出評價，請稍候。'}
          </p>
        )}
        {session.error && (
          <p role="alert" className={modalStyles.error}>
            {session.error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function StarRow({
  label,
  rating,
  onChange,
  required = false,
  error,
  firstRef,
}: {
  label: string;
  rating: number;
  onChange: (rating: number) => void;
  required?: boolean;
  error?: string;
  firstRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  return (
    <fieldset
      className={formStyles.rating}
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      aria-describedby={error ? `${id}-error` : `${id}-hint`}
      aria-required={required || undefined}
      aria-invalid={!!error || undefined}
    >
      <legend id={`${id}-label`}>
        {label}
        {required ? '（必填）' : '（選填）'}
      </legend>
      <div className={formStyles.stars}>
        {[1, 2, 3, 4, 5].map((value) => (
          <label key={value} className={formStyles.star}>
            <input
              ref={value === 1 ? firstRef : undefined}
              type="radio"
              name={id}
              value={value}
              checked={rating === value}
              required={required}
              aria-label={`${value} 顆星`}
              aria-describedby={error ? `${id}-error` : `${id}-hint`}
              onChange={() => onChange(value)}
            />
            <span aria-hidden="true">{value <= rating ? '★' : '☆'}</span>
          </label>
        ))}
      </div>
      <p id={`${id}-hint`} className={formStyles.hint}>
        {rating ? `已選 ${rating}／5` : '尚未評分'}
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className={formStyles.error}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ─── Study Groups ───────────────────────────────────────

export function StudyGroupSection(props: {
  schoolId: string;
  myUid: string | null;
  myName: string | null;
  active?: boolean;
}) {
  const { schoolId, myUid, myName } = props;
  const [groups, setGroups] = useState<WebStudyGroup[]>([]);
  const [formDisplay, setFormDisplay] = useState<CommunityFormDisplay>('closed');

  const load = useCallback(async (isCurrent: () => boolean) => {
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
      if (isCurrent()) {
        setGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WebStudyGroup, 'id'>) })));
      }
    } catch {
      if (!isCurrent()) return;
      const snap = await getDocs(
        query(collection(db, 'schools', schoolId, 'studyGroups'), limit(60)),
      );
      if (isCurrent()) {
        setGroups(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WebStudyGroup, 'id'>) })));
      }
    }
  }, [schoolId]);

  const { loading, error, refresh } = useCommunityLoad(
    load,
    '暫時無法讀取讀書會，請確認連線後重試。',
    props.active,
  );

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
      await refresh();
    } catch {
      alert('這次未能加入，請稍後再試。');
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginBottom: 14,
        }}
      >
        <div style={{ flex: 1, fontSize: 13, color: 'var(--muted)' }}>
          找同學一起準備課程，約好每週讀書的時間與地點。
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => setFormDisplay('open')}
          style={{ fontSize: 13, padding: '8px 16px' }}
        >
          ＋ 建立讀書會
        </button>
      </div>
      {formDisplay === 'pending-hidden' && (
        <p role="status" className={formStyles.hint}>
          讀書會表單與這次送出仍保留在本頁，可再按「建立讀書會」查看結果。
        </p>
      )}

      {error && <CommunityLoadError message={error} retry={refresh} />}
      {loading ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          載入中…
        </div>
      ) : error ? null : groups.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>暫無讀書會</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>建立第一場讀書會，等同學報名</div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))',
            gap: 10,
          }}
        >
          {groups.map((g) => {
            const isMember = !!(myUid && g.members.includes(myUid));
            const isFull = g.members.length >= g.maxMembers;
            return (
              <div key={g.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                      {g.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {g.courseName} · {g.courseCode}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--brand)',
                      background: 'var(--accent-soft)',
                      padding: '2px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {STYLE_LABEL[g.style]}
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    overflow: 'hidden',
                    background: 'var(--panel2)',
                    marginTop: 10,
                  }}
                >
                  <div
                    style={{
                      width: `${(g.members.length / g.maxMembers) * 100}%`,
                      height: '100%',
                      background: 'var(--brand)',
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {g.members.length} / {g.maxMembers} 成員 · {DAY_LABELS[g.dayOfWeek]}{' '}
                  {String(g.startHour).padStart(2, '0')}:00–
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
                    background: isMember
                      ? 'var(--success)'
                      : isFull
                        ? 'var(--muted)'
                        : 'var(--brand)',
                  }}
                >
                  {isMember ? '✓ 已加入' : isFull ? '已滿員' : '申請加入'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {formDisplay !== 'closed' && (
        <CreateGroupModal
          open={props.active !== false && formDisplay === 'open'}
          schoolId={schoolId}
          myUid={myUid}
          myName={myName}
          onClose={(reason) => setFormDisplay(reason === 'pending' ? 'pending-hidden' : 'closed')}
          onCreated={async () => {
            setFormDisplay('closed');
            await refresh();
          }}
        />
      )}
    </div>
  );
}

export function CreateGroupModal(props: {
  open?: boolean;
  schoolId: string;
  myUid: string | null;
  myName: string | null;
  onClose: (reason: CommunityFormCloseReason) => void;
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
  const [validated, setValidated] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const courseRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLSelectElement>(null);
  const formId = useId();
  const session = useCommunityFormSession(props.onClose);
  const hours = Array.from({ length: 16 }, (_, index) => {
    const hour = index + 7;
    return { value: String(hour), label: `${String(hour).padStart(2, '0')}:00` };
  });

  function submit() {
    if (session.busy) return;
    if (!props.myUid) {
      session.setError('請先登入後再建立讀書會。');
      return;
    }
    setValidated(true);
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    if (!courseName.trim()) {
      courseRef.current?.focus();
      return;
    }
    if (endHour <= startHour) {
      endRef.current?.focus();
      return;
    }
    void session.submit(
      () =>
        addDoc(collection(getDb(), 'schools', props.schoolId, 'studyGroups'), {
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
        }),
      props.onCreated,
      '暫時無法確認建立結果，內容已保留。請先查看列表是否已出現，再決定是否重試。',
    );
  }

  return (
    <Modal
      isOpen={props.open ?? true}
      onClose={session.requestClose}
      title="建立讀書會"
      size="lg"
      description="先決定課程與時間，最多 6 位同學一起參加。"
      initialFocusRef={nameRef}
      showCloseButton={!session.busy}
      closeOnEsc={session.canClose}
      closeOnOverlayClick={session.canClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={session.requestClose}
            disabled={!session.canClose}
          >
            {session.busy && session.slow ? '先關閉' : '取消'}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={session.busy}>
            {session.busy ? '建立中…' : '建立讀書會'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className={formStyles.fields} disabled={session.busy}>
          <Input
            ref={nameRef}
            label="讀書會名稱"
            required
            value={name}
            placeholder="例：演算法讀書會"
            onChange={(event) => setName(event.target.value)}
            error={validated && !name.trim() ? '請填寫讀書會名稱。' : undefined}
          />
          <Input
            ref={courseRef}
            label="課程名稱"
            required
            value={courseName}
            placeholder="例：演算法"
            onChange={(event) => setCourseName(event.target.value)}
            error={validated && !courseName.trim() ? '請填寫課程名稱。' : undefined}
          />
          <Input
            label="課程代碼（選填）"
            value={courseCode}
            placeholder="例：CSIE2001"
            onChange={(event) => setCourseCode(event.target.value)}
          />
          <Input
            label="地點"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
          <Select
            label="讀書方式"
            value={style}
            options={Object.entries(STYLE_LABEL).map(([value, label]) => ({ value, label }))}
            onChange={(event) => setStyle(event.target.value as WebStudyGroup['style'])}
          />
          <Select
            label="每週見面日"
            value={day}
            options={DAY_LABELS.slice(1).map((label, index) => ({
              value: String(index + 1),
              label,
            }))}
            onChange={(event) => setDay(Number(event.target.value))}
          />
          <div className={formStyles.columns}>
            <Select
              label="開始時間"
              value={startHour}
              options={hours}
              onChange={(event) => setStartHour(Number(event.target.value))}
            />
            <Select
              ref={endRef}
              label="結束時間"
              value={endHour}
              options={hours}
              onChange={(event) => setEndHour(Number(event.target.value))}
              error={validated && endHour <= startHour ? '結束時間要晚於開始時間。' : undefined}
            />
          </div>
        </fieldset>
        {session.busy && (
          <p role="status" className={modalStyles.notice}>
            {session.slow ? COMMUNITY_FORM_PENDING_COPY : '正在建立讀書會，請稍候。'}
          </p>
        )}
        {session.error && (
          <p role="alert" className={modalStyles.error}>
            {session.error}
          </p>
        )}
      </form>
    </Modal>
  );
}
