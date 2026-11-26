// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getAssistantLibraryCatalog, parseLibraryCatalogRead } from '@campus/shared/src/assistantLibraryCatalog';
import { officialLibraryDirectory } from '@campus/shared/src/officialLibraries';
import { parseCampusMapCommand } from '@campus/shared/src/assistantCampusMapIntent';
import { crossServiceRequest } from './crossServiceRequest';
import { parseLibraryCatalogArguments, parseLibraryCatalogResult, readLibraryCatalog } from './libraryCatalog';

describe('selected-school public library directory', () => {
  it('projects only the public catalog, website and documented hours page for every curated school', () => {
    for (const [schoolId, official] of Object.entries(officialLibraryDirectory)) {
      const expected = { name: official.name, catalogUrl: official.catalogUrl, websiteUrl: official.websiteUrl,
        ...(official.hoursUrl ? { hoursUrl: official.hoursUrl } : {}) };
      expect(getAssistantLibraryCatalog(schoolId)).toEqual(expected);
      const result = readLibraryCatalog(schoolId);
      expect(result.library).toEqual(expected);
      expect(parseLibraryCatalogResult(result, schoolId)).toEqual(result);
    }
    expect(getAssistantLibraryCatalog('nchu')?.catalogUrl).toBe(officialLibraryDirectory['tw-nchu'].catalogUrl);
    expect(getAssistantLibraryCatalog('tw-pu')).toEqual(getAssistantLibraryCatalog('pu'));
    expect(readLibraryCatalog('tw-pu')).toMatchObject({ schoolId: 'tw-pu', href: '/library?schoolId=tw-pu' });
    expect(() => parseLibraryCatalogResult(readLibraryCatalog('tw-pu'), 'pu')).toThrow();
    for (const schoolId of ['unknown-campus', 'personal', 'tw-pu-unverified', '__proto__'])
      expect(getAssistantLibraryCatalog(schoolId)).toBeNull();
  });

  it('rejects a foreign, forged, or expanded source instead of displaying its URL', () => {
    const pu = readLibraryCatalog('pu');
    expect(() => parseLibraryCatalogResult(pu, 'ntu')).toThrow();
    expect(() => parseLibraryCatalogArguments({ schoolId: 'pu' })).toThrow();
    expect(() => parseLibraryCatalogArguments(null)).toThrow();
    expect(() => parseLibraryCatalogArguments({ query: '移民史' })).toThrow();
    for (const library of [{ ...pu.library, catalogUrl: 'https://example.org' },
      { ...pu.library, accountUrl: 'https://example.org' }, { ...pu.library, hoursUrl: undefined }])
      expect(() => parseLibraryCatalogResult({ ...pu, library }, 'pu')).toThrow();
    const getter = vi.fn();
    expect(() => parseLibraryCatalogResult(Object.defineProperty({ ...pu }, 'library', { get: getter }), 'pu')).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['查本校圖書館的館藏網址', '查本校圖書館館藏入口', '查館藏入口', '校圖館藏目錄', '請幫我查看本校的圖書館館藏入口在哪裡呢？'])(
    'recognizes the complete catalog query %s', question => {
      expect(parseLibraryCatalogRead(question)).toEqual({ tool: 'get_library_catalog', args: {} });
    },
  );

  it.each(['清大館藏網址', '請幫我續借圖書', '圖書館現在有開嗎', '查本校圖書館的館藏網址並預約座位',
    '我的借閱紀錄', '查圖書館有沒有這本書', '不要查館藏入口', '查館藏入口\n查別間學校', '查看查看本校館藏入口'])(
    'does not treat the unsupported request %s as a directory lookup', question => {
      expect(parseLibraryCatalogRead(question)).toBeNull();
    },
  );

  it('requires a preceding library catalog before binding a library reference as a map task', () => {
    const now = Date.parse('2026-11-05T04:00:00Z');
    for (const question of ['這間圖書館在哪裡', '查學校電話，這間圖書館在哪裡',
      '查本校圖書館的館藏網址，查學校電話，這間圖書館在哪裡']) {
      expect(parseCampusMapCommand(question)).toBeNull();
      expect(crossServiceRequest(question, now, 'pu')).toBeNull();
    }
  });
});
