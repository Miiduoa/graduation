import { findSchoolById } from './schools';
import { getOfficialLibrary } from './officialLibraries';
import { isProvidenceSchoolId, toPublicSchoolId } from './schoolIds';

export type SchoolAssistantIdentity = {
  schoolId: string;
  schoolName: string;
  assistantLabel: string;
  /** Extra factual lines allowed only for schools with verified bundled knowledge. */
  verifiedFactLines: string[];
};

const PU_VERIFIED_FACTS = [
  '靜宜大學位於台中市沙鹿區台灣大道七段 200 號。',
  '交通與公車路線、開放時間、學分上限、請假規則等即時規定，請以校方公告或已載入的學校資料為準，不可捏造數字。',
] as const;

/**
 * Persona / metadata for assistant prompts.
 * Never claim Providence identity for another selected school.
 */
export function resolveSchoolAssistantIdentity(
  schoolId?: string | null,
  schoolName?: string | null,
): SchoolAssistantIdentity {
  const publicId = toPublicSchoolId(schoolId) ?? 'unknown';
  const directoryName = findSchoolById(publicId)?.name;
  const name =
    (typeof schoolName === 'string' && schoolName.trim()) ||
    directoryName ||
    (publicId === 'unknown' ? '目前選擇的學校' : `學校（${publicId}）`);

  if (isProvidenceSchoolId(schoolId)) {
    return {
      schoolId: 'pu',
      schoolName: directoryName ?? '靜宜大學',
      assistantLabel: '靜宜小幫手',
      verifiedFactLines: [...PU_VERIFIED_FACTS],
    };
  }

  return {
    schoolId: publicId,
    schoolName: name,
    assistantLabel: `${name}校園助理`,
    verifiedFactLines: [
      `目前選校：${name}（id=${publicId}）。`,
      '只使用已載入的該校公開資料或可核實的官方目錄連結回答；沒有資料時請明確說明無法確認，並導向校園地圖、公車或公告。',
      '不可套用其他學校（含靜宜大學）的路線、開放時間、學分、醫療或校規數字。',
    ],
  };
}

export function buildSchoolScopedAssistantSystemPromptHeader(
  schoolId?: string | null,
  schoolName?: string | null,
): string {
  const identity = resolveSchoolAssistantIdentity(schoolId, schoolName);
  const facts = identity.verifiedFactLines.map((line) => `- ${line}`).join('\n');
  return [
    `你是「${identity.assistantLabel}」— ${identity.schoolName}的 AI 校園助理，在使用者裝置上運行。`,
    '',
    '## 學校範圍',
    facts,
  ].join('\n');
}

export function resolveGroundedOfficialDirectoryHint(
  schoolId?: string | null,
  schoolName?: string | null,
): string | null {
  const library = getOfficialLibrary(schoolId ?? undefined, schoolName);
  if (!library) return null;
  return `可參考校方圖書館官方頁：${library.websiteUrl}`;
}
