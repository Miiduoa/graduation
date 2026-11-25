// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createTronClassPlatformClosureDatabase, isTronClassPlatformClosureDatabaseUrl } from './tronClassPlatformClosureDatabase';

const url = 'postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic';
afterEach(() => vi.restoreAllMocks());

describe('bounded dedicated closure database pool', () => {
  it('sets connection and server/client query bounds without changing general SQL stores', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: '1' }] }), on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) };
    const factory = vi.fn(() => pool);
    const database = createTronClassPlatformClosureDatabase(url, factory);
    expect(factory).toHaveBeenCalledExactlyOnceWith({ connectionString: url, max: 2,
      connectionTimeoutMillis: 5_000, query_timeout: 10_000, statement_timeout: 10_000,
      options: '-c search_path=pg_catalog,public,pg_temp' });
    expect(await database.query('SELECT $1 AS id', ['1'])).toEqual([{ id: '1' }]);
    expect(pool.query).toHaveBeenCalledExactlyOnceWith('SELECT $1 AS id', ['1']);
    await database.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it.each(['options=-c%20statement_timeout%3D0', 'statement_timeout=0', 'query_timeout=0',
    'connectionTimeoutMillis=0', 'connect_timeout=0'])('rejects URL options that can bypass timeouts or the trusted schema: %s', query => {
    const factory = vi.fn();
    expect(isTronClassPlatformClosureDatabaseUrl(`${url}?${query}`)).toBe(false);
    expect(() => createTronClassPlatformClosureDatabase(`${url}?${query}`, factory)).toThrow('TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE');
    expect(factory).not.toHaveBeenCalled();
  });

  it.each(['postgresql://127.0.0.1/synthetic', 'postgresql://synthetic@127.0.0.1/', 'https://synthetic@private/db', 'invalid'])
    ('rejects incomplete or unrelated database configuration: %s', value => {
      expect(isTronClassPlatformClosureDatabaseUrl(value)).toBe(false);
    });

  it('keeps TLS configuration usable while fixing operational bounds', () => {
    expect(isTronClassPlatformClosureDatabaseUrl(`${url}?sslmode=verify-full`)).toBe(true);
  });

  it('sanitizes construction, query, idle connection and closing errors', async () => {
    expect(() => createTronClassPlatformClosureDatabase(url, () => { throw new Error('private-url'); }))
      .toThrow('TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let onError: ((error: unknown) => void) | undefined;
    const database = createTronClassPlatformClosureDatabase(url, () => ({
      query: async () => { throw new Error('private-url'); },
      on: (_event, listener) => { onError = listener; },
      end: async () => { throw new Error('private-url'); },
    }));
    await expect(database.query('SELECT 1')).rejects.toThrow('TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE');
    onError!(new Error('private-url'));
    expect(warning).toHaveBeenCalledExactlyOnceWith('TronClass platform account cleanup database connection failed');
    await expect(database.close()).rejects.toThrow('TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE');
  });
});
