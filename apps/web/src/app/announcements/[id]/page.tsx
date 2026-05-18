'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { useToast, Modal } from '@/components/ui';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import {
  DEMO_ANNOUNCEMENTS,
  getDemoCourseById,
  getDemoClubById,
} from '@/lib/demoData';
import { useDemoRole, getCapabilities } from '@/lib/demoRole';
import { useDemoStore, takedownAnnouncement, isAnnouncementTakenDown, editAnnouncementDraft, getAnnouncementEdit } from '@/lib/demoStore';

export default function AnnouncementDetailPage(props: {
  params: { id: string };
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch: q } = resolveSchoolPageContext(props.searchParams);
  const router = useRouter();
  const [demoRole] = useDemoRole();
  const caps = getCapabilities(demoRole);
  const { success, info } = useToast();
  const store = useDemoStore();

  const baseAnnouncement = useMemo(
    () => DEMO_ANNOUNCEMENTS.find((a) => a.id === props.params.id),
    [props.params.id],
  );
  const edit = baseAnnouncement ? getAnnouncementEdit(baseAnnouncement.id, store) : undefined;
  const announcement = baseAnnouncement ? {
    ...baseAnnouncement,
    title: edit?.title ?? baseAnnouncement.title,
    body: edit?.body ?? baseAnnouncement.body,
  } : undefined;
  const takenDown = baseAnnouncement ? isAnnouncementTakenDown(baseAnnouncement.id, store) : false;
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ title: '', body: '' });

  // 訪客 / 校友：若是課程公告 → 隱藏
  const isHidden =
    (demoRole === 'guest' || demoRole === 'alumni') && announcement?.relatedCourseId;

  if (!announcement || isHidden || (takenDown && !caps.canApproveAnnouncements)) {
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
              {takenDown ? '此公告已被下架' : isHidden ? '此公告僅限該課程成員瀏覽' : '找不到此公告'}
            </h2>
            <p style={{ margin: '0 0 20px', color: 'var(--muted)', fontSize: 14 }}>
              {takenDown
                ? '公告已由審核者下架，無法繼續查看。'
                : isHidden
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
              fontWeight: 700,
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
                href={`${(demoRole === 'teacher' || demoRole === 'ta' || demoRole === 'admin' || demoRole === 'department_head') ? '/teacher' : ''}/course/${relatedCourse.id}${q}`}
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
                onClick={() => {
                  setEditDraft({ title: announcement.title, body: announcement.body });
                  setEditing(true);
                }}
                className="btn"
                style={{ fontSize: 13 }}
              >
                ✏️ 編輯
              </button>
            )}
            {caps.canApproveAnnouncements && !takenDown && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window === 'undefined') return;
                  const ok = window.confirm(`確定要下架「${announcement.title}」？學生與課程成員將無法再看到此公告。`);
                  if (!ok) return;
                  takedownAnnouncement(announcement.id, demoRole === 'admin' ? '系統管理員' : '系主任');
                  success('🗑️ 已將公告下架，原發布者已收到通知');
                  router.push(`/announcements${q}`);
                }}
                className="btn"
                style={{ fontSize: 13, color: 'var(--danger)' }}
              >
                🗑️ 下架
              </button>
            )}
            {caps.canPublishAnnouncements && (
              <Link
                href={`/ai-assistant${q ? q + '&' : '?'}q=${encodeURIComponent(`幫我改寫公告「${announcement.title}」，讓內容更清楚、語氣更友善，並補上 Call-to-Action`)}`}
                className="btn"
                style={{ fontSize: 13, background: 'var(--accent-soft)', color: 'var(--brand)' }}
              >
                🤖 AI 改寫
              </Link>
            )}
          </div>

          {takenDown && caps.canApproveAnnouncements && (
            <div style={{ marginTop: 16, padding: 12, background: 'var(--danger-soft)', borderRadius: 8, fontSize: 13, color: 'var(--danger)' }}>
              ⚠️ <strong>此公告已下架</strong>（其他角色無法看到，僅你以審核者身份能繼續閱讀）
            </div>
          )}
        </article>
      </div>

      {/* 編輯 Modal */}
      <Modal
        isOpen={editing}
        onClose={() => setEditing(false)}
        title={`✏️ 編輯公告：${announcement.title}`}
        size="lg"
        footer={
          <>
            <button className="btn" onClick={() => setEditing(false)}>取消</button>
            <button
              className="btn primary"
              onClick={() => {
                if (!editDraft.title.trim() || !editDraft.body.trim()) {
                  info('請填寫標題與內文');
                  return;
                }
                editAnnouncementDraft({
                  id: announcement.id,
                  title: editDraft.title,
                  body: editDraft.body,
                  editedBy: demoRole === 'admin' ? '系統管理員' : caps.canApproveAnnouncements ? '系主任' : '教師',
                });
                setEditing(false);
                success('✅ 公告已更新');
              }}
            >
              儲存
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>標題</div>
            <input
              className="input"
              value={editDraft.title}
              onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            />
          </label>
          <label>
            <div style={{ marginBottom: 4, fontWeight: 600 }}>內文</div>
            <textarea
              className="input"
              value={editDraft.body}
              onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })}
              rows={10}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, fontFamily: 'inherit' }}
            />
          </label>
          <div style={{ padding: 10, background: 'var(--accent-soft)', borderRadius: 8, fontSize: 12, color: 'var(--brand)' }}>
            🤖 <strong>AI 提示</strong>：可在儲存後讓 AI 助理校對。重大修改建議重新送審。
          </div>
        </div>
      </Modal>
    </SiteShell>
  );
}
