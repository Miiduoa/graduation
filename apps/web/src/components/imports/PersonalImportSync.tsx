'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PersonalImportRecord } from '@campus/shared';
import type {
  PersonalImportSyncChoices,
  PersonalImportSyncConflict,
} from '@campus/shared/src/imports/sync';
import type { PersonalImportSyncReview } from '@campus/shared/src/imports/syncEngine';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { usePersonalImportScope } from '@/lib/usePersonalImports';
import {
  PERSONAL_IMPORT_CHANGE,
  readPersonalImportSyncState,
  type PersonalImportScope,
} from '@/lib/personalImports';
import {
  cancelPersonalImportSync,
  getPersonalImportSyncStatus,
  setPersonalImportSyncEnabled,
  subscribePersonalImportSync,
  syncPersonalImports,
} from '@/lib/personalImportSync';

export function PersonalImportSyncBridge() {
  const { scope, loading } = usePersonalImportScope();
  const { owner, schoolId } = scope;
  const nuni = useOptionalNuniSession();
  const identity = nuni?.session;
  useEffect(() => {
    const scope = { owner, schoolId };
    if (
      loading ||
      nuni?.loading ||
      !identity ||
      nuni?.error ||
      nuni?.pendingLogout ||
      scope.owner !== `platform:${identity.platformAccountId}` ||
      scope.schoolId === 'personal'
    )
      return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (!alive || document.visibilityState === 'hidden') return;
      try {
        if (
          readPersonalImportSyncState(scope).enabled &&
          getPersonalImportSyncStatus(scope)?.phase !== 'conflict'
        )
          void syncPersonalImports(scope, identity, () => alive);
      } catch {
        /* The import screen presents storage corruption without replacing the ledger. */
      }
    };
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(run, 1000);
    };
    run();
    const interval = setInterval(run, 30_000);
    window.addEventListener('online', run);
    window.addEventListener('focus', run);
    window.addEventListener('storage', changed);
    window.addEventListener(PERSONAL_IMPORT_CHANGE, changed);
    document.addEventListener('visibilitychange', run);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(interval);
      cancelPersonalImportSync(scope);
      window.removeEventListener('online', run);
      window.removeEventListener('focus', run);
      window.removeEventListener('storage', changed);
      window.removeEventListener(PERSONAL_IMPORT_CHANGE, changed);
      document.removeEventListener('visibilitychange', run);
    };
  }, [loading, identity, nuni?.loading, nuni?.error, nuni?.pendingLogout, owner, schoolId]);
  return null;
}

type ConflictField = { label: string; value: (row: PersonalImportRecord) => string };
const value = (input: unknown) =>
  input === undefined || input === null || input === '' ? '未填' : String(input);
