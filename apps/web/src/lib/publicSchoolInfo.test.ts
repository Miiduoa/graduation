import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  PUBLIC_SCHOOL_INFO_CATALOG_URL,
  PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE,
  PUBLIC_SCHOOL_INFO_SOURCE_URL,
  buildPublicSchoolMapsSearchUrl,
  formatPublicSchoolAddress,
  formatPublicSchoolCity,
  getPublicSchoolInfo,
  getPublicSchoolTelHref,
  getSafePublicSchoolWebsiteUrl,
  publicSchoolInfoDirectory,
  publicSchoolInfoRecordCount,
  type PublicSchoolInfoRecord,
} from '@campus/shared/src/publicSchoolInfo';

/** SHA-256 of UTF-8 JSON.stringify(rows sorted by id localeCompare en, keys in fixed order). */
const VERIFIED_PUBLIC_SCHOOL_INFO_DIGEST =
  '447c083e4dc95281000fc0b7f80ced2248d3165c976f669de90dbdde7cf889a3';

const DIGEST_KEYS = [
  'id',
  'name',
  'moeCode',
  'academicYear',
  'cityLabel',
  'address',
  'telephone',
  'websiteUrl',
  'sourceUrl',
] as const;

function digestBundledRecords(): string {
  const rows = Object.values(publicSchoolInfoDirectory)
    .map((record) => {
      const row: Record<(typeof DIGEST_KEYS)[number], string> = {
        id: record.id,
        name: record.name,
        moeCode: record.moeCode,
        academicYear: record.academicYear,
        cityLabel: record.cityLabel,
        address: record.address,
        telephone: record.telephone,
        websiteUrl: record.websiteUrl,
        sourceUrl: record.sourceUrl,
      };
      return row;
    })
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

it('bundles exactly 138 public contact records matching the verified field digest', () => {
  expect(publicSchoolInfoRecordCount).toBe(138);
  expect(Object.keys(publicSchoolInfoDirectory)).toHaveLength(138);
  expect(digestBundledRecords()).toBe(VERIFIED_PUBLIC_SCHOOL_INFO_DIGEST);

  for (const record of Object.values(publicSchoolInfoDirectory)) {
    expect(getPublicSchoolInfo(record.id, record.name)).toEqual(record);
    expect(record).not.toHaveProperty('status');
    expect(getSafePublicSchoolWebsiteUrl(record.websiteUrl)).toBe(record.websiteUrl);
    const website = new URL(record.websiteUrl);
    expect(['http:', 'https:']).toContain(website.protocol);
    expect(website.username).toBe('');
    expect(website.password).toBe('');
  }
});

it('preserves renamed institutional names and legacy website hosts exactly', () => {
  expect(getPublicSchoolInfo('feu', '中信科技大學')?.websiteUrl).toBe('http://www.feu.edu.tw');
  expect(getPublicSchoolInfo('kyu', '台鋼科技大學')?.websiteUrl).toBe('http://www.kyu.edu.tw');
  expect(getPublicSchoolInfo('mmc', '馬偕醫學大學')?.websiteUrl).toBe('http://www.mmc.edu.tw');
  expect(getSafePublicSchoolWebsiteUrl('http://www.pu.edu.tw')).toBe('http://www.pu.edu.tw');
  expect(getSafePublicSchoolWebsiteUrl('https://www.ncnu.edu.tw/')).toBe('https://www.ncnu.edu.tw/');
});

it('rejects unknown, conflicting, and prototype-property identities without a PU fallback', () => {
  expect(getPublicSchoolInfo(null)).toBeNull();
  expect(getPublicSchoolInfo('unknown-campus')).toBeNull();
  expect(getPublicSchoolInfo('__proto__')).toBeNull();
  expect(getPublicSchoolInfo('constructor')).toBeNull();
  expect(getPublicSchoolInfo('toString')).toBeNull();
  expect(getPublicSchoolInfo('pu', '國立清華大學')).toBeNull();
  expect(getPublicSchoolInfo('nthu', '靜宜大學')).toBeNull();
  expect(getPublicSchoolInfo('other', '靜宜大學')).toBeNull();
  expect(getPublicSchoolInfo('shu')).toBeNull();
  expect(getPublicSchoolInfo('pu')?.name).toBe('靜宜大學');
});

it('resolves only the approved tw-nchu alias with matching official name', () => {
  const nchu = getPublicSchoolInfo('nchu', '國立中興大學')!;
  expect(nchu.id).toBe('nchu');
  expect(getPublicSchoolInfo('tw-nchu', '國立中興大學')).toEqual(nchu);
  expect(getPublicSchoolInfo('tw-nchu')).toEqual(nchu);
  expect(getPublicSchoolInfo('tw-nchu', '靜宜大學')).toBeNull();
  expect(getPublicSchoolInfo('tw-nchu', '國立中興大學XX')).toBeNull();
  expect(getPublicSchoolInfo('tw-unknown')).toBeNull();
  expect(Object.keys(publicSchoolInfoDirectory)).not.toContain('tw-nchu');
  expect(publicSchoolInfoRecordCount).toBe(138);
});

it('keeps ambiguous range and extension phones display-only without a tel: target', () => {
  const unusual: Array<{ id: string; name: string; telephone: string }> = [
    { id: 'chu', name: '中華大學', telephone: '(03)5374281~5' },
    { id: 'cust', name: '中華科技大學', telephone: '(02)27821862~4' },
    { id: 'tajen', name: '大仁科技大學', telephone: '(08)7624002~5' },
    { id: 'ncnu', name: '國立暨南國際大學', telephone: '(049)2910960#2996' },
    { id: 'sju', name: '聖約翰科技大學', telephone: '(02)28013131#7011' },
  ];
  for (const row of unusual) {
    const record = getPublicSchoolInfo(row.id, row.name)!;
    expect(record.telephone).toBe(row.telephone);
    expect(getPublicSchoolTelHref(record.telephone)).toBeNull();
  }
  expect(getPublicSchoolTelHref('(04)26328001')).toBe('tel:0426328001');
  expect(getPublicSchoolTelHref('(04)22873181')).toBe('tel:0422873181');
});

it('builds safe phone and maps actions without guessed coordinates', () => {
  const pu = getPublicSchoolInfo('pu', '靜宜大學')!;
  expect(getPublicSchoolTelHref(pu.telephone)).toBe('tel:0426328001');
  const maps = new URL(buildPublicSchoolMapsSearchUrl(pu));
  expect(maps.origin + maps.pathname).toBe('https://www.google.com/maps/search/');
  expect(maps.searchParams.get('api')).toBe('1');
  expect(maps.searchParams.get('query')).toBe(`${pu.name} ${pu.address}`);
  expect(maps.searchParams.get('query')).not.toMatch(/-?\d+\.\d+,-?\d+\.\d+/);
  expect(formatPublicSchoolCity(pu)).toBe('臺中市');
  expect(formatPublicSchoolAddress(pu)).toBe('臺中市沙鹿區臺灣大道七段200號');
  expect(getSafePublicSchoolWebsiteUrl('ftp://evil.example')).toBeNull();
  expect(getSafePublicSchoolWebsiteUrl('https://user:pass@evil.example')).toBeNull();
  expect(getSafePublicSchoolWebsiteUrl('javascript:alert(1)')).toBeNull();
  expect(PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE).toBe('2026-10-24');
  expect(PUBLIC_SCHOOL_INFO_CATALOG_URL).toBe('https://data.gov.tw/dataset/6091');
  expect(PUBLIC_SCHOOL_INFO_SOURCE_URL).toBe(
    'https://stats.moe.gov.tw/files/opendata/u1_new.json',
  );
});

it('exposes only the nine public contact fields on each record', () => {
  const sample = getPublicSchoolInfo('nchu') as PublicSchoolInfoRecord;
  expect(Object.keys(sample).sort()).toEqual([...DIGEST_KEYS].sort());
});
