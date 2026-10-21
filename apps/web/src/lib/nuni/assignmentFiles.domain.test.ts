import { describe, expect, it } from 'vitest';
import {
  MAX_ASSIGNMENT_IMAGES,
  assertAssignmentFileBudget,
  assertAssignmentFileCounts,
  assertAssignmentFileMagic,
  assertAssignmentFileSize,
  assignmentFileSubmitEnabled,
  assignmentLateOpenLabel,
  assignmentReceiptStatusLabel,
  assignmentSubmissionLate,
  classifyAssignmentFile,
} from '@campus/shared/src/assignmentFiles';
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
    expect(assignmentReceiptStatusLabel(false)).toBe('已繳');
  });

  it('shows a late-but-open banner only while the teacher still accepts work', () => {
    const now = Date.parse('2026-10-21T13:00:00.000Z');
    expect(
      assignmentLateOpenLabel('2026-10-21T12:00:00.000Z', 'open', 'active', now),
    ).toBe('遲交、仍可繳');
    expect(assignmentLateOpenLabel('2026-10-21T12:00:00.000Z', 'closed', 'active', now)).toBeNull();
    expect(assignmentLateOpenLabel('2026-10-21T14:00:00.000Z', 'open', 'active', now)).toBeNull();
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
});
