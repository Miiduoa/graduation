'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import type { Announcement } from '@/lib/firebase';
import {
  announcementPublicHref,
  upsertSchoolAnnouncement,
  validateSchoolAnnouncementDraft,
  type SchoolAnnouncementDraft,
} from '@/lib/schoolAnnouncementsAdmin';
import styles from './announcementsAdmin.module.css';

export type AnnouncementAdminFormProps = {
  schoolId: string;
  schoolName?: string;
  editing: Announcement | null;
  onCancelEdit: () => void;
  onSaved: (announcementId: string, mode: 'create' | 'update') => void;
};

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; announcementId: string; mode: 'create' | 'update' }
  | { status: 'error'; message: string };

function draftFromAnnouncement(
  announcement: Announcement | null,
  fallbackSource: string,
): SchoolAnnouncementDraft {
  if (!announcement) {
    return { title: '', body: '', source: fallbackSource, pinned: false };
  }
  return {
    title: announcement.title,
    body: announcement.body ?? '',
    source: announcement.source ?? fallbackSource,
    pinned: announcement.pinned === true,
  };
}

function AnnouncementAdminFormFields({
  schoolId,
  schoolName = '',
  editing,
  onCancelEdit,
  onSaved,
}: AnnouncementAdminFormProps) {
  const fallbackSource = schoolName.trim();
  const [draft, setDraft] = useState<SchoolAnnouncementDraft>(() =>
    draftFromAnnouncement(editing, fallbackSource),
  );
  const [fieldError, setFieldError] = useState('');
  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validated = validateSchoolAnnouncementDraft(draft);
    if (!validated.ok) {
      setFieldError(validated.error);
      setSubmit({ status: 'idle' });
      return;
    }
    setFieldError('');
    setSubmit({ status: 'submitting' });
    const mode = editing ? 'update' : 'create';
    try {
      const result = await upsertSchoolAnnouncement({
        schoolId,
        announcementId: editing?.id ?? null,
        title: validated.value.title,
        body: validated.value.body,
        source: validated.value.source || fallbackSource || undefined,
        pinned: validated.value.pinned,
      });
      setSubmit({ status: 'success', announcementId: result.announcementId, mode });
      onSaved(result.announcementId, mode);
      if (!editing) {
        setDraft({ title: '', body: '', source: fallbackSource, pinned: false });
      }
    } catch (failure) {
      const message =
        failure instanceof Error && failure.message.trim()
          ? failure.message
          : '儲存失敗，請稍後再試';
      setSubmit({ status: 'error', message });
    }
  }

  const busy = submit.status === 'submitting';

  return (
    <section className={styles.panel} aria-labelledby="announcement-form-heading">
      <div className={styles.toolbar}>
        <h2 id="announcement-form-heading">{editing ? '編輯公告' : '發布公告'}</h2>
        {editing ? (
          <Button type="button" variant="ghost" onClick={onCancelEdit} disabled={busy}>
            取消編輯
          </Button>
        ) : null}
      </div>
      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Input
          label="標題 *"
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          placeholder="輸入公告標題"
          disabled={busy}
          required
        />
        <Textarea
          label="內容"
          value={draft.body}
          onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
          placeholder="輸入公告內容"
          disabled={busy}
          rows={6}
        />
        <Input
          label="來源"
          value={draft.source}
          onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
          placeholder="例如：教務處、學務處"
          disabled={busy}
        />
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={draft.pinned}
            onChange={(event) =>
              setDraft((current) => ({ ...current, pinned: event.target.checked }))
            }
            disabled={busy}
          />
          <span>置頂公告</span>
        </label>
        {fieldError ? (
          <p className={styles.error} role="alert">
            {fieldError}
          </p>
        ) : null}
        {submit.status === 'error' ? (
          <p className={styles.error} role="alert">
            {submit.message}
          </p>
        ) : null}
        {submit.status === 'success' ? (
          <p className={styles.success} role="status">
            {submit.mode === 'create' ? '公告已發布。' : '公告已更新。'}
            <Link href={announcementPublicHref(submit.announcementId, schoolId)}>
              前往 /announcements/{submit.announcementId}
            </Link>
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={busy} disabled={busy}>
            {busy ? '儲存中…' : editing ? '儲存變更' : '發布公告'}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function AnnouncementAdminForm(props: AnnouncementAdminFormProps) {
  return (
    <AnnouncementAdminFormFields
      key={`${props.schoolId}:${props.editing?.id ?? 'new'}`}
      {...props}
    />
  );
}
