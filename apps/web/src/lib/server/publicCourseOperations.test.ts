// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import {
  getPublicCourseOperation,
  listPublicCourseOperations,
  resolvePublicCourseOperation,
} from '@campus/shared/src/publicCourseOperations';
import { searchNcnuCourseCatalog } from './ncnuCourseCatalog';
import { searchNthuCourseCatalog } from './nthuCourseCatalog';
import { executePublicCourseOperation, PublicCourseOperationError } from './publicCourseOperations';

vi.mock('./ncnuCourseCatalog', () => ({ searchNcnuCourseCatalog: vi.fn() }));
vi.mock('./nthuCourseCatalog', () => ({ searchNthuCourseCatalog: vi.fn() }));

const ncnu = vi.mocked(searchNcnuCourseCatalog);
const nthu = vi.mocked(searchNthuCourseCatalog);
const fetchedAt = '2026-11-07T10:20:30.000Z';

function catalog(schoolId: PublicCourseCatalogResponse['schoolId']): PublicCourseCatalogResponse {
  return {
    schoolId,
    sourceUrl: resolvePublicCourseOperation(schoolId)!.sourceUrl,
    fetchedAt,
    courses: [
      {
        code: schoolId === 'ncnu' ? '005076' : '11510CS  772000',
        section: '00',
        title: '資料庫系統',
        department: '資訊系',
        teacher: '授課老師',
        time: 'W3W4',
        room: 'A101',
        semester: '1151',
        credits: '3',
        meetings: [{ time: 'W3W4', room: 'A101' }],
      },
    ],
    truncated: false,
  };
}

