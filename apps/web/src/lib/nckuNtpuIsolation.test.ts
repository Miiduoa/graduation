import { beforeEach, expect, it, vi } from 'vitest';
import {
  announcementSourceIdsForSchool,
  listAnnouncementCatalogLinks,
  parseCafeteriaLocations,
  parsePersonalImport,
  periodProfileForSchool,
  periodStart,
  publicDiningCafeterias,
} from '@campus/shared';
import {
  personalImportsStorageKey,
  readPersonalImports,
  savePersonalImportBatch,
} from './personalImports';
import { CAMPUS_TRANSIT, CAMPUS_TRANSIT_PUBLIC } from './transit';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  let lock = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_key: string, fn: () => unknown) => {
        const task = lock.then(fn);
        lock = task.then(
          () => undefined,
          () => undefined,
        );
        return task;
      },
    },
  });
});

it('keeps NCKU and NTPU announcement catalogs, dining, timetable and bus settings apart', () => {
  const nckuNews = listAnnouncementCatalogLinks('ncku');
  const ntpuNews = listAnnouncementCatalogLinks('ntpu');
  expect(nckuNews.map((item) => item.sourceId).sort()).toEqual(['ncku-aca', 'ncku-campus', 'ncku-osa']);
  expect(ntpuNews.map((item) => item.sourceId).sort()).toEqual(['ntpu-campus', 'ntpu-oga', 'ntpu-su']);
  expect(announcementSourceIdsForSchool('ncku').some((id) => id.startsWith('ntpu-'))).toBe(false);
  expect(announcementSourceIdsForSchool('ntpu').some((id) => id.startsWith('ncku-'))).toBe(false);
  expect(nckuNews.some((item) => item.listUrl.includes('ntpu.edu.tw'))).toBe(false);
  expect(ntpuNews.some((item) => item.listUrl.includes('ncku.edu.tw'))).toBe(false);

  const nckuDining = publicDiningCafeterias('ncku');
  const ntpuDining = publicDiningCafeterias('ntpu');
  expect(nckuDining.map((row) => row.name)).toContain('光復餐廳');
  expect(ntpuDining.map((row) => row.name)).toContain('優米自助餐');
  expect(nckuDining.some((row) => row.name === '優米自助餐' || row.schoolId === 'ntpu')).toBe(false);
  expect(ntpuDining.some((row) => row.name === '光復餐廳' || row.schoolId === 'ncku')).toBe(false);
  expect(nckuDining.find((row) => row.name === '光復餐廳')?.openingHours).toBe('待補');

  expect(periodProfileForSchool('ncku')).toBe('ncku');
  expect(periodProfileForSchool('ntpu')).toBe('ntpu');
  expect(periodStart(1, 'ncku')).toBe('07:00');
  expect(periodStart(1, 'ntpu')).toBe('08:10');
  expect(periodStart(10, 'ncku')).toBe('16:20');
  expect(periodStart(10, 'ntpu')).toBe('18:30');

  expect(CAMPUS_TRANSIT.ncku.city).toBe('Tainan');
  expect(CAMPUS_TRANSIT.ntpu.city).toBe('NewTaipei');
  expect(CAMPUS_TRANSIT_PUBLIC.ncku.stops.some((name) => name.includes('臺北大學'))).toBe(false);
  expect(CAMPUS_TRANSIT_PUBLIC.ntpu.stops.some((name) => name.includes('成大'))).toBe(false);
});

it('drops the other school’s dining rows when parsing a mixed catalog for one account', () => {
  const mixed = [
    { id: 'ncku-kuangfu', name: '光復餐廳', schoolId: 'ncku', merchantMode: 'info_only' },
    { id: 'ntpu-youmi', name: '優米自助餐', schoolId: 'ntpu', merchantMode: 'info_only' },
  ];
  expect(parseCafeteriaLocations(mixed, 'ncku').map((row) => row.id)).toEqual(['ncku-kuangfu']);
  expect(parseCafeteriaLocations(mixed, 'ntpu').map((row) => row.id)).toEqual(['ntpu-youmi']);
});

it('keeps NCKU and NTPU timetable imports on separate account keys', async () => {
  const nckuAccount = { owner: 'nuni:chengda', schoolId: 'ncku' };
  const ntpuAccount = { owner: 'nuni:beida', schoolId: 'ntpu' };
  const nckuRows = parsePersonalImport('課程名稱,星期,節次\n微積分,星期二,0', {
    kind: 'timetable',
    schoolId: 'ncku',
    academicYear: '115',
    semester: '1',
    periodProfile: 'ncku',
  }).rows;
  const ntpuRows = parsePersonalImport('課程名稱,星期,節次\n進階會計,星期一,10-13', {
    kind: 'timetable',
    schoolId: 'ntpu',
    academicYear: '115',
    semester: '1',
    periodProfile: 'ntpu',
  }).rows;
  await savePersonalImportBatch(nckuAccount, nckuRows);
  await savePersonalImportBatch(ntpuAccount, ntpuRows);
  expect(personalImportsStorageKey(nckuAccount)).not.toBe(personalImportsStorageKey(ntpuAccount));
  expect(readPersonalImports(nckuAccount).map((row) => row.title)).toEqual(['微積分']);
  expect(readPersonalImports(ntpuAccount).map((row) => row.title)).toEqual(['進階會計']);
  expect(readPersonalImports({ owner: nckuAccount.owner, schoolId: 'ntpu' })).toEqual([]);
  expect(readPersonalImports({ owner: ntpuAccount.owner, schoolId: 'ncku' })).toEqual([]);
  expect(readPersonalImports(nckuAccount)[0]?.startPeriod).toBe(1);
  expect(readPersonalImports(ntpuAccount)[0]?.startPeriod).toBe(10);
});
