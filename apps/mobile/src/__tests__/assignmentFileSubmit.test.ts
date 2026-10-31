import {
  assignmentFileDownloadUrl,
  assignmentRequest,
  compressNativeAssignmentImage,
  moveNativeFile,
  removeNativeFile,
  requireAssignmentPayload,
  submitNativeAssignmentFiles,
  usesAssignmentFileBff,
  type LocalNativeFile,
} from '../screens/nuni/assignmentFileSubmit';
import { NuniError } from '@campus/shared/src/nuni';

const workspace = 'cw_11111111-1111-4111-8111-111111111111';
const assignment = 'cwa_22222222-2222-4222-8222-222222222222';

test('sends assignment submissions and file traffic to the BFF', () => {
  expect(
    usesAssignmentFileBff(`class-workspaces/${workspace}/assignments/${assignment}/submit`, {
      body: '文字',
    }),
  ).toBe(true);
  expect(
    usesAssignmentFileBff(`class-workspaces/${workspace}/assignments/${assignment}/files/intents`, {
      originalName: 'shot.jpg',
    }),
  ).toBe(true);
  expect(usesAssignmentFileBff(`class-workspaces/${workspace}/assignments`)).toBe(true);
  expect(
    usesAssignmentFileBff(`class-workspaces/${workspace}/assignments`, { title: '新作業' }),
  ).toBe(false);
});

test('requires a photo, file or text before submit', () => {
  expect(() => requireAssignmentPayload('', [])).toThrow(NuniError);
  expect(() => requireAssignmentPayload('說明', [])).not.toThrow();
});

const fileMeta = {
  id: 'cwf_33333333-3333-4333-8333-333333333333',
  originalName: 'shot.jpg',
  contentType: 'image/jpeg',
  byteSize: 12,
  kind: 'image' as const,
  downloadPath: `class-workspaces/${workspace}/assignments/${assignment}/files/cwf_33333333-3333-4333-8333-333333333333/content`,
  downloadExp: '1',
  downloadSig: 'sig',
};

test('builds a signed short-lived download URL on nuni.tw', () => {
  expect(assignmentFileDownloadUrl(fileMeta)).toBe(
    `https://nuni.tw/api/nuni/class-workspaces/${workspace}/assignments/${assignment}/files/cwf_33333333-3333-4333-8333-333333333333/content?exp=1&sig=sig`,
  );
  expect(assignmentFileDownloadUrl(fileMeta, true)).toBe(
    `https://nuni.tw/api/nuni/class-workspaces/${workspace}/assignments/${assignment}/files/cwf_33333333-3333-4333-8333-333333333333/content?exp=1&sig=sig&download=1`,
  );
});

const photo = (name: string, key = name): LocalNativeFile => ({
  key,
  name,
  contentType: 'image/jpeg',
  byteSize: 12,
  kind: 'image',
  uri: `file://${name}`,
  width: 4000,
  height: 3000,
});

test('lets a student delete or reorder selected photos before submit', () => {
  const files = [photo('first.jpg'), photo('second.jpg'), photo('third.jpg')];
  expect(moveNativeFile(files, 2, -1).map((item) => item.name)).toEqual([
    'first.jpg',
    'third.jpg',
    'second.jpg',
  ]);
  expect(removeNativeFile(files, 'second.jpg').map((item) => item.name)).toEqual([
    'first.jpg',
    'third.jpg',
  ]);
});

test('keeps the original photo if native compression is unavailable', async () => {
  const original = photo('shot.jpg');
  expect(await compressNativeAssignmentImage(original)).toEqual(original);
});

test('batches intents, uploads in parallel, and reports progress', async () => {
  const createAssignmentFileIntents = jest.fn(async () => [
    {
      id: 'cwf_11111111-1111-4111-8111-111111111111',
      uploadPath: 'path-a',
      contentType: 'image/jpeg',
    },
    {
      id: 'cwf_22222222-2222-4222-8222-222222222222',
      uploadPath: 'path-b',
      contentType: 'image/jpeg',
    },
  ]);
  const uploadAssignmentFile = jest.fn(async () => ({}));
  const submitFiles = jest.fn(async () => ({ mySubmission: {} }));
  const progress: { completed: number; total: number }[] = [];
  await submitNativeAssignmentFiles(
    { createAssignmentFileIntents, uploadAssignmentFile, submitFiles },
    workspace,
    assignment,
    '',
    [photo('a.jpg', 'a'), photo('b.jpg', 'b')],
    'native-submit-key',
    (value) => progress.push({ ...value }),
  );
  expect(createAssignmentFileIntents).toHaveBeenCalledTimes(1);
  expect(uploadAssignmentFile).toHaveBeenCalledTimes(2);
  expect(submitFiles).toHaveBeenCalledTimes(1);
  expect(progress[0]).toEqual({ completed: 0, total: 2 });
  expect(progress.at(-1)).toEqual({ completed: 2, total: 2 });
});

test.each(['', 'false', 'true'])('assignment reads require the filtered BFF with upload flag %s', flag => {
  process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED = flag;
  const direct = jest.fn();
  const bff = jest.fn();
  for (const path of [
    `class-workspaces/${workspace}/assignments`,
    `class-workspaces/${workspace}/assignments/${assignment}/submissions`,
  ]) {
    expect(assignmentRequest(path, undefined, direct, bff)).toBe(bff);
    expect(() => assignmentRequest(path, undefined, direct)).toThrow(NuniError);
  }
  expect(direct).not.toHaveBeenCalled();
  delete process.env.EXPO_PUBLIC_ASSIGNMENT_FILE_SUBMIT_ENABLED;
});
