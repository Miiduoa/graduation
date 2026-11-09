// @vitest-environment node
import { expect, it } from 'vitest';
import { awsUriEncode, presignS3Request } from './awsS3';

const config = {
  accessKeyId: 'AKIA',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  bucket: 'test-bucket',
  endpoint: 'http://127.0.0.1:9000',
  region: 'auto',
};

it('encodes path segments without turning slashes into the object key', () => {
  expect(awsUriEncode('cover.jpg')).toBe('cover.jpg');
  expect(awsUriEncode('a b')).toBe('a%20b');
});

it('issues a 60-second path-style PUT URL bound to content type and length', () => {
  const signed = presignS3Request(config, {
    method: 'PUT',
    key: 'assignments/work/submissions/alice/answer.pdf',
    expiresSeconds: 600,
    headers: {
      'content-type': 'application/pdf',
      'content-length': '12',
      'if-none-match': '*',
    },
    now: new Date('2026-11-09T00:00:00.000Z'),
  });
  const url = new URL(signed.url);
  expect(url.origin).toBe('http://127.0.0.1:9000');
  expect(url.pathname).toBe('/test-bucket/assignments/work/submissions/alice/answer.pdf');
  expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
  expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
  expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
  expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('if-none-match');
  expect(signed.headers['content-type']).toBe('application/pdf');
  expect(signed.headers['if-none-match']).toBe('*');
  expect(signed.expiresAt).toBe('2026-11-09T00:01:00.000Z');
});

it('signs response MIME and attachment disposition into GET query parameters', () => {
  const input = { method: 'GET' as const, key: 'groups/g/posts/p/a.pdf', expiresSeconds: 60, now: new Date('2026-11-09T00:00:00Z') };
  const signed = presignS3Request(config, { ...input, responseContentType: 'application/pdf', responseContentDisposition: 'attachment' });
  const url = new URL(signed.url);
  expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
  expect(url.searchParams.get('response-content-disposition')).toBe('attachment');
  expect(url.searchParams.get('X-Amz-Signature')).not.toBe(new URL(presignS3Request(config, input).url).searchParams.get('X-Amz-Signature'));
});
