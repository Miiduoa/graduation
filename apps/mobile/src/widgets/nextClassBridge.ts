import { requireOptionalNativeModule } from 'expo';
import type { NextClassSnapshot } from './nextClassSnapshot';
import { liveClassContent, type LiveClassContent } from './nextClassLiveActivity';

type Bridge = {
  setSnapshot(value: string | null): Promise<void>;
  setLiveActivity?(value: LiveClassContent | null): Promise<void>;
};
const native = requireOptionalNativeModule<Bridge>('CampusNextClass');
/** Serialize writes and clears so a slow earlier write cannot survive logout. */
export function createSnapshotWriter(bridge: Bridge | null) {
  let revision = 0;
  let saved: NextClassSnapshot | null = null;
  let queue = Promise.resolve();
  const enqueue = (value: string | null, expected: number) => {
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        if (value === null || expected === revision) {
          if (value === null) {
            saved = null;
            try {
              await bridge?.setSnapshot(null);
            } finally {
              await bridge?.setLiveActivity?.(null);
            }
          } else {
            await bridge?.setSnapshot(value);
            saved = JSON.parse(value);
            await bridge?.setLiveActivity?.(liveClassContent(saved, Date.now()));
          }
        }
      });
    return queue;
  };
  return {
    refreshActivity() {
      queue = queue
        .catch(() => undefined)
        .then(async () => {
          await bridge?.setLiveActivity?.(liveClassContent(saved, Date.now()));
        });
      return queue;
    },
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
