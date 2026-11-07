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
});
