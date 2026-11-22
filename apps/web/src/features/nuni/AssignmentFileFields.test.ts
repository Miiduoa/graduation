import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assignmentFileHref,
  collectLocalFileSelection,
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
    const docs = [
      file('a.pdf', 'application/pdf'),
      file('b.pdf', 'application/pdf'),
      file('c.pdf', 'application/pdf'),
    ];
    const next = collectLocalFiles(
      [],
      [...images, ...docs, file('bad.exe', 'application/octet-stream')],
    );
    expect(next.filter((item) => item.kind === 'image')).toHaveLength(8);
    expect(next.filter((item) => item.kind === 'file')).toHaveLength(2);
    expect(next.some((item) => item.file.name.endsWith('.exe'))).toBe(false);
  });

  it.each(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'JPG', 'pdf', 'doc', 'docx', 'txt', 'zip', 'exe'])(
    'rejects a MIME-less .%s before it reserves quota',
    (extension) => {
      const name = `attachment.${extension}`;
      const selection = collectLocalFileSelection([], [file(name, '')]);
      expect(selection.files).toEqual([]);
      expect(selection.rejected).toEqual([
        { name, reason: '瀏覽器未提供檔案類型，請另存後重新選取。' },
      ]);
    },
  );

  it.each([[0, 0], [8, 0], [0, 2], [8, 2]])(
    'uses independent quotas with %i photos and %i documents already selected',
    (images, docs) => {
      const existing = collectLocalFiles([], [
        ...Array.from({ length: images }, (_, index) => file(`existing-${index}.jpg`, 'image/jpeg')),
        ...Array.from({ length: docs }, (_, index) => file(`existing-${index}.pdf`, 'application/pdf')),
      ]);
      const selection = collectLocalFileSelection(existing, [
        file('unknown.jpg', ''),
        file('unknown.docx', ''),
        file('declared.pdf', 'application/pdf'),
        file('declared.png', 'image/png'),
      ]);
      expect(selection.files.slice(0, existing.length)).toEqual(existing);
      expect(selection.files.slice(existing.length).map(({ file }) => file.name)).toEqual([
        ...(docs === 0 ? ['declared.pdf'] : []),
        ...(images === 0 ? ['declared.png'] : []),
      ]);
      expect(selection.rejected.map(({ name }) => name)).toEqual([
        'unknown.jpg', 'unknown.docx', ...(docs ? ['declared.pdf'] : []), ...(images ? ['declared.png'] : []),
      ]);
    },
  );

  it('leaves the quota available when empty or oversized files are rejected', () => {
    const oversized = file('large.pdf', 'application/pdf');
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    const selection = collectLocalFileSelection([], [
      file('empty.jpg', 'image/jpeg', 0),
      file('blank.pdf', '   '),
      oversized,
      file('valid.pdf', 'application/pdf'),
    ]);
    expect(selection.files.map(({ file }) => file.name)).toEqual(['valid.pdf']);
    expect(selection.rejected.map(({ name }) => name)).toEqual(['empty.jpg', 'blank.pdf', 'large.pdf']);
  });

  it('does not override an explicitly mismatched MIME to accept a file', () => {
    const selection = collectLocalFileSelection([], [file('wrong.png', 'application/pdf')]);
    expect(selection.files).toEqual([]);
    expect(selection.added).toBe(0);
    expect(selection.rejected).toEqual([
      { name: 'wrong.png', reason: '格式不支援，或副檔名與檔案格式不一致。' },
    ]);
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
  it('uploads the accepted batch with the original MIME declarations', async () => {
    const files = collectLocalFiles([], [
      ...Array.from({ length: 8 }, (_, index) => file(`shot-${index}.jpg`, index === 0 ? 'image/jpg' : 'image/jpeg')),
      file('missing.webp', ''),
      file('missing.pdf', ''),
      file('notes.pdf', 'application/pdf'),
      file('extra.txt', 'text/plain'),
    ]);
    const createAssignmentFileIntents = vi.fn(async (_workspace: string, _assignment: string, input: {
      files: { originalName: string; contentType: string }[];
    }) => input.files.map(({ originalName, contentType }) => ({
      id: originalName, uploadPath: originalName, contentType,
    })));
    const uploadAssignmentFile = vi.fn(async () => {});
    const submitFiles = vi.fn(async () => ({}));
    await uploadAndSubmitFiles(
      { createAssignmentFileIntents, uploadAssignmentFile, submitFiles } as never,
      'workspace', 'assignment', '', files, 'key',
    );
    expect(createAssignmentFileIntents.mock.calls[0]?.[2].files.map(({ contentType }) => contentType))
      .toEqual(['image/jpg', ...Array(7).fill('image/jpeg'), 'application/pdf', 'text/plain']);
    expect(uploadAssignmentFile).toHaveBeenCalledTimes(10);
    expect(submitFiles).toHaveBeenCalledOnce();
  });

  it.each([
    {
      files: Array.from({ length: 9 }, (_, index) => file(`shot-${index}.jpg`, 'image/jpeg')),
      kind: 'image' as const,
      code: 'ASSIGNMENT_FILE_LIMIT',
    },
    {
      files: Array.from({ length: 3 }, (_, index) => file(`notes-${index}.pdf`, 'application/pdf')),
      kind: 'file' as const,
      code: 'ASSIGNMENT_FILE_LIMIT',
    },
    {
      files: [file('valid.pdf', 'application/pdf'), file('empty.pdf', 'application/pdf', 0)],
      kind: 'file' as const,
      code: 'ASSIGNMENT_FILE_SIZE_REJECTED',
    },
    ...[
      file('report.pdf', ''),
      file('blank.pdf', '   '),
      file('missing.jpg', ''),
      file('binary.pdf', 'application/octet-stream'),
      file('mismatch.png', 'application/pdf'),
      file('unsupported.exe', 'application/pdf'),
    ].map((invalid) => ({
      files: [file('valid.pdf', 'application/pdf'), invalid],
      kind: 'file' as const,
      code: 'ASSIGNMENT_FILE_TYPE_REJECTED',
    })),
  ])('creates no intents for a batch rejected with $code', async ({ files, kind, code }) => {
    const createAssignmentFileIntents = vi.fn();
    await expect(
      uploadAndSubmitFiles(
        { createAssignmentFileIntents } as never,
        'workspace',
        'assignment',
        '',
        files.map((file) => ({ key: file.name, kind, file })),
        'key',
      ),
    ).rejects.toMatchObject({ code });
    expect(createAssignmentFileIntents).not.toHaveBeenCalled();
  });

  it('creates intents once, uploads in parallel, then submits without a list reload', async () => {
    const createAssignmentFileIntents = vi.fn(
      async (
        _workspaceId: string,
        _assignmentId: string,
        _input: {
          files: {
            originalName: string;
            contentType: string;
            byteSize: number;
            idempotencyKey?: string;
          }[];
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
      ],
    );
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
    if (path === 'second' && !failed) {
      failed = true;
      throw new TypeError('upload interrupted');
    }
  });
  const submitFiles = vi.fn(async () => ({}));
  const classes = { createAssignmentFileIntents, uploadAssignmentFile, submitFiles } as never;
  const files = collectLocalFiles(
    [],
    [file('a.pdf', 'application/pdf'), file('b.pdf', 'application/pdf')],
  );
  await expect(
    uploadAndSubmitFiles(
      classes,
      'workspace',
      'assignment',
      'original',
      files,
      'key',
      undefined,
      operation,
    ),
  ).rejects.toThrow('upload interrupted');
  expect(submitFiles).not.toHaveBeenCalled();
  await uploadAndSubmitFiles(
    classes,
    'workspace',
    'assignment',
    'changed',
    [],
    'key',
    undefined,
    operation,
  );
  expect(createAssignmentFileIntents).toHaveBeenCalledTimes(1);
  expect(uploadAssignmentFile.mock.calls.map(([path]) => path)).toEqual([
    'first',
    'second',
    'second',
  ]);
  expect(submitFiles).toHaveBeenCalledWith('workspace', 'assignment', {
    body: 'original',
    fileIds: ['first', 'second'],
    idempotencyKey: 'key',
  });
});
