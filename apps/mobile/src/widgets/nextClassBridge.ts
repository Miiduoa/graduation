import { requireOptionalNativeModule } from 'expo';
import type { NextClassSnapshot } from './nextClassSnapshot';

type Bridge = { setSnapshot(value: string | null): Promise<void> };
const native = requireOptionalNativeModule<Bridge>('CampusNextClass');
/** Serialize writes and clears so a slow earlier write cannot survive logout. */
export function createSnapshotWriter(bridge: Bridge | null) {
  let revision = 0;
  let queue = Promise.resolve();
  const enqueue = (value: string | null, expected: number) => {
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        if (value === null || expected === revision) await bridge?.setSnapshot(value);
      });
    return queue;
  };
  return {
    clear() {
      revision++;
      return enqueue(null, revision);
    },
    begin() {
      return ++revision;
    },
    write(snapshot: NextClassSnapshot, expected: number) {
      return enqueue(JSON.stringify(snapshot), expected);
    },
  };
}
export const nextClassWriter = createSnapshotWriter(native);
