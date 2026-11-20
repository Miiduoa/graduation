import { describe, expect, it } from 'vitest';
import {
  MAX_ASSIGNMENT_IMAGES,
  ASSIGNMENT_FILE_INTENT_TTL_MS,
  assignmentFileContentQuery,
  assignmentFileIntentCountsTowardQuota,
  assignmentImageTargetSize,
  assertAssignmentFileBudget,
  assertAssignmentFileCounts,
  assertAssignmentFileMagic,
  assertAssignmentFileSize,
  assignmentFileSubmitEnabled,
  assignmentLateOpenLabel,
  assignmentReceiptStatusLabel,
  assignmentSubmissionLate,
  classifyAssignmentFile,
  formatAssignmentFileSize,
  moveAssignmentFile,
  sanitizeAssignmentFileName,
} from '@campus/shared/src/assignmentFiles';
import {
  formatTaipeiDateTime,
  parseTaipeiInstant,
  taipeiWallTimeToIso,
} from '@campus/shared/src/taipeiTime';
import { NuniError } from '@campus/shared/src/nuni';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe('assignment file domain', () => {
  it('keeps the file-submit flag off unless it is the literal true', () => {
    expect(assignmentFileSubmitEnabled({})).toBe(false);
    expect(assignmentFileSubmitEnabled({ ASSIGNMENT_FILE_SUBMIT_ENABLED: '1' })).toBe(false);
    expect(assignmentFileSubmitEnabled({ ASSIGNMENT_FILE_SUBMIT_ENABLED: 'true' })).toBe(true);
  });

  it('marks a submission late only after the reference due time', () => {
    expect(assignmentSubmissionLate(null, '2026-10-21T12:00:00.000Z')).toBe(false);
    expect(assignmentSubmissionLate('2026-10-21T12:00:00.000Z', '2026-10-21T11:59:00.000Z')).toBe(
      false,
    );
    expect(assignmentSubmissionLate('2026-10-21T12:00:00.000Z', '2026-10-21T12:00:01.000Z')).toBe(
      true,
    );
    expect(assignmentReceiptStatusLabel(true)).toBe('遲交');
    expect(assignmentReceiptStatusLabel(false)).toBe('準時');
  });

  it('shows a late-but-open banner only while the teacher still accepts work', () => {
    const now = Date.parse('2026-10-21T13:00:00.000Z');
    expect(
      assignmentLateOpenLabel('2026-10-21T12:00:00.000Z', 'open', 'active', now),
    ).toBe('已過截止時間，現在送出會標為遲交');
    expect(assignmentLateOpenLabel('2026-10-21T12:00:00.000Z', 'closed', 'active', now)).toBeNull();
    expect(assignmentLateOpenLabel('2026-10-21T14:00:00.000Z', 'open', 'active', now)).toBeNull();
  });

  it('formats Taipei wall time from UTC without using the host timezone', () => {
    expect(formatTaipeiDateTime('2026-10-22T03:49:43.000Z')).toBe('2026/10/22 上午11:49:43');
    expect(formatTaipeiDateTime('2026-10-21T15:49:43.000Z')).toBe('2026/10/21 下午11:49:43');
    expect(formatTaipeiDateTime('2026-10-29T15:59:00.000Z', { seconds: false })).toBe(
      '2026/10/29 下午11:59',
    );
    expect(taipeiWallTimeToIso('2026-10-29T23:59')).toBe('2026-10-29T23:59:00+08:00');
    expect(new Date(taipeiWallTimeToIso('2026-10-29T23:59')!).toISOString()).toBe(
      '2026-10-29T15:59:00.000Z',
    );
    expect(parseTaipeiInstant('2026-10-22T11:49:43')).toBe(
      Date.parse('2026-10-22T11:49:43+08:00'),
    );
    expect(parseTaipeiInstant('2026-10-22T11:49:43.000')).toBe(
      Date.parse('2026-10-22T11:49:43+08:00'),
    );
    expect(parseTaipeiInstant('2026-10-22')).toBe(Date.parse('2026-10-22T00:00:00+08:00'));
    expect(parseTaipeiInstant('2026-10-22T03:49:43.000Z')).toBe(
      Date.parse('2026-10-22T03:49:43.000Z'),
    );
    expect(formatTaipeiDateTime('2026-10-22T11:49:43')).toBe('2026/10/22 上午11:49:43');
    expect(formatTaipeiDateTime('2026-10-29T23:59:00', { seconds: false })).toBe(
      '2026/10/29 下午11:59',
    );
    expect(assignmentSubmissionLate('2026-10-21T23:59:00', '2026-10-21T15:59:00.000Z')).toBe(
      false,
    );
    expect(assignmentSubmissionLate('2026-10-21T23:59:00', '2026-10-21T16:00:00.000Z')).toBe(true);
    expect(
      assignmentLateOpenLabel(
        '2026-10-21T23:59:00',
        'open',
        'active',
        Date.parse('2026-10-21T16:00:00.000Z'),
      ),
    ).toBe('已過截止時間，現在送出會標為遲交');
    const pending = { uploadedAt: null, createdAt: '2026-10-21T13:00:00.000Z' };
    const now = Date.parse('2026-10-21T13:10:00.000Z');
    expect(assignmentFileIntentCountsTowardQuota(pending, now)).toBe(true);
    expect(
      assignmentFileIntentCountsTowardQuota(
        pending,
        now + ASSIGNMENT_FILE_INTENT_TTL_MS,
      ),
    ).toBe(false);
    expect(
      assignmentFileIntentCountsTowardQuota(
        { uploadedAt: '2026-10-21T13:00:00.000Z', createdAt: pending.createdAt },
        now + ASSIGNMENT_FILE_INTENT_TTL_MS,
      ),
    ).toBe(true);
  });

  it('scales photos to a 2000px edge, labels sizes, and reorders files', () => {
    expect(assignmentImageTargetSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(assignmentImageTargetSize(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(formatAssignmentFileSize(512)).toBe('512 B');
    expect(formatAssignmentFileSize(2048)).toBe('2.0 KB');
    expect(assignmentFileContentQuery('1', 'sig')).toBe('exp=1&sig=sig');
    expect(assignmentFileContentQuery('1', 'sig', true)).toBe('exp=1&sig=sig&download=1');
    expect(moveAssignmentFile(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveAssignmentFile(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });

  it('rejects disallowed types and oversize payloads', () => {
    expect(classifyAssignmentFile('shot.JPG', 'image/jpeg')).toEqual({
      kind: 'image',
      contentType: 'image/jpeg',
    });
    expect(classifyAssignmentFile('notes.pdf', 'application/pdf')).toEqual({
      kind: 'file',
      contentType: 'application/pdf',
    });
    expect(() => classifyAssignmentFile('malware.exe', 'application/octet-stream')).toThrow(
      NuniError,
    );
    expect(() => assertAssignmentFileSize('image', MAX_ASSIGNMENT_IMAGES)).not.toThrow();
    expect(() => assertAssignmentFileSize('image', 10 * 1024 * 1024 + 1)).toThrowError(
      /ASSIGNMENT_FILE_TOO_LARGE/,
    );
    expect(() => assertAssignmentFileCounts(9, 0)).toThrowError(/ASSIGNMENT_FILE_LIMIT/);
    expect(() => assertAssignmentFileCounts(0, 3)).toThrowError(/ASSIGNMENT_FILE_LIMIT/);
    expect(() => assertAssignmentFileBudget(8, 2)).not.toThrow();
    expect(() => assertAssignmentFileMagic('image', 'image/jpeg', jpeg)).not.toThrow();
    expect(() =>
      assertAssignmentFileMagic('image', 'image/jpeg', Uint8Array.from([0x00, 0x01])),
    ).toThrowError(/ASSIGNMENT_FILE_TYPE_REJECTED/);
  });

  it('rejects a .jpg that is actually PNG, a renamed MP4 pretending to be HEIC, and path traversal', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => assertAssignmentFileMagic('image', 'image/jpeg', png)).toThrowError(
      /ASSIGNMENT_FILE_TYPE_REJECTED/,
    );
    const mp4 = new Uint8Array(32);
    mp4.set([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
    expect(classifyAssignmentFile('clip.heic', 'image/heic')).toEqual({
      kind: 'image',
      contentType: 'image/heic',
    });
    expect(() => assertAssignmentFileMagic('image', 'image/heic', mp4)).toThrowError(
      /ASSIGNMENT_FILE_TYPE_REJECTED/,
    );
    const heic = new Uint8Array(32);
    heic.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);
    expect(() => assertAssignmentFileMagic('image', 'image/heic', heic)).not.toThrow();
    expect(() => sanitizeAssignmentFileName('../secret.jpg')).toThrow(NuniError);
    expect(() => sanitizeAssignmentFileName('..\\secret.jpg')).toThrow(NuniError);
    expect(() => sanitizeAssignmentFileName('foo/../../etc/passwd.jpg')).toThrow(NuniError);
  });
});

it('allows revisions through the Taipei deadline, with no deadline remaining open', async () => {
  const { assignmentCanRevise } = await import('@campus/shared/src/assignmentFiles');
  expect(assignmentCanRevise('2026-10-31T20:00:00', Date.parse('2026-10-31T12:00:00Z'))).toBe(true);
  expect(assignmentCanRevise('2026-10-31T20:00:00', Date.parse('2026-10-31T12:00:00.001Z'))).toBe(
    false,
  );
  expect(assignmentCanRevise(null)).toBe(true);
});
