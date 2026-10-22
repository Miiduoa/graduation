import {
  assignmentFileDownloadUrl,
  requireAssignmentPayload,
  usesAssignmentFileBff,
} from '../screens/nuni/assignmentFileSubmit';
import { NuniError } from '@campus/shared/src/nuni';

const workspace = 'cw_11111111-1111-4111-8111-111111111111';
const assignment = 'cwa_22222222-2222-4222-8222-222222222222';

test('keeps text submit on the platform API and sends file traffic to the BFF', () => {
  expect(
    usesAssignmentFileBff(`class-workspaces/${workspace}/assignments/${assignment}/submit`, {
      body: '文字',
    }),
  ).toBe(false);
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

test('builds a signed short-lived download URL on nuni.tw', () => {
  expect(
    assignmentFileDownloadUrl({
      id: 'cwf_33333333-3333-4333-8333-333333333333',
      originalName: 'shot.jpg',
      contentType: 'image/jpeg',
      byteSize: 12,
      kind: 'image',
      downloadPath: `class-workspaces/${workspace}/assignments/${assignment}/files/cwf_33333333-3333-4333-8333-333333333333/content`,
      downloadExp: '1',
      downloadSig: 'sig',
    }),
  ).toBe(
    `https://nuni.tw/api/nuni/class-workspaces/${workspace}/assignments/${assignment}/files/cwf_33333333-3333-4333-8333-333333333333/content?exp=1&sig=sig`,
  );
});
