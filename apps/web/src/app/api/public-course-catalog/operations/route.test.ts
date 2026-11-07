// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public course operation discovery', () => {
  it('describes only reviewed reads without accessing an account or fetching upstream data', async () => {
    const fetchSource = vi.fn(() => {
      throw new Error('Discovery must not fetch');
    });
    vi.stubGlobal('fetch', fetchSource);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.operations).toHaveLength(2);
    expect(body.operations.map((operation: { id: string }) => operation.id)).toEqual([
      'ncnu.courses.search',
      'nthu.courses.search',
    ]);
    for (const operation of body.operations) {
      expect(operation).toMatchObject({
        access: 'anonymous-public',
        version: 1,
        responseSchemaVersion: 1,
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
      expect(operation).not.toHaveProperty('headers');
      expect(operation).not.toHaveProperty('cookies');
      expect(operation).not.toHaveProperty('fetchedAt');
      expect(operation).not.toHaveProperty('courses');
    }
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('does not persist changes made to a previous discovery response', async () => {
    const first = await (await GET()).json();
    first.operations[0].upstreamUrl = 'https://example.test/';
    first.operations[0].endpoint.fixedQuery.schoolId = 'pu';
    const second = await (await GET()).json();
    expect(second.operations[0].schoolId).toBe('ncnu');
    expect(second.operations[0].endpoint.fixedQuery.schoolId).toBe('ncnu');
    expect(second.operations[0].upstreamUrl).toBe(
      'https://ccweb6.ncnu.edu.tw/student/current_semester_opened_listlist.php?export=csv',
    );
  });

  it('requires an explicit v2 discovery request and describes at least one executable filter', async () => {
    const fetchSource = vi.fn(() => { throw new Error('Discovery must not fetch'); });
    vi.stubGlobal('fetch', fetchSource);
    const legacy = await (await GET(new Request('https://example.test/api/public-course-catalog/operations?version=1'))).json();
    expect(legacy).toEqual(await (await GET()).json());
    const response = await GET(new Request('https://example.test/api/public-course-catalog/operations?version=2'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const directory = await response.json();
    expect(directory.schemaVersion).toBe(1);
    expect(directory.operations).toHaveLength(2);
    for (const operation of directory.operations) {
      expect(operation).toMatchObject({
        version: 2, responseSchemaVersion: 2, access: 'anonymous-public',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: {
            query: { type: 'string', maxLength: 80 },
            weekday: { type: 'integer', minimum: 1, maximum: 7 },
            credits: { type: 'number', minimum: 0, maximum: 40, multipleOf: 0.01 },
          },
          anyOf: [{ required: ['weekday'] }, { required: ['credits'] }],
        },
        endpoint: {
          method: 'GET', path: '/api/public-course-catalog', fixedQuery: { schoolId: operation.schoolId },
          inputQuery: { query: 'q', weekday: 'weekday', credits: 'credits' },
        },
      });
    }
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it.each(['version=', 'version=0', 'version=3', 'version=02', 'version=1&version=2', 'version=2&schoolId=ncnu', 'headers=Cookie'])(
    'rejects invalid discovery parameters %s without a source read', async (query) => {
      const fetchSource = vi.fn();
      vi.stubGlobal('fetch', fetchSource);
      const response = await GET(new Request('https://example.test/api/public-course-catalog/operations?' + query));
      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).not.toHaveProperty('operations');
      expect(fetchSource).not.toHaveBeenCalled();
    },
  );
});
