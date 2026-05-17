'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useToast } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  DEMO_ANNOUNCEMENTS,
  getDemoCourseById,
  getDemoClubById,
} from '@/lib/demoData';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';

export default function AnnouncementDetailPage(props: {
  params: { id: string };
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const { success, info } = useToast();

  const announcement = useMemo(
    () => DEMO_ANNOUNCEMENTS.find((a) => a.id === props.params.id),
    [props.params.id],
  );
  const [saved, setSaved] = useState(false);

  // 訪客 / 校友：若是課程公告 → 隱藏
  const isHidden =
    (demoRole === 'guest' || demoRole === 'alumni') && announcement?.relatedCourseId;

  if (!announcement || isHidden) {
    return (
      <SiteShell title="公告詳情" schoolName={schoolName}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 12 }}>📭</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>
              {isHidden ? '此公告僅限該課程成員瀏覽' : '找不到此公告'}
            </h2>
            <p style={{ margin: '0 0 20px', color: 'var(--muted)', fontSize: 14 }}>
              {isHidden
                ? `${demoRole === 'guest' ? '訪客' : '校友'}身份無法查看課程內部公告`
                : '公告可能已被移除，或網址有誤'}
            </p>
            <Link href={`/announcements${q}`} className="btn primary">
              ← 回公告列表
            </Link>
          </div>
        </div>
      </SiteShell>
    );
  }

  const relatedCourse = announcement.relatedCourseId
    ? getDemoCourseById(announcement.relatedCourseId)
    : null;
  const relatedClub = announcement.relatedClubId
    ? getDemoClubById(announcement.relatedClubId)
    : null;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <SiteShell title="公告詳情" schoolName={schoolName}>
      <div className="pageStack" style={{ maxWidth: 760, margin: '0 auto' }}>
        <nav style={{ fontSize: 13, color: 'var(--muted)' }}>
          <Link href={`/announcements${q}`} style={{ color: 'var(--muted)' }}>
            ← 回公告列表
          </Link>
        </nav>

        {/* 主卡 */}
        <article className="card" style={{ padding: '28px 28px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {announcement.pinned && (
              <span className="pill warning" style={{ fontSize: 11, fontWeight: 700 }}>
                ⭐ 置頂
              </span>
            )}
            {announcement.category && (
              <span className="pill subtle" style={{ fontSize: 11 }}>
                {announcement.category === 'academic'
                  ? '📚 學術'
                  : announcement.category === 'event'
                    ? '🎉 活動'
                    : '📢 一般'}
              </span>
            )}
            <span className="pill subtle" style={{ fontSize: 11 }}>
              {announcement.source}
            </span>
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: '-0.04em',
              marginBottom: 10,
            }}
          >
            {announcement.title}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
            📅 {formatDate(announcement.publishedAt)}
          </div>

          <p
            style={{
              margin: 0,
              fontSize: 15,
              color: 'var(--text)',
              lineHeight: 1.85,
              whiteSpace: 'pre-line',
            }}
          >
            {announcement.body}
          </p>

          {/* 下一步動作 */}
          <div
            style={{
              marginTop: 24,
              paddingTop: 20,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            {relatedCourse && (
              <Link
                href={`/course/${relatedCourse.id}${q}`}
                className="btn primary"
                style={{ fontSize: 13 }}
              >
                📚 前往：{relatedCourse.name}
              </Link>
            )}
            {relatedClub && (
              <Link href={`/clubs${q}`} className="btn primary" style={{ fontSize: 13 }}>
                🎯 前往：{relatedClub.name}
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                setSaved((s) => !s);
                success(saved ? '已取消收藏' : '已加入收藏');
              }}
              className="btn"
              style={{ fontSize: 13 }}
            >
              {saved ? '⭐ 已收藏' : '⭐ 收藏'}
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  success('已複製公告連結');
                } catch {
                  info('複製失敗，請手動複製網址列');
                }
              }}
              className="btn"
              style={{ fontSize: 13 }}
            >
              📋 複製連結
            </button>
            {/* 教師 / 系主任 / 管理員可看「編輯」「下架」 */}
            {caps.canPublishAnnouncements && (
              <button
                type="button"
                onClick={() => info('已開啟「編輯公告」表單（demo）')}
                className="btn"
                style={{ fontSize: 13 }}
              >
                ✏️ 編輯
              </button>
            )}
            {caps.canApproveAnnouncements && (
              <button
                type="button"
                onClick={() => info('已將公告下架（demo）')}
                className="btn"
                style={{ fontSize: 13, color: 'var(--danger)' }}
              >
                🗑️ 下架
              </button>
            )}
          </div>
        </article>
      </div>
    </SiteShell>
  );
}
