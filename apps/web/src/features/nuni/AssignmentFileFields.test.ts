import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assignmentFileHref,
  collectLocalFiles,
  compressAssignmentImageFile,
  revokeUnusedAssignmentPreviews,
  uploadAndSubmitFiles,
} from './AssignmentFileFields';

function file(name: string, type: string, bytes = 4) {
  return new File([new Uint8Array(bytes).fill(1)], name, { type });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('collectLocalFiles', () => {
  it('keeps at most eight images and two documents, and drops disallowed types', () => {
    const images = Array.from({ length: 9 }, (_, index) => file(`shot-${index}.jpg`, 'image/jpeg'));
    const docs = [file('a.pdf', 'application/pdf'), file('b.pdf', 'application/pdf'), file('c.pdf', 'application/pdf')];
    const next = collectLocalFiles([], [...images, ...docs, file('bad.exe', 'application/octet-stream')]);
    expect(next.filter((item) => item.kind === 'image')).toHaveLength(8);
    expect(next.filter((item) => item.kind === 'file')).toHaveLength(2);
    expect(next.some((item) => item.file.name.endsWith('.exe'))).toBe(false);
  });
});

describe('assignment file preview URLs', () => {
  it('does not revoke an object URL that is still shown after another file is added', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => `blob:${(blob as File).name}`);
    const first = collectLocalFiles([], [file('keep.jpg', 'image/jpeg')]);
    const second = collectLocalFiles(first, [file('extra.jpg', 'image/jpeg')]);
    revokeUnusedAssignmentPreviews(first, second);
    expect(revoke).not.toHaveBeenCalled();
    const remaining = second.filter((item) => item.file.name !== 'keep.jpg');
    revokeUnusedAssignmentPreviews(second, remaining);
    expect(revoke).toHaveBeenCalledWith(first[0]?.previewUrl);
  });
});

describe('compressAssignmentImageFile', () => {
  it('leaves the original file when the browser cannot decode it', async () => {
    const original = file('shot.jpg', 'image/jpeg', 80);
    expect(await compressAssignmentImageFile(original)).toBe(original);
  });

  it('resizes a wide photo to a 2000px JPEG when canvas compression is available', async () => {
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob(callback: (blob: Blob | null) => void) {
        callback(new Blob([new Uint8Array(12)], { type: 'image/jpeg' }));
      },
    };
    const nativeCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: unknown) => {
      if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement;
      return nativeCreate(tag, options as never);
    });
    const original = file('wide.png', 'image/png', 2 * 1024 * 1024);
    const result = await compressAssignmentImageFile(original);
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1500);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('wide.jpg');
    expect(result).not.toBe(original);
  });
});

describe('uploadAndSubmitFiles', () => {
  it('creates intents once, uploads in parallel, then submits without a list reload', async () => {
    const createAssignmentFileIntents = vi.fn(
      async (
        _workspaceId: string,
        _assignmentId: string,
        _input: {
          files: { originalName: string; contentType: string; byteSize: number; idempotencyKey?: string }[];
          idempotencyKey: string;
        },
      ) => [
      {
        id: 'cwf_11111111-1111-4111-8111-111111111111',
        uploadPath: 'class-workspaces/cw/assignments/cwa/files/cwf_1/content',
        contentType: 'image/jpeg',
      },
      {
        id: 'cwf_22222222-2222-4222-8222-222222222222',
        uploadPath: 'class-workspaces/cw/assignments/cwa/files/cwf_2/content',
        contentType: 'image/jpeg',
      },
    ]);
    const uploadAssignmentFile = vi.fn(async () => ({}));
    const submitFiles = vi.fn(async () => ({
      id: 'cwa_11111111-1111-4111-8111-111111111111',
      mySubmission: { files: [] },
    }));
    const progress: { completed: number; total: number }[] = [];
    await uploadAndSubmitFiles(
      { createAssignmentFileIntents, uploadAssignmentFile, submitFiles } as never,
      'cw_11111111-1111-4111-8111-111111111111',
      'cwa_11111111-1111-4111-8111-111111111111',
      '',
      collectLocalFiles([], [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg')]),
      'idempotent-submit-key',
      (value) => progress.push({ ...value }),
    );
    expect(createAssignmentFileIntents).toHaveBeenCalledTimes(1);
    expect(createAssignmentFileIntents.mock.calls[0]?.[2]).toMatchObject({
      idempotencyKey: 'idempotent-submit-key:intents',
      files: [
        expect.objectContaining({ originalName: 'a.jpg' }),
        expect.objectContaining({ originalName: 'b.jpg' }),
      ],
    });
    expect(uploadAssignmentFile).toHaveBeenCalledTimes(2);
    expect(submitFiles).toHaveBeenCalledTimes(1);
    expect(progress[0]).toEqual({ completed: 0, total: 2 });
    expect(progress.at(-1)).toEqual({ completed: 2, total: 2 });
  });
});

describe('assignmentFileHref', () => {
  const fileMeta = {
    id: 'cwf_11111111-1111-4111-8111-111111111111',
    originalName: 'shot.jpg',
    contentType: 'image/jpeg',
    byteSize: 12,
    kind: 'image' as const,
    downloadPath:
      'class-workspaces/cw_11111111-1111-4111-8111-111111111111/assignments/cwa_11111111-1111-4111-8111-111111111111/files/cwf_11111111-1111-4111-8111-111111111111/content',
    downloadExp: '1',
    downloadSig: 'sig',
  };

  it('keeps inline viewing and adds download=1 only when asked', () => {
    expect(assignmentFileHref(fileMeta)).not.toContain('download=1');
    expect(assignmentFileHref(fileMeta, true)).toContain('download=1');
  });
});

it('resumes only unfinished uploads with the original intents and prepared files', async () => {
  const operation: import('./AssignmentFileFields').AssignmentFileOperation = {};
  const createAssignmentFileIntents = vi.fn(async () => [
    { id: 'first', uploadPath: 'first', contentType: 'application/pdf' },
    { id: 'second', uploadPath: 'second', contentType: 'application/pdf' },
  ]);
  let failed = false;
  const uploadAssignmentFile = vi.fn(async (path: string) => {
    if (path === 'second' && !failed) { failed = true; throw new TypeError('upload interrupted'); }
  });
  const submitFiles = vi.fn(async () => ({}));
  const classes = { createAssignmentFileIntents, uploadAssignmentFile, submitFiles } as never;
  const files = collectLocalFiles([], [file('a.pdf', 'application/pdf'), file('b.pdf', 'application/pdf')]);
  await expect(uploadAndSubmitFiles(classes, 'workspace', 'assignment', 'original', files, 'key', undefined, operation)).rejects.toThrow('upload interrupted');
  expect(submitFiles).not.toHaveBeenCalled();
  await uploadAndSubmitFiles(classes, 'workspace', 'assignment', 'changed', [], 'key', undefined, operation);
  expect(createAssignmentFileIntents).toHaveBeenCalledTimes(1);
  expect(uploadAssignmentFile.mock.calls.map(([path]) => path)).toEqual(['first', 'second', 'second']);
  expect(submitFiles).toHaveBeenCalledWith('workspace', 'assignment', { body: 'original', fileIds: ['first', 'second'], idempotencyKey: 'key' });
});
