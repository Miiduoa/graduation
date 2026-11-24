import { fetchWithPerformance, performance } from '../../services/performance';

describe('fetchWithPerformance', () => {
  const originalFetch = globalThis.fetch;
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    globalThis.fetch = mockFetch;
    performance.getDataStore().clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    performance.getDataStore().clear();
  });

  function responseWithLength(length: string | null, status = 200) {
    const response = {
      status,
      headers: {
        get: jest.fn((name: string) =>
          name === 'content-length' ? length : 'application/json',
        ),
      },
      clone: jest.fn(() => {
        throw new Error('response must not be cloned by telemetry');
      }),
      text: jest.fn(),
    };
    mockFetch.mockResolvedValue(response);
    return response;
  }

  it('returns the original response without cloning or consuming its body', async () => {
    const response = responseWithLength('1024');
    const options = { method: 'GET' };
    await expect(fetchWithPerformance('https://example.test/data', options)).resolves.toBe(response);
    expect(mockFetch).toHaveBeenCalledWith('https://example.test/data', options);
    expect(response.clone).not.toHaveBeenCalled();
    expect(response.text).not.toHaveBeenCalled();
    expect(performance.getDataStore().getHttpMetrics()[0]).toMatchObject({
      responseSize: 1024,
      responseCode: 200,
      attributes: {
        response_size_source: 'content-length',
        duration_scope: 'response_headers',
      },
    });
  });

  it.each([null, '', '-1', '1.5', 'not-a-number', '9007199254740992'])(
    'records an unknown size for an absent or invalid length (%s)',
    async (length) => {
      const response = responseWithLength(length);
      await expect(fetchWithPerformance('https://example.test/stream')).resolves.toBe(response);
      expect(response.clone).not.toHaveBeenCalled();
      expect(performance.getDataStore().getHttpMetrics()[0]).toMatchObject({
        responseSize: 0,
        attributes: { response_size_source: 'unknown' },
      });
    },
  );

  it('distinguishes an explicitly empty response from an unknown length', async () => {
    responseWithLength('0', 204);
    await fetchWithPerformance('https://example.test/empty');
    expect(performance.getDataStore().getHttpMetrics()[0]).toMatchObject({
      responseSize: 0,
      attributes: { response_size_source: 'content-length' },
    });
  });

  it('counts transport errors and HTTP error responses, without treating all status-zero responses as failures', async () => {
    const error = new Error('network unavailable');
    mockFetch.mockRejectedValueOnce(error);
    await expect(fetchWithPerformance('https://example.test/offline')).rejects.toBe(error);
    responseWithLength(null, 503);
    await fetchWithPerformance('https://example.test/unavailable');
    responseWithLength(null, 0);
    await fetchWithPerformance('https://example.test/opaque');
    responseWithLength('20');
    await fetchWithPerformance('https://example.test/ok');
    const store = performance.getDataStore();
    expect(store.getErrorHttpRequests()).toHaveLength(2);
    expect(performance.getReport().httpStats.errorRate).toBe(0.5);
  });
});
