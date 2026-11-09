// @vitest-environment node
import { expect, it } from 'vitest';
import {
  parsePrivateFilePath,
  parsePrivateGroupFilePath,
  privateAssignmentPath,
  privateGroupCoverPath,
  privateGroupPostPath,
  privateStoryPath,
} from '@campus/shared/src/privateFileAccess';

const COVER = 'groups/course/cover.jpg';
const POST = 'groups/course/posts/one/notes.pdf';
const ANSWER = 'assignments/work/submissions/alice/answer.pdf';
const STORY = 'schools/pu/stories/story-1/image';

it.each([
  ['', null],
  [COVER, 'group-cover'],
  [POST, 'group-post'],
  [ANSWER, 'assignment'],
  [STORY, 'story'],
  ['groups/course', null],
  ['groups/course/posts/one/nested/file.pdf', null],
  ['groups/course/posts/one/../file.pdf', null],
  ['groups/course/cover.jpg/', null],
  ['assignments/work/submissions/alice', null],
  ['avatars/alice.jpg', null],
] as const)('parses %s as %s', (path, kind) => {
  expect(parsePrivateFilePath(path)?.kind || null).toBe(kind);
});

it('keeps the Functions privateGroupFile parser off story paths', () => {
  expect(parsePrivateGroupFilePath(STORY)).toBeNull();
  expect(parsePrivateGroupFilePath(POST)?.kind).toBe('group-post');
});

it('builds canonical object paths', () => {
  expect(privateGroupCoverPath('course', 'jpg')).toBe(COVER);
  expect(privateGroupPostPath('course', 'one', 'notes.pdf')).toBe(POST);
  expect(privateAssignmentPath('work', 'alice', 'answer.pdf')).toBe(ANSWER);
  expect(privateStoryPath('pu', 'story-1', 'image')).toBe(STORY);
  expect(privateGroupCoverPath('course', '../x')).toBeNull();
});
