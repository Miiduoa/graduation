import {
  publicSchoolInfoDirectory,
  publicSchoolInfoRecordCount,
  type PublicSchoolInfoRecord,
} from './publicSchoolInfoData';

export type { PublicSchoolInfoRecord };
export { publicSchoolInfoDirectory, publicSchoolInfoRecordCount };

/** Evidence snapshot date for the bundled MOE directory join (not live operating status). */
export const PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE = '2026-10-24';

/** Human-readable catalog page for the official open dataset. */
export const PUBLIC_SCHOOL_INFO_CATALOG_URL = 'https://data.gov.tw/dataset/6091';

/** Stable JSON endpoint referenced by the bundled rows. */
export const PUBLIC_SCHOOL_INFO_SOURCE_URL =
  'https://stats.moe.gov.tw/files/opendata/u1_new.json';

/**
 * Known legacy public-contact alias: tw-nchu -> nchu.
 * Keep the 138 canonical records unique; no fuzzy/prefix/name-only match.
 */
const PUBLIC_SCHOOL_INFO_ID_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'tw-nchu': 'nchu',
});

function resolvePublicSchoolInfoId(schoolId: string): string {
  if (Object.prototype.hasOwnProperty.call(PUBLIC_SCHOOL_INFO_ID_ALIASES, schoolId)) {
    return PUBLIC_SCHOOL_INFO_ID_ALIASES[schoolId]!;
  }
  return schoolId;
}

/**
 * Look up bundled public contact fields by exact production school ID.
 * When a selected display name is provided, it must match the official identity
 * exactly; conflicting or unresolved names return unavailable (no PU fallback).
 */
export function getPublicSchoolInfo(
  schoolId?: string | null,
  schoolName?: string | null,
): PublicSchoolInfoRecord | null {
  if (!schoolId) return null;
  const canonicalId = resolvePublicSchoolInfoId(schoolId);
  if (!Object.prototype.hasOwnProperty.call(publicSchoolInfoDirectory, canonicalId)) {
    return null;
  }
  const record = publicSchoolInfoDirectory[canonicalId];
  if (!record) return null;
  if (schoolName != null && schoolName.trim() !== '') {
    if (schoolName.trim() !== record.name) return null;
  }
  return record;
}

/** Strip leading MOE `[code]` markers for readable city / address labels. */
export function formatMoeBracketLabel(value: string): string {
  return value.replace(/^\[[^\]]+\]/, '').trim();
}

export function formatPublicSchoolCity(record: PublicSchoolInfoRecord): string {
  return formatMoeBracketLabel(record.cityLabel);
}

export function formatPublicSchoolAddress(record: PublicSchoolInfoRecord): string {
  return formatMoeBracketLabel(record.address);
}

/**
 * Accept only http(s) website URLs without credentials or other protocols.
 * Preserves the official scheme, hostname, and original string exactly
 * (no URL.toString() trailing-slash normalization).
 */
export function getSafePublicSchoolWebsiteUrl(
  value?: string | null,
): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;
  return value;
}

/**
 * Digits for a tel: action from the official switchboard string.
 * Ranges (~) and extensions (#) are ambiguous — return null so callers
 * can show the original display and offer copy instead of a misleading dial.
 */
export function getPublicSchoolTelHref(telephone: string): string | null {
  if (!telephone) return null;
  if (!/^\+?[0-9\s()-]+$/.test(telephone)) return null;
  const digits = telephone.replace(/[^0-9+]/g, '');
  if (!digits) return null;
  return `tel:${digits}`;
}

/**
 * Google Maps text search using official name + full source address.
 * Never embeds guessed coordinates.
 */
export function buildPublicSchoolMapsSearchUrl(record: PublicSchoolInfoRecord): string {
  const query = `${record.name} ${record.address}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