beforeEach(() => {
  ncnu.mockReset().mockResolvedValue(catalog('ncnu'));
  nthu.mockReset().mockResolvedValue(catalog('nthu'));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network request');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reviewed public course operations', () => {
  it('lists only the two immutable anonymous operations and their fixed endpoint bindings', () => {
    expect(listPublicCourseOperations().map((operation) => operation.id)).toEqual([
      'ncnu.courses.search',
      'nthu.courses.search',
    ]);
    for (const operation of listPublicCourseOperations()) {
      expect(getPublicCourseOperation(operation.id)).toBe(operation);
      expect(resolvePublicCourseOperation(operation.schoolId)).toBe(operation);
      expect(operation).toMatchObject({
        version: 1,
        responseSchemaVersion: 1,
        access: 'anonymous-public',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', maxLength: 80 } },
          additionalProperties: false,
        },
        endpoint: {
          method: 'GET',
          path: '/api/public-course-catalog',
          fixedQuery: { schoolId: operation.schoolId },
          inputQuery: { query: 'q' },
        },
      });
      expect(Reflect.set(operation, 'upstreamUrl', 'https://example.test/')).toBe(false);
      expect(Reflect.set(operation.endpoint.fixedQuery, 'schoolId', 'pu')).toBe(false);
      expect(Reflect.set(operation.inputSchema.properties.query, 'maxLength', 1000)).toBe(false);
    }
    expect(Object.isFrozen(listPublicCourseOperations())).toBe(true);
    expect(ncnu).not.toHaveBeenCalled();
    expect(nthu).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['', 'pu', 'constructor', '__proto__', 'toString', 'https://example.test/'])(
    'does not resolve unreviewed school %s',
    (schoolId) => {
      expect(resolvePublicCourseOperation(schoolId)).toBeNull();
    },
  );

  it.each([
    '',
    'pu.courses.search',
    'constructor',
    '__proto__',
    'toString',
    'https://example.test/',
  ])('rejects operation %s before reading any source', async (operationId) => {
    await expect(
      executePublicCourseOperation(operationId, { query: '資料庫' }),
    ).rejects.toMatchObject({ kind: 'input' });
    expect(ncnu).not.toHaveBeenCalled();
    expect(nthu).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing object', undefined],
    ['null', null],
    ['array', []],
    ['plain text', '資料庫'],
    ['non-string query', { query: 1 }],
    ['explicit undefined', { query: undefined }],
    ['oversized query', { query: 'a'.repeat(81) }],
    ['oversized Unicode query', { query: '𠮷'.repeat(81) }],
    ['URL', { query: '資料庫', url: 'http://127.0.0.1/' }],
    ['headers', { headers: { Authorization: 'Bearer private' } }],
    ['cookie', { cookies: 'session=private' }],
    ['script', { script: 'fetch("https://example.test/")' }],
    ['school override', { schoolId: 'nthu' }],
    ['prototype property', JSON.parse('{"__proto__":{"query":"private"}}')],
    ['inherited values', Object.create({ query: 'private' })],
    ['symbol property', { [Symbol('url')]: 'https://example.test/' }],
  ])('rejects %s without starting a provider read', async (_name, input) => {
    await expect(executePublicCourseOperation('ncnu.courses.search', input)).rejects.toMatchObject({
      kind: 'input',
    });
    expect(ncnu).not.toHaveBeenCalled();
    expect(nthu).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not evaluate a query accessor', async () => {
    const getter = vi.fn(() => 'private');
    const input = Object.defineProperty({}, 'query', { get: getter, enumerable: true });
    await expect(executePublicCourseOperation('ncnu.courses.search', input)).rejects.toMatchObject({
      kind: 'input',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(ncnu).not.toHaveBeenCalled();
    expect(nthu).not.toHaveBeenCalled();
  });

  it('binds each valid request to the matching school and retains the actual snapshot time', async () => {
    const [first, second] = await Promise.all([
      executePublicCourseOperation('ncnu.courses.search', { query: '資料庫' }),
      executePublicCourseOperation('nthu.courses.search', {}),
    ]);
    expect(ncnu.mock.calls).toEqual([['資料庫']]);
    expect(nthu.mock.calls).toEqual([['']]);
    expect(first).toMatchObject({
      schoolId: 'ncnu',
      fetchedAt,
      operation: {
        id: 'ncnu.courses.search',
        version: 1,
        responseSchemaVersion: 1,
        access: 'anonymous-public',
      },
    });
    expect(second).toMatchObject({
      schoolId: 'nthu',
      fetchedAt,
      operation: {
        id: 'nthu.courses.search',
        version: 1,
        responseSchemaVersion: 1,
        access: 'anonymous-public',
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts an 80-character query and a data-only object without a prototype', async () => {
    const query = '課'.repeat(80);
    const input = Object.assign(Object.create(null), { query });
    await executePublicCourseOperation('ncnu.courses.search', input);
    expect(ncnu).toHaveBeenCalledWith(query);
  });

  it('counts 80 supplementary Unicode characters as 80 characters, matching the advertised schema', async () => {
    const query = '𠮷'.repeat(80);
    await executePublicCourseOperation('ncnu.courses.search', { query });
    expect(ncnu.mock.calls).toEqual([[query]]);
    expect(nthu).not.toHaveBeenCalled();
  });

  it('returns only public fields and copies nested course data', async () => {
    const source = {
      ...catalog('ncnu'),
      cookies: 'private-cookie',
      authorization: 'private-authorization',
      courses: [
        {
          ...catalog('ncnu').courses[0],
          studentId: 'private-student-id',
          meetings: [{ time: 'W3W4', room: 'A101', token: 'private-token' }],
        },
      ],
    };
    ncnu.mockResolvedValue(source);
    const result = await executePublicCourseOperation('ncnu.courses.search', {});
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(result.courses).not.toBe(source.courses);
    expect(result.courses[0]).not.toBe(source.courses[0]);
    expect(result.courses[0].meetings?.[0]).not.toBe(source.courses[0].meetings[0]);
    expect(result.courses[0].code).toBe('005076');
  });

  it.each([
    ['wrong school', () => catalog('nthu')],
    ['wrong source', () => ({ ...catalog('ncnu'), sourceUrl: 'https://example.test/catalog' })],
    ['missing timestamp', () => ({ ...catalog('ncnu'), fetchedAt: undefined })],
    ['invalid timestamp', () => ({ ...catalog('ncnu'), fetchedAt: 'yesterday' })],
    ['invalid row', () => ({ ...catalog('ncnu'), courses: [{ code: '005076' }] })],
    ['invalid count', () => ({ ...catalog('ncnu'), truncated: 'false' })],
    [
      'wrong operation',
      () => ({
        ...catalog('ncnu'),
        operation: {
          id: 'nthu.courses.search',
          version: 1,
          responseSchemaVersion: 1,
          access: 'anonymous-public',
        },
      }),
    ],
    [
      'unrecognized version',
      () => ({
        ...catalog('ncnu'),
        operation: {
          id: 'ncnu.courses.search',
          version: 2,
          responseSchemaVersion: 1,
          access: 'anonymous-public',
        },
      }),
    ],
    [
      'unrecognized schema',
      () => ({
        ...catalog('ncnu'),
        operation: {
          id: 'ncnu.courses.search',
          version: 1,
          responseSchemaVersion: 2,
          access: 'anonymous-public',
        },
      }),
    ],
    ['error object', () => ({ error: 'private-provider-detail' })],
  ])('rejects %s rather than issuing a verified result', async (_name, makeSource) => {
    ncnu.mockResolvedValue(makeSource() as PublicCourseCatalogResponse);
    await expect(executePublicCourseOperation('ncnu.courses.search', {})).rejects.toMatchObject({
      kind: 'upstream',
    });
    expect(ncnu).toHaveBeenCalledTimes(1);
    expect(nthu).not.toHaveBeenCalled();
  });

  it('preserves a successful empty search and truncation without inferring personal enrollment', async () => {
    ncnu.mockResolvedValue({ ...catalog('ncnu'), courses: [] });
    expect(
      await executePublicCourseOperation('ncnu.courses.search', { query: '查無此課' }),
    ).toMatchObject({
      courses: [],
      truncated: false,
      operation: { access: 'anonymous-public' },
    });
    nthu.mockResolvedValue({ ...catalog('nthu'), truncated: true });
    expect(await executePublicCourseOperation('nthu.courses.search', {})).toMatchObject({
      truncated: true,
    });
  });

  it('classifies provider failure without exposing its request details or trying another school', async () => {
    ncnu.mockRejectedValue(new Error('Authorization: private-secret'));
    const error = await executePublicCourseOperation('ncnu.courses.search', {}).catch(
      (problem) => problem,
    );
    expect(error).toBeInstanceOf(PublicCourseOperationError);
    expect(error.kind).toBe('upstream');
    expect(error.message).not.toContain('private-secret');
    expect(error.cause).toBeUndefined();
    expect(nthu).not.toHaveBeenCalled();
  });
});
