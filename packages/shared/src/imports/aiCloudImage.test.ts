import { describe, expect, it, vi } from 'vitest';
import { requestPersonalImportCloudImage } from './aiCloudImage';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOrn5lYAAAAASUVORK5CYII=';
const input = { base64: png, mime: 'image/png' as const, kind: 'timetable' as const, explicitConsent: true };

describe('cloud image request', () => {
  it('never sends a photo without explicit consent', async () => {
    const fetcher = vi.fn();
    expect((await requestPersonalImportCloudImage({ ...input, explicitConsent: false, fetcher })).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends only a deliberately approved image with JSON and preserves the cloud-provider label', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ provider: 'cloud-vision', output: '{"complete":true,"rows":[]}' }));
    const result = await requestPersonalImportCloudImage({
      ...input, academicYear: '115', semester: '1', fetcher, headers: { 'X-Campus-Session': 'scope' },
    });
    expect(result).toEqual({ ok: true, output: '{"complete":true,"rows":[]}' });
    const options = fetcher.mock.calls[0][1];
    expect(JSON.parse(options.body)).toMatchObject({ imageBase64: png, explicitConsent: true, kind: 'timetable' });
    expect(options.headers['X-Campus-Session']).toBe('scope');
    expect(options.cache).toBe('no-store');
  });
  it('does not mislabel a missing provider or a failed request as cloud vision', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ provider: 'cloud', output: '{}' }));
    expect((await requestPersonalImportCloudImage({ ...input, fetcher })).ok).toBe(false);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect((await requestPersonalImportCloudImage({ ...input, fetcher })).ok).toBe(false);
  });
});
