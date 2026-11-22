import { classifyAssignmentFile } from '@campus/shared/src/assignmentFiles';
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

  it('counts each distinct file once even when all file properties match', () => {
    const options = { type: 'image/jpeg', lastModified: 123 };
    const first = new File(['first'], 'same.jpg', options);
    const second = new File(['other'], 'same.jpg', options);
    const reselected = new File(['first'], 'same.jpg', options);
    const existing = collectLocalFiles([], [
      ...Array.from({ length: 5 }, (_, index) => file(`shot-${index}.jpg`, 'image/jpeg')),
      first,
    ]);
    const selection = collectLocalFileSelection(existing, [
      first,
      second,
      second,
      reselected,
      new File(['extra'], 'same.jpg', options),
      file('report.pdf', 'application/pdf'),
    ]);

    expect(selection.added).toBe(3);
    expect(selection.files[6]?.file).toBe(second);
    expect(selection.files[7]?.file).toBe(reselected);
    expect(selection.files[8]?.file.name).toBe('report.pdf');
    expect(selection.rejected.map(({ reason }) => reason)).toEqual([
      '這個檔案已在待送出清單中。',
      '這個檔案已在待送出清單中。',
      '照片最多 8 張，請先刪除不需要的照片。',
    ]);
  });

  it.each(['jpg', 'png', 'gif', 'bmp', 'svg', 'pdf', 'doc', 'docx', 'txt', 'zip', 'exe'])(
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
        file('unknown.gif', ''),
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
        'unknown.gif', 'unknown.docx', ...(docs ? ['declared.pdf'] : []), ...(images ? ['declared.png'] : []),
      ]);
    },
  );

  it('leaves the quota available when empty or oversized files are rejected', () => {
    const oversized = file('large.pdf', 'application/pdf');
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    const selection = collectLocalFileSelection([], [
      file('empty.pdf', 'application/pdf', 0),
      file('blank.pdf', '   '),
      oversized,
      file('valid.pdf', 'application/pdf'),
    ]);
    expect(selection.files.map(({ file }) => file.name)).toEqual(['valid.pdf']);
    expect(selection.rejected.map(({ name }) => name)).toEqual(['empty.pdf', 'blank.pdf', 'large.pdf']);
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
  // 1a1f36863 sends the original MIME or application/octet-stream for a MIME-less file.
  // Its intent service calls this unchanged shared classifier.
  function mergeBaseAccepts(file: File) {
    try {
      classifyAssignmentFile(file.name, file.type || 'application/octet-stream');
      return true;
    } catch {
      return false;
    }
  }

  const baseFormats = [
    { extension: 'bmp', mime: 'image/bmp', acceptsOriginal: false, canTranscode: true },
    { extension: 'heic', mime: 'image/heic', acceptsOriginal: true, canTranscode: false },
    { extension: 'webp', mime: 'image/webp', acceptsOriginal: true, canTranscode: true },
    { extension: 'gif', mime: 'image/gif', acceptsOriginal: false, canTranscode: true },
    { extension: 'png', mime: 'image/png', acceptsOriginal: true, canTranscode: true },
    { extension: 'jpeg', mime: 'image/jpeg', acceptsOriginal: true, canTranscode: true },
    { extension: 'svg', mime: 'image/svg+xml', acceptsOriginal: false, canTranscode: true },
  ];

  const cases = baseFormats.flatMap((format) =>
    [1999, 2000, 2001].flatMap((edge) =>
      [80, 2 * 1024 * 1024, 10 * 1024 * 1024 + 1].flatMap((originalBytes) =>
        [true, false].flatMap((bitmapAvailable) =>
          [true, false].flatMap((smaller) =>
            [true, false].map((hasMime) => ({
              ...format, edge, originalBytes, bitmapAvailable, smaller, hasMime,
            })),
          ),
        ),
      ),
    ),
  );

  it.each(cases)(
    'matches merge-base selection and checks preparation for .$extension at $edge px, $originalBytes bytes, bitmap=$bitmapAvailable, smaller=$smaller, MIME=$hasMime',
    async ({
      extension, mime, acceptsOriginal, canTranscode, edge, originalBytes, bitmapAvailable, smaller, hasMime,
    }) => {
      const name = `photo.${extension}`;
      const original = file(name, hasMime ? mime : '');
      Object.defineProperty(original, 'size', { value: originalBytes });
      const bitmap = vi.fn(async () => ({ width: edge, height: edge, close: vi.fn() }));
      vi.stubGlobal('createImageBitmap', bitmapAvailable ? bitmap : undefined);
      const jpeg = new Blob([new Uint8Array(12)], { type: 'image/jpeg' });
      if (!smaller) Object.defineProperty(jpeg, 'size', { value: originalBytes + 1 });
      const canvas = {
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: (blob: Blob) => void) => callback(jpeg),
      };
      const nativeCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag, options) =>
        tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : nativeCreate(tag, options),
      );

      const { files } = collectLocalFileSelection([], [original]);
      const selected = mergeBaseAccepts(original);
      expect(files.map(({ kind }) => kind)).toEqual(selected ? ['image'] : []);
      expect(bitmap).not.toHaveBeenCalled();

      // An already queued BMP keeps its preparation path even though the base picker rejects it.
      const queuedBmp = hasMime && extension === 'bmp';
      const prepares = selected || queuedBmp;
      const decodes = prepares && hasMime && canTranscode && bitmapAvailable;
      const usesJpeg = decodes && smaller && (edge > 2000 || originalBytes > 1.5 * 1024 * 1024);
      const rejectsType = !usesJpeg && !acceptsOriginal;
      const rejectsSize = !usesJpeg && originalBytes > 10 * 1024 * 1024;
      const accepts = prepares && !rejectsType && !rejectsSize;
      const createAssignmentFileIntents = vi.fn(async () => [
        { id: 'photo', uploadPath: 'photo', contentType: usesJpeg ? 'image/jpeg' : mime },
      ]);
      const uploadAssignmentFile = vi.fn(async () => {});
      const submitFiles = vi.fn(async () => ({}));
      const classes = { createAssignmentFileIntents, uploadAssignmentFile, submitFiles } as never;
      if (prepares) {
        const queued = queuedBmp ? [{ file: original, key: name, kind: 'image' as const }] : files;
        const submission = uploadAndSubmitFiles(classes, 'workspace', 'assignment', '', queued, 'key');
        if (accepts) await submission;
        else await expect(submission).rejects.toMatchObject({
          code: rejectsType ? 'ASSIGNMENT_FILE_TYPE_REJECTED' : 'ASSIGNMENT_FILE_TOO_LARGE',
        });
      }
      expect(bitmap).toHaveBeenCalledTimes(Number(decodes));
      expect(createAssignmentFileIntents).toHaveBeenCalledTimes(Number(accepts));
      expect(uploadAssignmentFile).toHaveBeenCalledTimes(Number(accepts));
      expect(submitFiles).toHaveBeenCalledTimes(Number(accepts));
      if (accepts) {
        expect(createAssignmentFileIntents).toHaveBeenCalledWith('workspace', 'assignment', {
          idempotencyKey: 'key:intents',
          files: [{
            originalName: usesJpeg ? 'photo.jpg' : name,
            contentType: usesJpeg ? 'image/jpeg' : mime,
            byteSize: usesJpeg ? jpeg.size : originalBytes,
            idempotencyKey: 'key:file:0',
          }],
        });
      }
    },
  );

  const mimeCases = ['.jpg', '.png', '.pdf', '.docx', ''].flatMap((extension) =>
    [
      '',
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream',
    ].map((mime) => ({ extension, mime })),
  );

  function mergeBaseSelection(existing: File[], incoming: File[]) {
    // The base intent service checks declared type and applies independent 8/2 budgets.
    let photos = existing.filter(({ type }) => type.startsWith('image/')).length;
    let documents = existing.length - photos;
    return incoming.filter((candidate) => {
      if (!mergeBaseAccepts(candidate)) return false;
      if (candidate.type.startsWith('image/')) {
        if (photos === 8) return false;
        photos += 1;
      } else {
        if (documents === 2) return false;
        documents += 1;
      }
      return true;
    });
  }

  it.each(mimeCases)(
    'agrees with merge-base at every starting quota for $extension with MIME "$mime"',
    async ({ extension, mime }) => {
      vi.stubGlobal('createImageBitmap', undefined);
      const candidate = file(`candidate${extension}`, mime);
      const second = file('next.png', 'image/png');
      const createAssignmentFileIntents = vi.fn(async (_workspace: string, _assignment: string, input: {
        files: { originalName: string; contentType: string }[];
      }) => input.files.map(({ originalName, contentType }) => ({
        id: originalName, uploadPath: originalName, contentType,
      })));
      const uploadAssignmentFile = vi.fn(async () => {});
      const submitFiles = vi.fn(async () => ({}));
      const classes = { createAssignmentFileIntents, uploadAssignmentFile, submitFiles } as never;
      for (let photos = 0; photos <= 8; photos += 1) {
        for (let documents = 0; documents <= 2; documents += 1) {
          const originals = [
            ...Array.from({ length: photos }, (_, index) => file(`photo-${index}.jpg`, 'image/jpeg')),
            ...Array.from({ length: documents }, (_, index) => file(`document-${index}.pdf`, 'application/pdf')),
          ];
          const existing = collectLocalFiles([], originals);
          const incoming = [candidate, second];
          const accepted = mergeBaseSelection(originals, incoming);
          const selection = collectLocalFileSelection(existing, incoming);
          const selected = selection.files.slice(existing.length);
          expect(selected.map(({ file }) => file)).toEqual(accepted);
          expect(selected.map(({ previewUrl }) => Boolean(previewUrl))).toEqual(
            accepted.map(({ type }) => type.startsWith('image/')),
          );
          expect(selection.rejected.map(({ name }) => name)).toEqual(
            incoming.filter((item) => !accepted.includes(item)).map(({ name }) => name),
          );

          // Validate each candidate at the quota it saw in the picker, including rejected files.
          const preceding = [...existing];
          for (const item of incoming) {
            const fromPicker = selected.find(({ file }) => file === item);
            const kind = item.type.startsWith('image/') ? 'image' : 'file';
            const submission = uploadAndSubmitFiles(classes, 'workspace', 'assignment', '', [
              ...preceding, { key: item.name, file: item, kind },
            ], 'matrix');
            if (fromPicker) {
              await submission;
              expect(uploadAssignmentFile).toHaveBeenLastCalledWith(
                item.name, expect.any(Uint8Array), item.type,
              );
              preceding.push(fromPicker);
            } else {
              await expect(submission).rejects.toMatchObject({
                code: mergeBaseAccepts(item) ? 'ASSIGNMENT_FILE_LIMIT' : 'ASSIGNMENT_FILE_TYPE_REJECTED',
              });
              expect(createAssignmentFileIntents).not.toHaveBeenCalled();
            }
            createAssignmentFileIntents.mockClear();
            uploadAssignmentFile.mockClear();
          }
          revokeUnusedAssignmentPreviews(selection.files, []);
        }
      }
    },
  );

  it('leaves the eighth photo slot available for JPEG when selected with a GIF', async () => {
    const existing = collectLocalFiles([], Array.from({ length: 7 }, (_, i) => file(`photo-${i}.jpg`, 'image/jpeg')));
    const jpeg = file('valid.jpg', 'image/jpeg');
    const { files, rejected } = collectLocalFileSelection(existing, [file('invalid.gif', 'image/gif'), jpeg]);
    expect(rejected.map(({ name }) => name)).toEqual(['invalid.gif']);
    expect(files[7]?.file).toBe(jpeg);
    const createAssignmentFileIntents = vi.fn(async () => [{ id: 'valid', uploadPath: 'valid', contentType: 'image/jpeg' }]);
    const uploadAssignmentFile = vi.fn().mockResolvedValue(undefined);
    const submitFiles = vi.fn().mockResolvedValue({});
    await uploadAndSubmitFiles(
      { createAssignmentFileIntents, uploadAssignmentFile, submitFiles } as never,
      'workspace', 'assignment', '', files.slice(7), 'key',
    );
    expect(uploadAssignmentFile).toHaveBeenCalledWith('valid', expect.any(Uint8Array), 'image/jpeg');
    expect(submitFiles).toHaveBeenCalledOnce();
  });

  it('uploads the accepted batch with the original MIME declarations', async () => {
    const files = collectLocalFiles([], [
      ...Array.from({ length: 8 }, (_, index) => file(`shot-${index}.jpg`, index === 0 ? 'image/jpg' : 'image/jpeg')),
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
    {
      files: [file('empty.jpg', 'image/jpeg', 0)],
      kind: 'image' as const,
      code: 'ASSIGNMENT_FILE_SIZE_REJECTED',
    },
    ...[
      file('report.pdf', ''),
      file('blank.pdf', '   '),
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
