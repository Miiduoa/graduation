import { resolveLmsMaterialUrl } from '../services/lmsV2MaterialAccess';

const courseId = '11111111-1111-4111-8111-111111111111';

test('opens only HTTPS external materials without a storage signer', async () => {
  const sign = jest.fn();
  await expect(resolveLmsMaterialUrl({ external_url: 'https://example.org/study.pdf' }, courseId, sign))
    .resolves.toBe('https://example.org/study.pdf');
  expect(sign).not.toHaveBeenCalled();
  await expect(resolveLmsMaterialUrl({ external_url: 'javascript:alert(1)' }, courseId, sign))
    .rejects.toThrow('HTTPS');
  await expect(resolveLmsMaterialUrl({ external_url: 'http://example.org/doc' }, courseId, sign))
    .rejects.toThrow('HTTPS');
});

test('requests a short-lived signed URL only for a file in the current course', async () => {
  const path = `${courseId}/materials/reading.pdf`;
  const sign = jest.fn().mockResolvedValue({
    data: { signedUrl: 'https://files.example.org/object?token=temporary' }, error: null,
  });
  const link = await resolveLmsMaterialUrl({ storage_path: path }, courseId, sign);
  expect(link).toBe('https://files.example.org/object?token=temporary');
  expect(sign).toHaveBeenCalledWith(path, 60);
  await expect(resolveLmsMaterialUrl({ storage_path: 'other-course/secret.pdf' }, courseId, sign))
    .rejects.toThrow('不屬於');
  await expect(resolveLmsMaterialUrl({ storage_path: `${courseId}/../secret.pdf` }, courseId, sign))
    .rejects.toThrow('不屬於');
  expect(sign).toHaveBeenCalledTimes(1);
});

test('missing or denied material does not pretend to have a working download URL', async () => {
  const denied = jest.fn().mockResolvedValue({ data: null, error: { message: 'denied' } });
  await expect(resolveLmsMaterialUrl({ storage_path: `${courseId}/a.pdf` }, courseId, denied))
    .rejects.toThrow('授權');
  await expect(resolveLmsMaterialUrl({}, courseId, denied)).rejects.toThrow('尚未提供');
  expect(denied).toHaveBeenCalledTimes(1);
});
