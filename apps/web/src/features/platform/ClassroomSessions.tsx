'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { asRecords, platformFetch } from './platformFetch';
import { accountReturnHref, workspacePath } from './constants';
import styles from './Platform.module.css';

type SessionRow = {
  id: string;
  title: string;
  state: string;
  checkInCount?: number;
  unitId?: string | null;
};

type RosterPerson = {
  platformAccountId: string;
  displayName: string;
  punctuality?: string;
};

const rosterLabels: Record<string, string> = {
  present: '出席',
  absent: '缺席',
  late: '遲到',
};

function sessionRows(value: unknown): SessionRow[] {
  return asRecords(value)
    .map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      title: typeof row.title === 'string' ? row.title : '課堂',
      state: typeof row.state === 'string' ? row.state : '',
      checkInCount: typeof row.checkInCount === 'number' ? row.checkInCount : undefined,
      unitId: typeof row.unitId === 'string' ? row.unitId : null,
    }))
    .filter((row) => row.id);
}

export function ClassroomSessions({
  workspaceId,
  isTeacher,
  units,
}: {
  workspaceId: string;
  isTeacher: boolean;
  units: Array<{ id: string; title: string }>;
}) {
  const [title, setTitle] = useState('本堂課');
  const [unitId, setUnitId] = useState('');
  const [code, setCode] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [roster, setRoster] = useState<Record<string, RosterPerson[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const live = sessions.find((row) => row.state === 'open' || row.state === 'live') ?? null;

  async function reload() {
    const result = await platformFetch(
      `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/classroom-sessions`,
    );
    if (result.status === 401) {
      window.location.replace(accountReturnHref(workspacePath(workspaceId)));
      return;
    }
    if (!result.ok) throw new Error('目前讀不到課堂簽到。');
    setSessions(sessionRows(result.body.sessions));
  }

  useEffect(() => {
    let active = true;
    void reload()
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
    // workspaceId is the loaded course; extras re-fetch when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    if (!live || !isTeacher) {
      setRoster(null);
      return;
    }
    let active = true;
    void platformFetch(
      `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/classroom-sessions/${encodeURIComponent(live.id)}/roster`,
    ).then((result) => {
      if (!active || result.status === 403 || !result.ok) {
        if (active && result.status !== 403 && !result.ok) setRoster(null);
        return;
      }
      const groups: Record<string, RosterPerson[]> = { present: [], absent: [], late: [] };
      for (const key of Object.keys(groups)) {
        groups[key] = asRecords(result.body[key]).map((row) => ({
          platformAccountId: String(row.platformAccountId || ''),
          displayName: String(row.displayName || '同學'),
          punctuality: typeof row.punctuality === 'string' ? row.punctuality : undefined,
        }));
      }
      setRoster(groups);
    });
    return () => {
      active = false;
    };
  }, [live?.id, isTeacher, workspaceId]);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="classroom-session-heading">
      <h2 id="classroom-session-heading">課堂簽到</h2>
      <p className={styles.muted}>簽到與補簽不會寫進學校正式出席系統。</p>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      {isTeacher ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await platformFetch(
                `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/classroom-sessions`,
                {
                  title: title.trim(),
                  idempotencyKey: `web-classroom-${crypto.randomUUID()}`,
                  ...(unitId ? { unitId } : {}),
                },
              );
              if (result.status === 401) {
                window.location.replace(accountReturnHref(workspacePath(workspaceId)));
                return;
              }
              if (!result.ok) throw new Error('課堂沒有開始成功，請稍後再試。');
              await reload();
            }, '課堂沒有開始成功，請稍後再試。');
          }}
        >
          <Input
            label="課堂名稱"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            disabled={busy || !!live}
          />
          {units.length ? (
            <Select
              label="掛在哪個章節"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              options={[
                { value: '', label: '不掛章節' },
                ...units.map((unit) => ({ value: unit.id, label: unit.title })),
              ]}
            />
          ) : null}
          <Button type="submit" disabled={busy || !!live || title.trim().length < 1}>
            {busy && !live ? '開始中…' : '開始課堂'}
          </Button>
        </form>
      ) : null}
      {live ? (
        <div className={styles.stack}>
          <p role="status">
            進行中：<strong>{live.title}</strong>
            {typeof live.checkInCount === 'number' ? ` · 已簽到 ${live.checkInCount} 人` : ''}
          </p>
          {!isTeacher ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const result = await platformFetch(
                    `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/classroom-sessions/${encodeURIComponent(live.id)}/check-in`,
                    code.trim() ? { code: code.trim() } : undefined,
                    'POST',
                  );
                  if (result.status === 401) {
                    window.location.replace(accountReturnHref(workspacePath(workspaceId)));
                    return;
                  }
                  if (!result.ok) throw new Error('簽到沒有成功，請稍後再試。');
                  setNotice('你已簽到。這不會寫進正式出席系統。');
                  setCode('');
                  await reload();
                }, '簽到沒有成功，請稍後再試。');
              }}
            >
              <Input
                label="簽到碼（若老師有提供）"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={busy}
              />
              <div className={styles.actions}>
                <Button type="submit" disabled={busy}>
                  簽到
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await platformFetch(
                        `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/classroom-sessions/${encodeURIComponent(live.id)}/makeup-requests`,
                        undefined,
                        'POST',
                      );
                      if (!result.ok) throw new Error('補簽沒有送出，請稍後再試。');
                      setNotice('已請老師補簽，還在等處理。');
                      await reload();
                    }, '補簽沒有送出，請稍後再試。')
                  }
                >
                  請老師補簽
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await platformFetch(
                    `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/classroom-sessions/${encodeURIComponent(live.id)}/end`,
                    undefined,
                    'POST',
                  );
                  if (!result.ok) throw new Error('課堂沒有結束成功，請稍後再試。');
                  setRoster(null);
                  await reload();
                }, '課堂沒有結束成功，請稍後再試。')
              }
            >
              結束課堂
            </Button>
          )}
        </div>
      ) : (
        <p className={styles.muted}>目前沒有進行中的課堂。</p>
      )}
      {isTeacher && roster ? (
        <div className={styles.roster} aria-label="課堂名冊">
          {(['present', 'absent', 'late'] as const).map((group) => (
            <div key={group}>
              <h3>
                {rosterLabels[group]} {roster[group]?.length ?? 0}
              </h3>
              <ul className={styles.stack}>
                {(roster[group] ?? []).length === 0 ? (
                  <li>現在沒有人</li>
                ) : (
                  (roster[group] ?? []).map((person) => (
                    <li key={person.platformAccountId}>
                      <span>
                        {person.displayName}
                        {person.punctuality === 'makeup' ? ' · 補簽' : ''}
                      </span>
                      {group === 'absent' && live ? (
                        <div className={styles.actions}>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const result = await platformFetch(
                                  `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/classroom-sessions/${encodeURIComponent(live.id)}/makeup`,
                                  {
                                    platformAccountId: person.platformAccountId,
                                    decision: 'accept',
                                  },
                                );
                                if (!result.ok) throw new Error('補簽沒有完成，請稍後再試。');
                                await reload();
                              }, '補簽沒有完成，請稍後再試。')
                            }
                          >
                            接受補簽
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const result = await platformFetch(
                                  `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/classroom-sessions/${encodeURIComponent(live.id)}/makeup`,
                                  {
                                    platformAccountId: person.platformAccountId,
                                    decision: 'reject',
                                  },
                                );
                                if (!result.ok) throw new Error('補簽沒有完成，請稍後再試。');
                                setNotice('這次沒有補簽。');
                                await reload();
                              }, '補簽沒有完成，請稍後再試。')
                            }
                          >
                            拒絕補簽
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
