import { useEffect, useState } from 'react';
import type { PersonalImportRow } from '@campus/shared';
import { PersonalImportCenter } from '../../../apps/web/src/components/imports/PersonalImportCenter';
import {
  changePersonalImport,
  personalImportsStorageKey,
  readPersonalImports,
  savePersonalImportBatch,
} from '../../../apps/web/src/lib/personalImports';
import { setRecordFixtureIdentityLoading } from './boundaries';

const scope = { owner: 'guest', schoolId: 'pu' };
const key = personalImportsStorageKey(scope);
const records: PersonalImportRow[] = Array.from({ length: 40 }, (_, index) => ({
  id: `record-fixture-${index}`,
  kind: 'grades',
  schoolId: 'pu',
  title: index === 0
    ? '資料結構與演算法'
    : index === 39
      ? '跨校資料治理與智慧校園代理人的設計實務：從課程規劃、使用者研究、資訊安全到專題整合驗證的完整應用'
      : `合成課程 ${index + 1}`,
  courseCode: `QA-${String(index + 1).padStart(3, '0')}`,
  academicYear: '115',
  semester: '1',
  credits: 3,
  grade: '85',
  source: { type: 'paste', line: index + 1, rawText: '明示的合成資料，不連接學校系統。' },
}));

/** Real product UI, hooks, Web Locks and storage; only test-owned data and faults. */
export function RecordEditing() {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let active = true;
    let storageFailure = false;
    let attempts = 0;
    let writes = 0;
    let releaseLock: (() => void) | null = null;
    let held: Promise<unknown> | null = null;
    const originalSet = Storage.prototype.setItem;
    function checkedSet(this: Storage, name: string, value: string) {
      if (this === localStorage && name === key) {
        attempts += 1;
        if (storageFailure) throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
        originalSet.call(this, name, value);
        writes += 1;
        return;
      }
      originalSet.call(this, name, value);
    }
    async function release() {
      const completion = held;
      releaseLock?.();
      releaseLock = null;
      held = null;
      await completion;
    }
    async function prepare() {
      // This fixture runs only on an isolated localhost origin. Seed through
      // the real validation and persistence path before mounting the editor.
      localStorage.removeItem(key);
      await savePersonalImportBatch(scope, records);
      if (!active) return;
      Storage.prototype.setItem = checkedSet;
      Object.assign(window, {
        __recordEditingQA: {
          snapshot: () => ({ attempts, writes, records: readPersonalImports(scope), held: held !== null }),
          failStorage: (value: boolean) => { storageFailure = value; },
          pauseIdentity: setRecordFixtureIdentityLoading,
          holdWrites: async () => {
            if (held) throw new Error('A fixture write lock is already held');
            let acquired!: () => void;
            const ready = new Promise<void>((resolve) => { acquired = resolve; });
            held = navigator.locks.request(key, async () => {
              const pending = new Promise<void>((resolve) => { releaseLock = resolve; });
              acquired();
              await pending;
            });
            await ready;
          },
          releaseWrites: release,
          replaceTitle: async (id: string, title: string) => {
            const original = readPersonalImports(scope).find((row) => row.id === id);
            if (!original) throw new Error('Missing synthetic record');
            await changePersonalImport(scope, original, { ...original, title });
          },
        },
      });
      setReady(true);
    }
    void prepare().catch((error: unknown) => {
      if (active) setFailure(error instanceof Error ? error.message : String(error));
    });
    return () => {
      active = false;
      void release();
      if (Storage.prototype.setItem === checkedSet) Storage.prototype.setItem = originalSet;
      Reflect.deleteProperty(window, '__recordEditingQA');
    };
  }, []);

  return (
    <section aria-label="個人紀錄編輯驗收">
      <h1>個人紀錄編輯驗收</h1>
      <p className="fixture-copy">40 筆合成資料，使用實際編輯視窗與瀏覽器儲存；不進行正式 API 寫入。</p>
      {failure ? <p role="alert">{failure}</p> : ready ? <PersonalImportCenter /> : <p role="status">正在準備合成紀錄…</p>}
    </section>
  );
}
