'use client';

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  resolveSchoolPublicServices,
  type SchoolPublicServiceKind,
  type SchoolPublicServiceLink,
} from '@campus/shared/src/schoolPublicServices';
import { getPublicSchoolInfo, getSafePublicSchoolWebsiteUrl } from '@campus/shared/src/publicSchoolInfo';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import { findSchoolsByCode } from '@campus/shared/src/schools';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import type { SchoolSearchParams } from '@/lib/pageContext';

type Props = {
  service?: SchoolPublicServiceKind;
};

type ExplicitTarget =
  | { kind: 'none' }
  | { kind: 'all' }
  | { kind: 'unrecognized' }
  | { kind: 'id'; id: string; hookParams: SchoolSearchParams };

function trimParam(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Explicit URL identity: campus, then schoolId, then legacy school code.
 * Unrecognized legacy codes must not fall through to the hook's Providence default.
 */
function resolveExplicitUrlTarget(params: SchoolSearchParams): ExplicitTarget {
  const campus = trimParam(params.campus);
  const schoolId = trimParam(params.schoolId);
  const school = trimParam(params.school);

  if (campus) {
    if (campus.toLowerCase() === 'all') return { kind: 'all' };
    return { kind: 'id', id: campus, hookParams: { campus } };
  }
  if (schoolId) {
    if (schoolId.toLowerCase() === 'all') return { kind: 'all' };
    return { kind: 'id', id: schoolId, hookParams: { schoolId } };
  }
  if (school) {
    if (school.toLowerCase() === 'all') return { kind: 'all' };
    const matches = findSchoolsByCode(school);
    if (matches.length === 1) {
      return { kind: 'id', id: matches[0].id, hookParams: { schoolId: matches[0].id } };
    }
    return { kind: 'unrecognized' };
  }
  return { kind: 'none' };
}

function StatusCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card" role="status">
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

function serviceHeading(service: SchoolPublicServiceKind): string {
  if (service === 'career') return '校方職涯資訊';
  if (service === 'dormitory') return '校方住宿資訊';
  if (service === 'health') return '校方諮商資訊';
  return '校方課程資訊';
}

function serviceDescription(service: SchoolPublicServiceKind, link: SchoolPublicServiceLink): string {
  if (link.entryKind === 'student-portal-fallback') {
    if (service === 'career') return '請在臺大學生專區查找職涯與實習資訊。';
    if (service === 'dormitory') return '請在臺大學生專區查找住宿相關資訊。';
    if (service === 'health') return '請在臺大學生專區查找諮商相關資訊。';
  }
  if (service === 'career') {
    return '職缺、實習與諮詢資訊請到所選學校官方網站查看。';
  }
  if (service === 'dormitory') {
    return '住宿申請與相關說明請到所選學校官方網站查看。個人包裹與報修尚未連結。';
  }
  if (service === 'health') {
    return '查看校方諮商服務與聯絡方式，預約請依校方流程辦理。';
  }
  return '課程資訊請到所選學校官方網站查看。';
}

export function SchoolPublicServiceLinks({ service = 'career' }: Props) {
  const searchParams = useSearchParams();
  const selection = useOptionalSelectedSchool();
  const params: SchoolSearchParams = {
    campus: searchParams.get('campus') ?? undefined,
    schoolId: searchParams.get('schoolId') ?? undefined,
    school: searchParams.get('school') ?? undefined,
  };
  const explicit = resolveExplicitUrlTarget(params);
  const hookParams: SchoolSearchParams | undefined =
    explicit.kind === 'id'
      ? explicit.hookParams
      : explicit.kind === 'all' || explicit.kind === 'unrecognized'
        ? { campus: 'all' }
        : selection?.selectedSchoolId
          ? { schoolId: selection.selectedSchoolId }
          : undefined;

  const context = useBrowsingSchoolPageContext(hookParams);

  if (
    selection &&
    (context.scopeStatus === 'loading' ||
      selection.loading ||
      selection.catalogStatus === 'loading')
  ) {
    return <StatusCard title="載入中">正在載入學校資訊，請稍候。</StatusCard>;
  }

  if (
    selection &&
    (context.scopeStatus === 'error' ||
      context.catalogError ||
      selection.catalogStatus === 'error')
  ) {
    return <StatusCard title="無法載入">暫時無法載入學校清單，請在頁首重試。</StatusCard>;
  }

  if (explicit.kind === 'all' || (explicit.kind === 'none' && !selection?.selectedSchool)) {
    return (
      <StatusCard title="請先選擇學校">請先在頁首選擇學校，查看對應的校方資訊。</StatusCard>
    );
  }

  if (explicit.kind === 'unrecognized') {
    return (
      <StatusCard title="無法確認學校">網址中的學校無法辨識，請改從頁首選擇學校。</StatusCard>
    );
  }

  const targetId =
    explicit.kind === 'id' ? explicit.id : selection?.selectedSchoolId ?? null;
  const profile = resolveSchoolPublicServices(targetId);

  const selected = selection?.selectedSchool;
  const record = getPublicSchoolInfo(
    profile?.schoolId ?? targetId,
    selected?.id === targetId ? selected?.name : undefined,
  );
  if (!record) {
    return <StatusCard title="尚未提供入口">目前無法核對這所學校的校方資訊。</StatusCard>;
  }

  if (!profile) {
    const course = service === 'courses' ? resolveOfficialCourseQueryLink(targetId) : null;
    const url = course?.url ?? getSafePublicSchoolWebsiteUrl(record.websiteUrl);
    return (
      <section className="card">
        <p className="eyebrow">{record.name}</p>
        <h2>{serviceHeading(service)}</h2>
        <p>{course ? '開課資料與查詢方式請以校方公告為準。' : '請從學校官網查找相關單位與服務辦法。'}</p>
        {url && <a href={url} target="_blank" rel="noopener noreferrer">{course?.label ?? `前往${record.name}官網`}</a>}
      </section>
    );
  }

  const link = profile.services[service];
  return (
    <section className="card" key={`${profile.schoolId}:${service}`}>
      <p className="eyebrow">{profile.schoolName}</p>
      <h2>{serviceHeading(service)}</h2>
      <p>{serviceDescription(service, link)}</p>
      <p>
        <a href={link.url} target="_blank" rel="noopener noreferrer">
          {link.label}
        </a>
      </p>
      <p style={{ color: 'var(--muted)', fontSize: 14 }}>來源：{link.sourceLabel}</p>
    </section>
  );
}
