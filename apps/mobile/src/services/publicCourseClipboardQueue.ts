/** Serialize native clipboard writes across course cards so an older OS request
 * cannot finish after a newer successful copy and replace its contents. */
export type PublicCourseClipboardResult = 'copied' | 'manual' | 'superseded';

let latestRequest = 0;
let tail: Promise<void> = Promise.resolve();

export function queuePublicCourseClipboardCopy(
  write: () => Promise<boolean>,
  active: () => boolean = () => true,
): Promise<PublicCourseClipboardResult> {
  const request = ++latestRequest;
  const task = tail.then(async (): Promise<PublicCourseClipboardResult> => {
    if (request !== latestRequest || !active()) return 'superseded';
    try {
      const success = await write();
      if (request !== latestRequest || !active()) return 'superseded';
      return success ? 'copied' : 'manual';
    } catch {
      return request === latestRequest && active() ? 'manual' : 'superseded';
    }
  });
  // A rejected native promise must not prevent later users from copying.
  tail = task.then(() => undefined, () => undefined);
  return task;
}
