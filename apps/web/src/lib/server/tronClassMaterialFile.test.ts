// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isTronClassMaterialDownloadAllowed, tronClassMaterialUploadKey } from './tronClassMaterialFile';

describe('ordinary TronClass material file identity', () => {
  it('uses the official numeric upload ID even when a separate storage key is present', () => {
    expect(tronClassMaterialUploadKey({ id: 741 })).toBe('741');
    expect(tronClassMaterialUploadKey({ id: 741, key: 'storage-key' })).toBe('741');
  });

  it.each([null, 0, -1, 1.5, '741', ['741'], Number.MAX_SAFE_INTEGER + 1])(
    'does not fall back to a storage key after an invalid supplied upload ID: %j', (id) => {
      expect(tronClassMaterialUploadKey({ id, key: 'legacy-key' })).toBeNull();
    },
  );

  it('preserves explicit key-only adapters without accepting paths or URLs', () => {
    for (const field of ['key', 'file_key', 'upload_id']) {
      expect(tronClassMaterialUploadKey({ [field]: 'legacy-key' })).toBe('legacy-key');
    }
    for (const key of ['.', '..', 'a/b', 'https://other.test/file', 'a?query', 'a\n', 741]) {
      expect(tronClassMaterialUploadKey({ key })).toBeNull();
    }
  });
});

describe('ordinary TronClass material file permission', () => {
  it('accepts explicitly allowed ordinary attachments without manufacturing permission from an ID', () => {
    expect(isTronClassMaterialDownloadAllowed({ id: 741 })).toBe(false);
    expect(isTronClassMaterialDownloadAllowed({ id: 741, allow_download: true })).toBe(true);
    expect(isTronClassMaterialDownloadAllowed({ id: 741, allow_download: true, reference_id: 0,
      source: '', audit_status: 'agree', deleted: false, is_deleted: 0, status: 'uploaded' })).toBe(true);
  });

  it.each([
    { allow_download: false }, { allow_download: 1 }, { reference_id: 4 }, { reference_id: '0' },
    { source: 'LARK' }, { source: 'WEDRIVE' }, { source: 'auto-generated-pdf' },
    { audit_status: 'pending' }, { audit_status: 'disagree' },
    { deleted: true }, { is_deleted: 1 }, { from_project: true }, { isFromKnowledgeGraph: true },
    { type: 'link' }, { type: ['pdf'] }, { is_hidden: 1 }, { published: false },
    { status: 'cliping' }, { status: 'clip_failed' }, { status: 'uploading' }, { status: 'failed' },
    { status: ['uploaded'] },
  ])('keeps unsupported or withdrawn resources off the ordinary download route: %j', (flags) => {
    expect(isTronClassMaterialDownloadAllowed({ id: 741, allow_download: true, ...flags })).toBe(false);
  });
});
