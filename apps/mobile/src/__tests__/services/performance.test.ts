import { fetchWithPerformance, performance, type HttpMetric } from '../../services/performance';

describe('fetchWithPerformance', () => {
  const originalFetch = globalThis.fetch;
  const mockFetch = jest.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    performance.setPerformanceCollectionEnabled(true);
    performance.setDataCollectionEnabled(true);
    globalThis.fetch = mockFetch;
    performance.getDataStore().clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    performance.setPerformanceCollectionEnabled(true);
    performance.setDataCollectionEnabled(true);
    globalThis.fetch = originalFetch;
    performance.getDataStore().clear();
  });

  function mockMetric() {
    const metric: jest.Mocked<HttpMetric> = {
      setHttpResponseCode: jest.fn(),
      setRequestPayloadSize: jest.fn(),
      setResponsePayloadSize: jest.fn(),
      setResponseContentType: jest.fn(),
      putAttribute: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(performance, 'newHttpMetric').mockReturnValue(metric);
    return metric;
  }

  function responseWithLength(length: string | null, status = 200) {
    const response = {
      status,
      headers: {
        get: jest.fn((name: string) => (name === 'content-length' ? length : 'application/json')),
      },
      clone: jest.fn(() => {
        throw new Error('response must not be cloned by telemetry');
      }),
      text: jest.fn(),
    };
    mockFetch.mockResolvedValue(response);
    return response;
  }

  it.each(['performance', 'data'] as const)(
    'bypasses HTTP instrumentation when %s collection is disabled',
    async (setting) => {
      const createMetric = jest.spyOn(performance, 'newHttpMetric');
      if (setting === 'performance') performance.setPerformanceCollectionEnabled(false);
      else performance.setDataCollectionEnabled(false);

      const response = responseWithLength('1024');
      const url = 'https://example.test/private';
      const options = { method: 'POST', body: 'payload' };
      await expect(fetchWithPerformance(url, options)).resolves.toBe(response);
      expect(mockFetch).toHaveBeenCalledWith(url, options);
      expect(response.headers.get).not.toHaveBeenCalled();
      expect(createMetric).not.toHaveBeenCalled();

      const networkError = new TypeError('network unavailable');
      mockFetch.mockRejectedValueOnce(networkError);
      await expect(fetchWithPerformance(url, options)).rejects.toBe(networkError);
      expect(createMetric).not.toHaveBeenCalled();
      expect(performance.getDataStore().getHttpMetrics()).toHaveLength(0);

      performance.setPerformanceCollectionEnabled(true);
      performance.setDataCollectionEnabled(true);
      responseWithLength('20');
      await fetchWithPerformance(url);
      expect(createMetric).toHaveBeenCalledTimes(1);
      expect(performance.getDataStore().getHttpMetrics()).toHaveLength(1);
    },
  );

  it('returns the original response without cloning or consuming its body', async () => {
    const response = responseWithLength('1024');
    const options = { method: 'GET' };
    await expect(fetchWithPerformance('https://example.test/data', options)).resolves.toBe(
      response,
    );
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

  it('records only the HTTP origin without changing the requested URL', async () => {
    const url = 'https://example.test:8443/private/student-123?token=secret#fragment';
    const response = responseWithLength('20');
    await expect(fetchWithPerformance(url)).resolves.toBe(response);
    expect(mockFetch).toHaveBeenCalledWith(url, {});
    const metric = performance.getDataStore().getHttpMetrics()[0];
    expect(metric.url).toBe('https://example.test:8443');
    expect(JSON.stringify(metric)).not.toMatch(/student-123|secret|fragment/);
  });

  it.each([
    ['https://user:password@example.test/private', 'https://example.test'],
    ['/private?token=secret', '[unknown-origin]'],
    ['data:text/plain,secret', '[unknown-origin]'],
    ['not a valid URL secret', '[unknown-origin]'],
  ])('does not retain credentials or unsafe URL input (%s)', async (url, expected) => {
    const metric = performance.newHttpMetric(url, 'GET');
    await metric.start();
    await metric.stop();
    expect(performance.getDataStore().getHttpMetrics()[0].url).toBe(expected);
  });

  it('records an error category instead of the potentially sensitive error message', async () => {
    const error = new TypeError('Network failure for https://example.test/private?token=secret');
    mockFetch.mockRejectedValueOnce(error);
    await expect(fetchWithPerformance('https://example.test/private')).rejects.toBe(error);
    const metric = performance.getDataStore().getHttpMetrics()[0];
    expect(metric.attributes).toMatchObject({ transport_error: 'true', error_kind: 'TypeError' });
    expect(JSON.stringify(metric)).not.toMatch(/secret|private/);
  });

  it('starts the fetch and returns its response while metric startup is pending', async () => {
    const metric = mockMetric();
    let finishStart!: () => void;
    metric.start.mockReturnValue(
      new Promise<void>((resolve) => {
        finishStart = resolve;
      }),
    );
    const response = responseWithLength('1024');

    const request = fetchWithPerformance('https://example.test/data');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await expect(request).resolves.toBe(response);
    expect(metric.stop).not.toHaveBeenCalled();

    finishStart();
    await Promise.resolve();
    await Promise.resolve();
    expect(metric.setHttpResponseCode).toHaveBeenCalledWith(200);
    expect(metric.stop).toHaveBeenCalledTimes(1);
  });

  it('returns its response without waiting for metric shutdown', async () => {
    const metric = mockMetric();
    let finishStop!: () => void;
    metric.stop.mockReturnValue(
      new Promise<void>((resolve) => {
        finishStop = resolve;
      }),
    );
    const response = responseWithLength('1024');

    await expect(fetchWithPerformance('https://example.test/data')).resolves.toBe(response);
    expect(metric.stop).toHaveBeenCalledTimes(1);
    finishStop();
  });

  it.each(['response', 'transport error'] as const)(
    'measures the time to %s without counting delayed telemetry startup',
    async (outcome) => {
      let now = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const metric = performance.newHttpMetric('https://example.test/data', 'GET');
      const start = metric.start.bind(metric);
      let finishStart!: () => void;
      jest.spyOn(metric, 'start').mockImplementation(() => {
        void start();
        return new Promise<void>((resolve) => {
          finishStart = resolve;
        });
      });
      jest.spyOn(performance, 'newHttpMetric').mockReturnValue(metric);
      const response = responseWithLength('1024');
      const networkError = new Error('network unavailable');
      mockFetch.mockImplementation(async () => {
        now = 100;
        if (outcome === 'transport error') throw networkError;
        return response;
      });

      const request = fetchWithPerformance('https://example.test/data');
      if (outcome === 'transport error') await expect(request).rejects.toBe(networkError);
      else await expect(request).resolves.toBe(response);
      expect(performance.getDataStore().getHttpMetrics()).toHaveLength(0);

      now = 5000;
      finishStart();
      await Promise.resolve();
      await Promise.resolve();
      expect(performance.getDataStore().getHttpMetrics()[0]).toMatchObject({
        duration: 100,
        attributes: {
          duration_scope: outcome === 'transport error' ? 'transport_failure' : 'response_headers',
        },
      });
      expect(performance.getReport().httpStats.slowRequests).toBe(0);
    },
  );

  it.each(['create', 'start', 'headers', 'annotate', 'stop'] as const)(
    'preserves a successful response when telemetry fails at %s',
    async (stage) => {
      const metric = mockMetric();
      const response = responseWithLength('1024');
      const failure = new Error(`telemetry ${stage} failed`);
      if (stage === 'create') {
        jest.spyOn(performance, 'newHttpMetric').mockImplementation(() => {
          throw failure;
        });
      } else if (stage === 'start') {
        metric.start.mockRejectedValue(failure);
      } else if (stage === 'headers') {
        response.headers.get.mockImplementation(() => {
          throw failure;
        });
      } else if (stage === 'annotate') {
        metric.setHttpResponseCode.mockImplementation(() => {
          throw failure;
        });
      } else {
        metric.stop.mockRejectedValue(failure);
      }

      await expect(fetchWithPerformance('https://example.test/data')).resolves.toBe(response);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(metric.putAttribute).not.toHaveBeenCalledWith('transport_error', 'true');
      if (stage !== 'create' && stage !== 'start') {
        expect(metric.stop).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(['start', 'annotate', 'stop'] as const)(
    'preserves the original fetch failure when telemetry fails at %s',
    async (stage) => {
      const metric = mockMetric();
      const networkError = new TypeError('network unavailable');
      const metricError = new Error('telemetry unavailable');
      mockFetch.mockRejectedValue(networkError);
      if (stage === 'start') metric.start.mockRejectedValue(metricError);
      else if (stage === 'annotate')
        metric.putAttribute.mockImplementation((name) => {
          if (name === 'transport_error') throw metricError;
        });
      else metric.stop.mockRejectedValue(metricError);

      await expect(fetchWithPerformance('https://example.test/offline')).rejects.toBe(networkError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      if (stage !== 'start') expect(metric.stop).toHaveBeenCalledTimes(1);
    },
  );
});

describe('performance collection privacy', () => {
  beforeEach(() => {
    performance.setPerformanceCollectionEnabled(true);
    performance.setDataCollectionEnabled(true);
    performance.getDataStore().clear();
  });

  afterEach(() => {
    performance.setPerformanceCollectionEnabled(true);
    performance.setDataCollectionEnabled(true);
    performance.getDataStore().clear();
  });

  it.each(['performance', 'data'] as const)(
    'does not collect traces or HTTP metrics while %s collection is disabled',
    async (setting) => {
      if (setting === 'performance') performance.setPerformanceCollectionEnabled(false);
      else performance.setDataCollectionEnabled(false);

      expect(performance.measure('disabled-sync', () => 42)).toBe(42);
      await expect(performance.measureAsync('disabled-async', async () => 43)).resolves.toBe(43);
      const metric = performance.newHttpMetric('https://example.test/private', 'GET');
      await metric.start();
      await metric.stop();
      expect(performance.getDataStore().getTraces()).toHaveLength(0);
      expect(performance.getDataStore().getHttpMetrics()).toHaveLength(0);
    },
  );

  it('ignores unstarted and repeated stops without resetting an active measurement', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const trace = performance.newTrace('one-shot');
      const metric = performance.newHttpMetric('https://example.test/data', 'GET');

      trace.stop();
      await metric.stop();
      expect(performance.getDataStore().getTraces()).toHaveLength(0);
      expect(performance.getDataStore().getHttpMetrics()).toHaveLength(0);

      trace.start();
      await metric.start();
      clock.mockReturnValue(60);
      trace.start();
      await metric.start();
      clock.mockReturnValue(100);
      trace.stop();
      await metric.stop();

      clock.mockReturnValue(200);
      trace.start();
      await metric.start();
      trace.stop();
      await metric.stop();
      expect(performance.getDataStore().getTraces()).toHaveLength(1);
      expect(performance.getDataStore().getHttpMetrics()).toHaveLength(1);
      expect(performance.getDataStore().getTraces()[0].duration).toBe(100);
      expect(performance.getDataStore().getHttpMetrics()[0].duration).toBe(100);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not record a negative elapsed duration when the wall clock moves backwards', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(100);
    try {
      const trace = performance.startTrace('clock-adjustment');
      const metric = performance.newHttpMetric('https://example.test/data', 'GET');
      await metric.start();
      clock.mockReturnValue(50);
      trace.stop();
      await metric.stop();
      expect(performance.getDataStore().getTraces()[0].duration).toBe(0);
      expect(performance.getDataStore().getHttpMetrics()[0].duration).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not revive pending metrics or traces after disabling and re-enabling collection', async () => {
    const trace = performance.startTrace('pending');
    const metric = performance.newHttpMetric('https://example.test/data', 'GET');
    await metric.start();
    performance.setDataCollectionEnabled(false);
    performance.setDataCollectionEnabled(true);
    trace.stop();
    await metric.stop();
    expect(performance.getDataStore().getTraces()).toHaveLength(0);
    expect(performance.getDataStore().getHttpMetrics()).toHaveLength(0);

    performance.measure('new-trace', () => 42);
    const nextMetric = performance.newHttpMetric('https://example.test/data', 'GET');
    await nextMetric.start();
    await nextMetric.stop();
    expect(performance.getDataStore().getTraces()).toHaveLength(1);
    expect(performance.getDataStore().getHttpMetrics()).toHaveLength(1);
  });

  it('records only the error category while preserving the original sync and async errors', async () => {
    const error = new TypeError('private student-123?token=secret');
    expect(() =>
      performance.measure('sync', () => {
        throw error;
      }),
    ).toThrow(error);
    await expect(
      performance.measureAsync('async', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    const traces = performance.getDataStore().getTraces();
    expect(traces).toHaveLength(2);
    for (const trace of traces) {
      expect(trace.attributes).toEqual({ success: 'false', error_kind: 'TypeError' });
      expect(JSON.stringify(trace)).not.toMatch(/student-123|secret/);
    }
  });
});