const conflictFields: ConflictField[] = [
  { label: '名稱', value: (row) => row.title },
  {
    label: '資料類型',
    value: (row) => ({ timetable: '課表', grades: '成績', events: '活動' })[row.kind],
  },
  { label: '學年度', value: (row) => value(row.academicYear) },
  { label: '學期', value: (row) => value(row.semester) },
  { label: '課程代碼', value: (row) => value(row.courseCode) },
  { label: '教師', value: (row) => value(row.teacher) },
  { label: '班別', value: (row) => value(row.className) },
  { label: '地點', value: (row) => value(row.location) },
  {
    label: '星期',
    value: (row) =>
      row.dayOfWeek === undefined
        ? '未填'
        : `星期${['日', '一', '二', '三', '四', '五', '六', '日'][row.dayOfWeek]}`,
  },
  { label: '開始節次', value: (row) => value(row.startPeriod) },
  { label: '結束節次', value: (row) => value(row.endPeriod) },
  { label: '原始節次', value: (row) => value(row.periodLabel) },
  { label: '開始時間', value: (row) => value(row.startTime) },
  { label: '結束時間', value: (row) => value(row.endTime) },
  { label: '學分', value: (row) => value(row.credits) },
  { label: '成績', value: (row) => value(row.grade) },
  { label: '日期', value: (row) => value(row.date) },
  { label: '結束日期', value: (row) => value(row.endDate) },
  { label: '全天', value: (row) => (row.allDay === undefined ? '未填' : row.allDay ? '是' : '否') },
  { label: '課班連結', value: (row) => value(row.linkedCourseId) },
  {
    label: '來源類型',
    value: (row) => ({ paste: '貼上文字', file: '檔案', screenshot: '截圖' })[row.source.type],
  },
  { label: '來源檔名', value: (row) => value(row.source.name) },
  { label: '來源列', value: (row) => value(row.source.line) },
  { label: '來源文字', value: (row) => value(row.source.rawText) },
  { label: '匯入時間', value: (row) => row.importedAt },
];
function ConflictComparison({ conflict }: { conflict: PersonalImportSyncConflict }) {
  const contents = (rows: PersonalImportRecord[], field: ConflictField) =>
    rows.length ? rows.map(field.value).join('\n') : '已刪除';
  const differences = conflictFields
    .map((field) => ({
      label: field.label,
      local: contents(conflict.local, field),
      remote: contents(conflict.remote, field),
    }))
    .filter((field) => field.local !== field.remote);
  return differences.length ? (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <caption>{conflict.title}的差異</caption>
        <thead>
          <tr>
            <th scope="col">欄位</th>
            <th scope="col">這台裝置</th>
            <th scope="col">帳號上的版本</th>
          </tr>
        </thead>
        <tbody>
          {differences.map((field) => (
            <tr key={field.label}>
              <th scope="row">{field.label}</th>
              <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{field.local}</td>
              <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{field.remote}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p>內容相同，但匯入來源的紀錄不同。請選擇要保留的版本。</p>
  );
}

export function PersonalImportSyncPanel(props: {
  scope: PersonalImportScope;
  available?: boolean;
}) {
  const nuni = useOptionalNuniSession();
  // Consent and conflict choices belong to one account, school, and sign-in session.
  const ready = props.available !== false && !nuni?.loading && !nuni?.error && !nuni?.pendingLogout;
  return (
    <ScopeSyncPanel
      key={`${props.scope.owner}:${props.scope.schoolId}:${nuni?.session?.context || ''}:${ready}`}
      {...props}
    />
  );
}
function ScopeSyncPanel({
  scope,
  available = true,
}: {
  scope: PersonalImportScope;
  available?: boolean;
}) {
  const nuni = useOptionalNuniSession();
  const identity = nuni?.session;
  const activeRef = useRef(false);
  const permitted =
    available &&
    !nuni?.loading &&
    !nuni?.error &&
    !nuni?.pendingLogout &&
    !!identity &&
    scope.owner === `platform:${identity.platformAccountId}` &&
    scope.schoolId !== 'personal';
  const generation = useRef(0);
  useLayoutEffect(() => {
    activeRef.current = permitted;
    const next = generation.current + 1;
    generation.current = next;
    return () => {
      generation.current = next + 1;
      activeRef.current = false;
    };
  }, [permitted, scope.owner, scope.schoolId, identity?.context]);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [changing, setChanging] = useState(false);
  const [choiceState, setChoices] = useState<{
    review?: PersonalImportSyncReview;
    values: PersonalImportSyncChoices;
  }>({ values: {} });
  const { owner, schoolId } = scope;
  const status = useSyncExternalStore(
    subscribePersonalImportSync,
    () => getPersonalImportSyncStatus(scope),
    () => null,
  );
  const choices = choiceState.review === status?.result?.review ? choiceState.values : {};
  useEffect(() => {
    const scope = { owner, schoolId };
    const refresh = () => {
      try {
        setEnabled(readPersonalImportSyncState(scope).enabled);
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : '無法讀取同步設定。');
      }
    };
    refresh();
    window.addEventListener(PERSONAL_IMPORT_CHANGE, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PERSONAL_IMPORT_CHANGE, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [owner, schoolId]);
  if (
    !identity ||
    scope.owner !== `platform:${identity.platformAccountId}` ||
    scope.schoolId === 'personal'
  )
    return (
      <section className="card" aria-label="跨裝置同步">
        <h2>跨裝置同步</h2>
        <p>
          登入平台帳號並選擇校園後，可把個人紀錄同步到其他裝置。訪客資料不會自動搬到帳號，可先下載完整備份再登入還原。
        </p>
      </section>
    );
  const active = () => {
    const run = generation.current;
    return () => activeRef.current && run === generation.current;
  };
  const busy = status?.phase === 'syncing';
  const conflicts = enabled ? status?.result?.conflicts || [] : [];
  return (
    <section className="card" aria-label="跨裝置同步">
      <h2>跨裝置同步</h2>
      <p>
        {enabled
          ? '已開啟這個帳號與校園的同步。離線時先存到裝置，重新連線後再同步；兩邊同時改同一筆時會請你核對。'
          : '開啟後，此校園的課表、成績、活動、教師／課班欄位與來源文字會存到你的帳號。原始圖片不會上傳。其他裝置需登入同一帳號並開啟同步。'}
      </p>
      {!enabled && (
        <label>
          <input
            type="checkbox"
            disabled={!permitted || changing}
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          我已確認，要將這個校園的個人紀錄同步到帳號
        </label>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBlock: 12 }}>
        <button
          type="button"
          disabled={!permitted || changing || (!enabled && (busy || !consent))}
          onClick={async () => {
            const check = active();
            setError('');
            setChanging(true);
            try {
              await setPersonalImportSyncEnabled(scope, !enabled, check);
              if (check()) {
                setConsent(false);
                setChanging(false);
              }
              if (!enabled && check()) await syncPersonalImports(scope, identity, check);
            } catch (e) {
              if (check()) setError(e instanceof Error ? e.message : '同步設定未完成。');
            } finally {
              if (check()) setChanging(false);
            }
          }}
        >
          {changing
            ? enabled
              ? '正在暫停…'
              : '正在開啟…'
            : enabled
              ? '暫停這台裝置同步'
              : '開啟帳號同步'}
        </button>
        {enabled && (
          <button
            type="button"
            disabled={!permitted || busy || changing}
            onClick={() => void syncPersonalImports(scope, identity, active())}
          >
            {busy ? '正在同步…' : '立即同步'}
          </button>
        )}
      </div>
      {enabled && (
        <p>
          <small>
            暫停不會刪除帳號資料。已送出的同步可能會完成；之後的修改會留在這台裝置。開啟同步時，刪除紀錄也會同步到其他裝置；修改前可先下載完整備份。
          </small>
        </p>
      )}
      {status && enabled && (
        <p role={status.phase === 'error' ? 'alert' : 'status'}>{status.message}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {conflicts.map((conflict) => (
        <fieldset key={conflict.key}>
          <legend>{conflict.title}</legend>
          {conflict.reason === 'unconfirmed' && (
            <p>
              無法確認上次同步是否已送達。請先下載完整備份，再核對這個校園的全部紀錄。選擇這台裝置會以本機完整內容取代帳號資料；選擇帳號版本會以帳號完整內容取代本機資料。未選擇前，兩邊的資料都會保留。
            </p>
          )}
          <ConflictComparison conflict={conflict} />
          <label>
            保留哪一份
            <select
              disabled={!permitted || busy || changing}
              value={choices[conflict.key] || ''}
              onChange={(e) =>
                setChoices({
                  review: status?.result?.review,
                  values: { ...choices, [conflict.key]: e.target.value as 'local' | 'remote' },
                })
              }
            >
              <option value="" disabled>
                請選擇
              </option>
              <option value="local">這台裝置的內容</option>
              <option value="remote">帳號上的版本</option>
            </select>
          </label>
        </fieldset>
      ))}
      {!!conflicts.length && status?.result?.review && (
        <button
          type="button"
          disabled={busy || changing || !permitted || conflicts.some((c) => !choices[c.key])}
          onClick={() => {
            void syncPersonalImports(scope, identity, active(), {
              ...status.result!.review!,
              choices,
            });
          }}
        >
          確認選擇並同步
        </button>
      )}
    </section>
  );
}
