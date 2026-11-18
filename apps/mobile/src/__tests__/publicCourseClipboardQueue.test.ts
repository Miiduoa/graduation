import { queuePublicCourseClipboardCopy } from '../services/publicCourseClipboardQueue';

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test('late native success cannot overwrite another course copied later', async () => {
  let finishFirst!: () => void;
  let actualClipboard = '';
  let secondCalls = 0;
  const first = queuePublicCourseClipboardCopy(() => new Promise<boolean>((resolve) => {
    finishFirst = () => { actualClipboard = 'first course'; resolve(true); };
  }));
  await tick();
  const second = queuePublicCourseClipboardCopy(async () => {
    secondCalls += 1;
    actualClipboard = 'second course';
    return true;
  });
  expect(secondCalls).toBe(0);
  finishFirst();
  expect(await first).toBe('superseded');
  expect(await second).toBe('copied');
  expect(actualClipboard).toBe('second course');
  expect(secondCalls).toBe(1);
});

test('intermediate queued request is skipped in favor of the newest course', async () => {
  let finish!: () => void;
  const written: string[] = [];
  const first = queuePublicCourseClipboardCopy(() => new Promise<boolean>((resolve) => {
    finish = () => { written.push('first'); resolve(true); };
  }));
  await tick();
  const second = queuePublicCourseClipboardCopy(async () => {
    written.push('second');
    return true;
  });
  const third = queuePublicCourseClipboardCopy(async () => {
    written.push('third');
    return true;
  });
  finish();
  expect(await Promise.all([first, second, third])).toEqual(['superseded', 'superseded', 'copied']);
  expect(written).toEqual(['first', 'third']);
});

test('native error exposes manual copy and does not poison later writes', async () => {
  expect(await queuePublicCourseClipboardCopy(async () => { throw new Error('clipboard unavailable'); })).toBe('manual');
  expect(await queuePublicCourseClipboardCopy(async () => true)).toBe('copied');
});

test('unmounted or replaced card cannot claim success after a native response', async () => {
  let active = true;
  let finish!: () => void;
  const first = queuePublicCourseClipboardCopy(() => new Promise<boolean>((resolve) => {
    finish = () => resolve(true);
  }), () => active);
  await tick();
  active = false;
  finish();
  expect(await first).toBe('superseded');
});
