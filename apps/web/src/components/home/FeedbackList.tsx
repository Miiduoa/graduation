'use client';

import Link from 'next/link';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { CampusIcon } from '@/components/CampusIcon';
import { useSyncExternalStore } from 'react';
import {
  feedbackPredatesSubmission,
  type HomeFeedback,
} from '@/lib/homeOverview';
import {
  GRADE_COPY,
  getGradeReadEpoch,
  gradeOwnerForSource,
  gradeSourceFromHref,
  isPublishedGradeUnread,
  markPublishedGradeRead,
  subscribeGradeRead,
  type GradeItem,
} from '@/lib/lmsStudentGrades';
import { sanitizeInternalPath } from '@/lib/navigation';
import { courseTaskHref } from '@/lib/todayCourseWork';
import styles from '@/app/home.module.css';

function feedbackHref(item: HomeFeedback): string {
  return sanitizeInternalPath(
    item.href,
    courseTaskHref({
      kind: item.kind,
      id: item.id,
      courseId: item.courseId,
      courseName: item.courseName,
      title: item.title,
      dueAt: null,
      href: item.href,
    }),
  );
}

function asGradeItem(item: HomeFeedback, source: 'nuni' | 'school'): Pick<
  GradeItem,
  'source' | 'courseId' | 'kind' | 'id' | 'status' | 'publishedAt'
> {
  return {
    source,
    courseId: item.courseId,
    kind: item.kind,
    id: item.id,
    status: 'graded',
    publishedAt: item.reviewedAt,
  };
}

export function FeedbackList({
  items,
  ownerId,
  nuniAccountId,
  schoolUid,
}: {
  items: HomeFeedback[];
  ownerId?: string | null;
  nuniAccountId?: string | null;
  schoolUid?: string | null;
}) {
  useSyncExternalStore(subscribeGradeRead, getGradeReadEpoch, () => 0);
  const storageReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return (
    <ul className={styles.list} data-testid="recent-feedback-list">
      {items.map((item) => {
        const stale = feedbackPredatesSubmission(item.reviewedAt, item.submittedAt);
        const reviewedTime = item.reviewedAt ? parseTaipeiInstant(item.reviewedAt) : null;
        const source = gradeSourceFromHref(item.href);
        const itemOwner = gradeOwnerForSource(source, nuniAccountId, schoolUid) || ownerId || '';
        const grade = asGradeItem(item, source);
        const unread =
          storageReady && itemOwner ? isPublishedGradeUnread(itemOwner, grade) : false;
        return (
          <li key={`${item.courseId}-${item.kind}-${item.id}`}>
            <Link
              href={feedbackHref(item)}
              className={styles.task}
              onClick={() => {
                if (itemOwner) markPublishedGradeRead(itemOwner, grade);
              }}
            >
              <span className={styles.taskMarker} aria-hidden="true">
                <CampusIcon name="course" size={20} />
              </span>
              <span className={styles.taskContent}>
                <strong>{item.title}</strong>
                <span>
                  {item.courseName} · {item.kind === 'quiz' ? '測驗回饋' : '作業回饋'}
                  {item.score !== null ? ` · ${item.score} 分` : ''}
                  {stale ? ' · 早於最近繳交' : ''}
                  {unread ? ` · ${GRADE_COPY.unread}` : ''}
                </span>
                {item.feedback ? (
                  <span className={styles.feedbackPreview}>{item.feedback}</span>
                ) : null}
                {stale ? (
                  <span className={styles.feedbackPreview}>
                    這則回饋早於你最近一次繳交，請到作業頁確認是否仍適用。
                  </span>
                ) : null}
              </span>
              <span className={styles.deadline}>
                {reviewedTime !== null ? (
                  <time dateTime={new Date(reviewedTime).toISOString()}>
                    {new Date(reviewedTime).toLocaleString('zh-TW', {
                      timeZone: 'Asia/Taipei',
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </time>
                ) : (
                  '已發布'
                )}
              </span>
              <span aria-hidden className={styles.arrow}>
                →
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
